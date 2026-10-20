import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EasyLiveChatError,
  EasyLiveChatErrorCode,
  errorForResponse,
  isIdentityNotVerified,
} from '../src/errors';
import { SessionController, visitorChangeFor } from '../src/session-controller';
import { InMemoryStorage, StorageKeys } from '../src/storage';
import { configBody, installFakeServer, sessionBody, type FakeServer } from './fake-server';
import { createdSockets, latestSocket, resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * Identity verification: the host's BACKEND signs its own user id
 * (`userHash = HMAC_SHA256(identitySecret, userId)`) and the app passes both.
 * The server checks the claim on EVERY `POST /session`, so both keys have to
 * ride on the silent resume as well as the start — a resume is what most
 * returning visitors ever send.
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('identity verification', () => {
  let server: FakeServer;
  let storage: InMemoryStorage;

  const controller = (): SessionController =>
    new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      storage,
    );

  const lastSession = () => server.requestsFor('/session').at(-1)?.body;

  beforeEach(() => {
    resetFakeSockets();
    storage = new InMemoryStorage();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
  });

  afterEach(() => server.restore());

  describe('on the wire', () => {
    it('sends userId and userHash as top-level keys on the SILENT RESUME', async () => {
      server.always('/session', { body: sessionBody() });
      const c = controller();
      await c.boot();
      c.identify({ name: 'Ada', userId: 'user-42', userHash: 'abc123' });
      await c.silentResume();
      const body = lastSession();
      expect(body?.resumeOnly).toBe(true);
      expect(body?.userId).toBe('user-42');
      expect(body?.userHash).toBe('abc123');
      c.dispose();
    });

    it('sends them on the START too', async () => {
      server.always('/session', { body: sessionBody() });
      const c = controller();
      await c.boot();
      c.identify({ userId: 'user-42', userHash: 'abc123' });
      await c.startSession({ name: 'Ada' }, { skipValidation: true });
      const body = lastSession();
      expect(body).not.toHaveProperty('resumeOnly');
      expect(body?.userId).toBe('user-42');
      expect(body?.userHash).toBe('abc123');
      c.dispose();
    });

    it('sends them on the token re-mint', async () => {
      server.always('/session', { body: sessionBody() });
      const c = controller();
      await c.boot();
      c.identify({ userId: 'user-42', userHash: 'abc123' });
      await c.startSession({}, { skipValidation: true });
      // A socket auth rejection is what triggers the re-mint.
      latestSocket('/widgets').fire('connect_error', { message: 'WIDGET_TOKEN_EXPIRED' });
      await flush();
      const remint = lastSession();
      expect(remint?.resumeOnly).toBe(true);
      expect(remint?.userId).toBe('user-42');
      expect(remint?.userHash).toBe('abc123');
      c.dispose();
    });

    it('omits both keys for an anonymous visitor, and blank values', async () => {
      server.always('/session', { body: sessionBody() });
      const c = controller();
      await c.boot();
      await c.startSession({}, { skipValidation: true });
      expect(lastSession()).not.toHaveProperty('userId');
      expect(lastSession()).not.toHaveProperty('userHash');

      c.identify({ name: 'Ada', userId: '   ', userHash: '' });
      await c.silentResume();
      expect(lastSession()).not.toHaveProperty('userId');
      expect(lastSession()).not.toHaveProperty('userHash');
      c.dispose();
    });

    it('trims the claim', async () => {
      server.always('/session', { body: sessionBody() });
      const c = controller();
      await c.boot();
      c.identify({ userId: '  user-42 ', userHash: ' abc123\n' });
      await c.silentResume();
      expect(lastSession()?.userId).toBe('user-42');
      expect(lastSession()?.userHash).toBe('abc123');
      c.dispose();
    });

    it('takes a claim passed straight to startSession()', async () => {
      server.always('/session', { body: sessionBody() });
      const c = controller();
      await c.boot();
      await c.startSession({ userId: 'user-7', userHash: 'h7' }, { skipValidation: true });
      expect(lastSession()?.userId).toBe('user-7');
      expect(lastSession()?.userHash).toBe('h7');
      // …and keeps it for the calls that follow.
      await c.silentResume();
      expect(lastSession()?.userId).toBe('user-7');
      c.dispose();
    });
  });

  describe('a refused claim (403 IDENTITY_NOT_VERIFIED)', () => {
    const refusal = (reason: string) => ({
      status: 403,
      body: { error: 'IDENTITY_NOT_VERIFIED', reason },
    });

    it('decodes to a typed error that keeps the reason', () => {
      const e = errorForResponse(403, { error: 'IDENTITY_NOT_VERIFIED', reason: 'BAD_HASH' });
      expect(e).toBeInstanceOf(EasyLiveChatError);
      expect(e.code).toBe(EasyLiveChatErrorCode.IDENTITY_NOT_VERIFIED);
      expect(e.reason).toBe('BAD_HASH');
      expect(e.httpStatus).toBe(403);
      expect(isIdentityNotVerified(e)).toBe(true);
      // A 403 that is NOT an auth failure: re-minting cannot fix a bad hash.
      expect(e.isAuthError).toBe(false);
      // Something a developer reading a log can act on.
      expect(e.message).toContain('HMAC_SHA256');
      expect(e.toString()).toContain('reason=BAD_HASH');
    });

    it('describes every reason', () => {
      for (const reason of ['NO_SECRET', 'NO_HASH', 'BAD_HASH', 'SOMETHING_NEW']) {
        const e = errorForResponse(403, { error: 'IDENTITY_NOT_VERIFIED', reason });
        expect(e.reason).toBe(reason);
        expect(e.message).not.toBe('IDENTITY_NOT_VERIFIED');
      }
    });

    it('is not confused with other errors', () => {
      expect(isIdentityNotVerified(errorForResponse(403, {}))).toBe(false);
      expect(isIdentityNotVerified(errorForResponse(403, { error: 'ORIGIN_NOT_ALLOWED' }))).toBe(false);
      expect(isIdentityNotVerified(new Error('IDENTITY_NOT_VERIFIED'))).toBe(false);
      expect(isIdentityNotVerified(null)).toBe(false);
    });

    it('rejects startSession() — once, with no re-mint retry', async () => {
      server.always('/session', refusal('NO_HASH'));
      const c = controller();
      await c.boot();
      c.identify({ userId: 'user-42' });
      const error = await c.startSession({}, { skipValidation: true }).catch((e: unknown) => e);
      expect(isIdentityNotVerified(error)).toBe(true);
      expect((error as EasyLiveChatError).reason).toBe('NO_HASH');
      expect(server.requestsFor('/session')).toHaveLength(1);
      c.dispose();
    });

    it('surfaces on onError from the silent resume, which resolves false', async () => {
      await storage.write(StorageKeys.visitorId, 'returning');
      server.always('/session', refusal('BAD_HASH'));
      const c = controller();
      await c.boot();
      const errors: EasyLiveChatError[] = [];
      c.onError((e) => errors.push(e));
      c.identify({ userId: 'user-42', userHash: 'wrong' });
      expect(await c.silentResume()).toBe(false);
      expect(errors.map((e) => [e.code, e.reason])).toEqual([['IDENTITY_NOT_VERIFIED', 'BAD_HASH']]);
      c.dispose();
    });

    it('rejects open() for an identified visitor', async () => {
      server.always('/session', refusal('BAD_HASH'));
      const c = controller();
      await c.boot();
      c.identify({ name: 'Ada', userId: 'user-42', userHash: 'wrong' });
      const error = await c.open().catch((e: unknown) => e);
      expect(isIdentityNotVerified(error)).toBe(true);
      expect(c.phase.get()).toBe('idle');
      c.dispose();
    });
  });

  describe('the person-change rule', () => {
    it('matches the web widget', () => {
      expect(visitorChangeFor(null, null)).toBe('same');
      expect(visitorChangeFor('u1', 'u1')).toBe('same');
      expect(visitorChangeFor(null, 'u1')).toBe('upgraded');
      expect(visitorChangeFor('u1', 'u2')).toBe('switched');
      expect(visitorChangeFor('u1', null)).toBe('switched');
    });

    it('keeps the visitor when an anonymous one signs in, and remembers the user', async () => {
      server.always('/session', { body: sessionBody() });
      const c = controller();
      await c.boot();
      await c.startSession({}, { skipValidation: true });
      const before = c.visitorId;
      const sessions = server.requestsFor('/session').length;

      c.identify({ name: 'Ada', userId: 'user-42', userHash: 'h42' });
      await flush();

      expect(c.visitorId).toBe(before);
      expect(c.conversationId).toBe('c1');
      expect(await storage.read(StorageKeys.visitorId)).toBe(before);
      expect(await storage.read(StorageKeys.identifiedUserId)).toBe('user-42');
      // The live conversation gets the identity now, not at the next re-mint.
      const attach = server.requestsFor('/session').slice(sessions);
      expect(attach).toHaveLength(1);
      expect(attach[0]?.body).toMatchObject({
        visitorId: before,
        resumeOnly: true,
        userId: 'user-42',
        userHash: 'h42',
      });
      c.dispose();
    });

    it('starts a NEW visitor for a different userId and forgets the stored one', async () => {
      // Ada's visitor, as a previous launch left it on the device.
      await storage.write(StorageKeys.visitorId, 'ada-visitor');
      await storage.write(StorageKeys.identifiedUserId, 'user-ada');
      await storage.write(StorageKeys.profile, '{"name":"Ada","email":"ada@example.com"}');
      await storage.write(StorageKeys.token, 'ada-token');
      await storage.write(StorageKeys.conversationId, 'ada-conv');
      server.always('/session', { body: sessionBody() });
      const c = controller();
      await c.boot();
      c.identify({ name: 'Ada', userId: 'user-ada', userHash: 'ha' });
      expect(c.visitorId).toBe('ada-visitor');

      c.identify({ name: 'Grace', userId: 'user-grace', userHash: 'hg' });
      await flush();

      expect(c.visitorId).not.toBe('ada-visitor');
      expect(await storage.read(StorageKeys.visitorId)).toBe(c.visitorId);
      expect(await storage.read(StorageKeys.identifiedUserId)).toBe('user-grace');
      expect(await storage.read(StorageKeys.profile)).toBeNull();
      expect(await storage.read(StorageKeys.token)).toBeNull();
      expect(await storage.read(StorageKeys.conversationId)).toBeNull();
      expect(c.visitorName).toBe('Grace');
      c.dispose();
    });

    it('tears down the live session and re-opens as the new person', async () => {
      server.always('/session', { body: sessionBody() });
      const c = controller();
      await c.boot();
      c.identify({ name: 'Ada', userId: 'user-ada', userHash: 'ha' });
      await c.open();
      expect(c.phase.get()).toBe('chat');
      const adaSocket = latestSocket('/widgets');
      const ada = c.visitorId;

      c.identify({ name: 'Grace', userId: 'user-grace', userHash: 'hg' });
      // Synchronously gone: nothing of Ada's conversation stays on screen.
      expect(adaSocket.disposed).toBe(true);
      expect(c.messages.get()).toEqual([]);
      expect(c.conversationId).toBeNull();

      await vi.waitFor(() => expect(c.conversationId).toBe('c1'));
      const graceStart = server.requestsFor('/session').at(-1)?.body;
      expect(graceStart?.visitorId).toBe(c.visitorId);
      expect(graceStart?.visitorId).not.toBe(ada);
      expect(graceStart?.userId).toBe('user-grace');
      expect(graceStart?.name).toBe('Grace');
      // Nothing of the new visitor's was ever sent under the old id.
      const underOldId = server
        .requestsFor('/session')
        .filter((r) => r.body?.visitorId === ada && r.body?.userId === 'user-grace');
      expect(underOldId).toHaveLength(0);
      expect(c.phase.get()).toBe('chat');
      c.dispose();
    });

    it('forgets the visitor when an identity WITHOUT a userId follows one with', async () => {
      server.always('/session', { body: sessionBody() });
      const c = controller();
      await c.boot();
      c.identify({ name: 'Ada', userId: 'user-ada', userHash: 'ha' });
      await flush();
      const ada = c.visitorId;

      c.identify({ name: 'Somebody' });
      await flush();

      expect(c.visitorId).not.toBe(ada);
      expect(await storage.read(StorageKeys.identifiedUserId)).toBeNull();
      await c.silentResume();
      expect(lastSession()).not.toHaveProperty('userId');
      c.dispose();
    });

    it('treats an empty identify({}) after a userId as signing out', async () => {
      server.always('/session', { body: sessionBody() });
      const c = controller();
      await c.boot();
      c.identify({ name: 'Ada', userId: 'user-ada', userHash: 'ha' });
      await flush();
      const ada = c.visitorId;

      c.identify({});
      await flush();

      expect(c.visitorId).not.toBe(ada);
      expect(c.visitorName).toBeNull();
      expect(await storage.read(StorageKeys.identifiedUserId)).toBeNull();
      c.dispose();
    });

    it('keeps the same signed-in user across a cold start', async () => {
      server.always('/session', { body: sessionBody() });
      const first = controller();
      await first.boot();
      first.identify({ userId: 'user-ada', userHash: 'ha' });
      await first.startSession({}, { skipValidation: true });
      const ada = first.visitorId;
      first.dispose();

      const second = controller();
      await second.boot();
      second.identify({ userId: 'user-ada', userHash: 'ha' });
      await second.open();
      expect(second.visitorId).toBe(ada);
      // Resumed — the probe went out under Ada's own id.
      const probe = server.requestsFor('/session').find(
        (r) => r.body?.resumeOnly === true && r.body?.visitorId === ada,
      );
      expect(probe?.body?.userId).toBe('user-ada');
      second.dispose();
    });

    it('treats a cold start with nobody identified as signed out', async () => {
      // The web widget's rule: a page that boots with no identity while one is
      // on record belongs to somebody who signed out.
      server.always('/session', { body: sessionBody({ hasActiveConversation: false, token: undefined }) });
      await storage.write(StorageKeys.visitorId, 'ada-visitor');
      await storage.write(StorageKeys.identifiedUserId, 'user-ada');
      await storage.write(StorageKeys.profile, '{"name":"Ada"}');

      const c = controller();
      await c.boot();
      expect(c.visitorName).toBe('Ada');
      await c.open();

      expect(c.visitorId).not.toBe('ada-visitor');
      expect(c.visitorName).toBeNull();
      expect(await storage.read(StorageKeys.identifiedUserId)).toBeNull();
      // The anonymous visitor's own (empty) profile, never Ada's.
      expect(await storage.read(StorageKeys.profile)).not.toContain('Ada');
      // Not one request went out under Ada's visitor id.
      expect(server.requests.filter((r) => r.body?.visitorId === 'ada-visitor')).toHaveLength(0);
      c.dispose();
    });

    it('leaves a host that never uses userId exactly as it was', async () => {
      await storage.write(StorageKeys.visitorId, 'returning');
      server.always('/session', { body: sessionBody() });
      const c = controller();
      await c.boot();
      c.identify({ name: 'Ada' });
      await c.open();
      expect(c.visitorId).toBe('returning');
      expect(await storage.read(StorageKeys.identifiedUserId)).toBeNull();
      c.dispose();
    });

    it('drops a resume that was in flight across a switch', async () => {
      await storage.write(StorageKeys.visitorId, 'ada-visitor');
      await storage.write(StorageKeys.identifiedUserId, 'user-ada');
      // The first session answer is Ada's conversation; anything after is the
      // one started for Grace.
      server.reply('/session', { body: sessionBody({ conversationId: 'ada-conv' }) });
      server.always('/session', { body: sessionBody({ conversationId: 'grace-conv' }) });
      // Hold every response until released, so the switch lands mid-request.
      const real = globalThis.fetch;
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
        await gate;
        return real(...args);
      }) as typeof fetch;

      const c = controller();
      await c.boot();
      c.identify({ userId: 'user-ada', userHash: 'ha' });
      const resumed = c.silentResume();
      await flush();

      c.identify({ userId: 'user-grace', userHash: 'hg' });
      release();

      expect(await resumed).toBe(false);
      // The switch re-opens as Grace — and Ada's conversation is never adopted.
      await vi.waitFor(() => expect(c.conversationId).toBe('grace-conv'));
      const sessions = server.requestsFor('/session').map((r) => r.body);
      expect(sessions[0]).toMatchObject({ visitorId: 'ada-visitor', userId: 'user-ada' });
      expect(sessions.at(-1)).toMatchObject({ visitorId: c.visitorId, userId: 'user-grace' });
      expect(c.visitorId).not.toBe('ada-visitor');
      c.dispose();
    });
  });
});
