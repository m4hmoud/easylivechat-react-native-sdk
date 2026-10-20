import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChat } from '../src/client';
import { EasyLiveChatError } from '../src/errors';
import { EasyLiveChatPush } from '../src/push';
import { SessionController } from '../src/session-controller';
import { InMemoryStorage, StorageKeys } from '../src/storage';
import { configBody, fakeJwt, installFakeServer, sessionBody, type FakeServer } from './fake-server';
import { resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * Port of `visitor_push_test.dart`, plus what the RN port adds around it.
 *
 * A push token handed over before there is a chat must not be dropped. The
 * host app gets its FCM token at launch, long before anyone opens the
 * conversation — and a registration can only be authenticated with a session
 * token, which does not exist yet. So the registration is held and sent when a
 * session arrives. The other half is rotation: a new token must replace the
 * old one, or the dead row keeps receiving this person's replies.
 *
 * Driven through the real REST client against the fake server, so what is
 * asserted is what goes on the wire.
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('setPushToken', () => {
  let server: FakeServer;
  let storage: InMemoryStorage;

  const controller = (overrides: Record<string, unknown> = {}): SessionController =>
    new SessionController(
      {
        apiBase: 'https://api.example.test',
        tenantSlug: 'acme',
        enableHeartbeat: false,
        enablePresenceSocket: false,
        ...overrides,
      },
      storage,
    );

  const registered = (): Array<Record<string, unknown> | null> =>
    server.requestsFor('/push/register').map((r) => r.body);
  const unregistered = (): unknown[] =>
    server.requestsFor('/push/unregister').map((r) => r.body?.token);

  beforeEach(() => {
    resetFakeSockets();
    storage = new InMemoryStorage();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
    server.always('/push/register', { body: { ok: true, id: 'p1' } });
    server.always('/push/unregister', { body: { ok: true } });
  });

  afterEach(() => server.restore());

  // ── the Flutter tests ───────────────────────────────────────────────────

  it('holds the registration until a session can authenticate it', async () => {
    const c = controller();
    await c.boot();

    await c.setPushToken('fcm-1', { platform: 'ANDROID' });
    expect(registered()).toEqual([]); // nothing to authenticate with yet

    // A session arrives: the held registration goes out by itself.
    await c.silentResume();
    await flush();
    expect(registered()).toEqual([{ token: 'fcm-1', platform: 'ANDROID' }]);
    c.dispose();
  });

  it('moves the registration when the device rotates its token', async () => {
    const c = controller();
    await c.boot();
    await c.silentResume();

    await c.setPushToken('fcm-1', { platform: 'IOS' });
    await c.setPushToken('fcm-2', { platform: 'IOS' });

    expect(registered().map((b) => b?.token)).toEqual(['fcm-1', 'fcm-2']);
    // The old row must not outlive the swap.
    expect(unregistered()).toEqual(['fcm-1']);
    c.dispose();
  });

  it('registers once for a token the server already has', async () => {
    const c = controller();
    await c.boot();
    await c.silentResume();

    await c.setPushToken('fcm-1', { platform: 'ANDROID' });
    await c.setPushToken('fcm-1', { platform: 'ANDROID' });
    expect(registered()).toHaveLength(1);
    c.dispose();
  });

  it('null stops the notifications', async () => {
    const c = controller();
    await c.boot();
    await c.silentResume();

    await c.setPushToken('fcm-1', { platform: 'ANDROID' });
    await c.setPushToken(null, { platform: 'ANDROID' });
    expect(unregistered()).toEqual(['fcm-1']);
    c.dispose();
  });

  it('a failed registration stays queued for the next session', async () => {
    server.reply('/push/register', { status: 400, body: { error: 'PLATFORM_INVALID' } });
    const c = controller();
    await c.boot();
    await c.silentResume();

    await c.setPushToken('fcm-1', { platform: 'ANDROID' });
    expect(registered()).toHaveLength(1);

    await c.silentResume();
    await flush();
    // Retried when a session came back.
    expect(registered()).toHaveLength(2);
    c.dispose();
  });

  // ── the wire ────────────────────────────────────────────────────────────

  it('authenticates with the widget token and sends nothing that names a contact', async () => {
    const jwt = fakeJwt();
    server.always('/session', { body: sessionBody({ token: jwt }) });
    const c = controller({ contentLocale: 'ckb', locale: 'Kurdish (Sorani)' });
    await c.boot();
    await c.silentResume();

    await c.setPushToken('  fcm-1 ', { platform: 'IOS', appVersion: '2.4.0' });
    const [req] = server.requestsFor('/push/register');
    expect(req?.method).toBe('POST');
    expect(req?.path).toBe('/api/widget/acme/push/register');
    expect(req?.headers.authorization).toBe(`Bearer ${jwt}`);
    // The content-locale CODE picks the language of "Sent a photo"; the
    // display name in `locale` is something the server cannot match.
    expect(req?.body).toEqual({ token: 'fcm-1', platform: 'IOS', locale: 'ckb', appVersion: '2.4.0' });

    await c.setPushToken(null, { platform: 'IOS' });
    const [off] = server.requestsFor('/push/unregister');
    expect(off?.path).toBe('/api/widget/acme/push/unregister');
    expect(off?.headers.authorization).toBe(`Bearer ${jwt}`);
    expect(off?.body).toEqual({ token: 'fcm-1' });
    c.dispose();
  });

  it('ignores a blank token rather than registering nothing', async () => {
    const c = controller();
    await c.boot();
    await c.silentResume();
    await c.setPushToken('   ', { platform: 'ANDROID' });
    expect(server.requestsFor('/push/')).toHaveLength(0);
    c.dispose();
  });

  it('collapses a burst of rotations into the right end state', async () => {
    const c = controller();
    await c.boot();
    await c.silentResume();

    // Not awaited between: the registrations are queued, and each step is
    // decided when it runs.
    const a = c.setPushToken('fcm-1', { platform: 'ANDROID' });
    const b = c.setPushToken('fcm-2', { platform: 'ANDROID' });
    await Promise.all([a, b]);

    const live = new Set<unknown>();
    for (const r of server.requests) {
      if (r.path.endsWith('/push/register')) live.add(r.body?.token);
      if (r.path.endsWith('/push/unregister')) live.delete(r.body?.token);
    }
    expect([...live]).toEqual(['fcm-2']);
    c.dispose();
  });

  it('never rejects, even when the server refuses', async () => {
    server.always('/push/register', { status: 500, body: { error: 'BOOM' } });
    const c = controller();
    await c.boot();
    await c.silentResume();
    await expect(c.setPushToken('fcm-1', { platform: 'ANDROID' })).resolves.toBeUndefined();
    c.dispose();
  });

  it('retries a held registration when the token is re-minted', async () => {
    server.reply('/push/register', { status: 500, body: { error: 'BOOM' } });
    const c = controller();
    await c.boot();
    await c.open();
    await c.setPushToken('fcm-1', { platform: 'ANDROID' });
    expect(registered()).toHaveLength(1);

    // A socket auth rejection is what triggers the re-mint.
    const { latestSocket } = await import('./fake-socket');
    latestSocket('/widgets').fire('connect_error', { message: 'WIDGET_TOKEN_EXPIRED' });
    await vi.waitFor(() => expect(registered()).toHaveLength(2));
    c.dispose();
  });

  // ── identity switch and reset ───────────────────────────────────────────

  it("drops the previous person's registration on an identity switch, and registers for the next", async () => {
    const adaJwt = fakeJwt();
    const graceJwt = fakeJwt(3600);
    server.reply('/session', { body: sessionBody({ token: adaJwt, conversationId: 'ada-conv' }) });
    server.always('/session', { body: sessionBody({ token: graceJwt, conversationId: 'grace-conv' }) });
    const c = controller();
    await c.boot();
    c.identify({ name: 'Ada', userId: 'user-ada', userHash: 'ha' });
    await c.open();
    await c.setPushToken('fcm-1', { platform: 'ANDROID' });
    expect(server.requestsFor('/push/register').map((r) => r.headers.authorization)).toEqual([
      `Bearer ${adaJwt}`,
    ]);

    c.identify({ name: 'Grace', userId: 'user-grace', userHash: 'hg' });
    await vi.waitFor(() => expect(c.conversationId).toBe('grace-conv'));
    await flush();

    // Ada's device row goes, authenticated as Ada…
    const off = server.requestsFor('/push/unregister');
    expect(off.map((r) => [r.body?.token, r.headers.authorization])).toEqual([
      ['fcm-1', `Bearer ${adaJwt}`],
    ]);
    // …and the same device token is filed under Grace once she has a session.
    expect(server.requestsFor('/push/register').map((r) => r.headers.authorization)).toEqual([
      `Bearer ${adaJwt}`,
      `Bearer ${graceJwt}`,
    ]);
    c.dispose();
  });

  it('uses the stored token for a switch on a cold start, before any session', async () => {
    // Ada's visitor, as a previous launch left it — her registration included.
    await storage.write(StorageKeys.visitorId, 'ada-visitor');
    await storage.write(StorageKeys.identifiedUserId, 'user-ada');
    await storage.write(StorageKeys.token, 'ada-stored-jwt');
    const c = controller();
    await c.boot();
    // The host hands over the device token at launch, then Grace signs in.
    await c.setPushToken('fcm-1', { platform: 'IOS' });
    c.identify({ userId: 'user-grace', userHash: 'hg' });
    await flush();

    const off = server.requestsFor('/push/unregister');
    expect(off.map((r) => [r.body?.token, r.headers.authorization])).toEqual([
      ['fcm-1', 'Bearer ada-stored-jwt'],
    ]);
    expect(await storage.read(StorageKeys.token)).toBeNull();
    c.dispose();
  });

  it('keeps the registration when an anonymous visitor signs in', async () => {
    const c = controller();
    await c.boot();
    await c.silentResume();
    await c.setPushToken('fcm-1', { platform: 'ANDROID' });

    c.identify({ name: 'Ada', userId: 'user-ada', userHash: 'ha' });
    await flush();
    // The same person, now known: nothing to drop.
    expect(unregistered()).toEqual([]);
    c.dispose();
  });

  it('drops the registration on reset(), with the token the session holds', async () => {
    const jwt = fakeJwt();
    server.always('/session', { body: sessionBody({ token: jwt }) });
    const c = controller();
    await c.boot();
    await c.silentResume();
    await c.setPushToken('fcm-1', { platform: 'ANDROID' });

    await c.resetVisitor();
    await flush();
    const off = server.requestsFor('/push/unregister');
    expect(off.map((r) => [r.body?.token, r.headers.authorization])).toEqual([['fcm-1', `Bearer ${jwt}`]]);
    for (const key of StorageKeys.identity) expect(await storage.read(key)).toBeNull();
    c.dispose();
  });

  it('drops the registration on reset() with only a stored token to go on', async () => {
    // Logging out on a launch that never opened the chat — the usual case.
    await storage.write(StorageKeys.visitorId, 'returning');
    await storage.write(StorageKeys.token, 'stored-jwt');
    const c = controller();
    await c.boot();
    await c.setPushToken('fcm-1', { platform: 'ANDROID' });

    await c.resetVisitor();
    await flush();
    expect(
      server.requestsFor('/push/unregister').map((r) => [r.body?.token, r.headers.authorization]),
    ).toEqual([['fcm-1', 'Bearer stored-jwt']]);
    c.dispose();
  });

  it('sends nothing on reset() when no device token was ever handed over', async () => {
    const c = controller();
    await c.boot();
    await c.silentResume();
    await c.resetVisitor();
    await flush();
    expect(server.requestsFor('/push/')).toHaveLength(0);
    c.dispose();
  });
});

describe('the facade', () => {
  let server: FakeServer;
  const config = {
    apiBase: 'https://api.example.test',
    tenantSlug: 'acme',
    enableHeartbeat: false,
    enablePresenceSocket: false,
  };

  beforeEach(() => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
    server.always('/push/register', { body: { ok: true, id: 'p1' } });
    server.always('/push/unregister', { body: { ok: true } });
  });

  afterEach(async () => {
    await EasyLiveChat.instance.setPushToken(null, { platform: 'ANDROID' });
    EasyLiveChat.instance.shutdown();
    server.restore();
  });

  it('holds a token handed over BEFORE boot, and registers it with the first session', async () => {
    await EasyLiveChat.instance.setPushToken('fcm-1', { platform: 'IOS' });
    expect(EasyLiveChat.instance.isBooted).toBe(false);

    await EasyLiveChat.instance.boot(config, { storage: new InMemoryStorage() });
    expect(server.requestsFor('/push/')).toHaveLength(0);

    await EasyLiveChat.instance.open();
    await vi.waitFor(() =>
      expect(server.requestsFor('/push/register').map((r) => r.body)).toEqual([
        { token: 'fcm-1', platform: 'IOS' },
      ]),
    );
  });

  it('keeps the device token across reset(), for whoever opens the chat next', async () => {
    const storage = new InMemoryStorage();
    await EasyLiveChat.instance.boot(config, { storage });
    await EasyLiveChat.instance.open();
    await EasyLiveChat.instance.setPushToken('fcm-1', { platform: 'ANDROID' });
    expect(server.requestsFor('/push/register')).toHaveLength(1);

    await EasyLiveChat.instance.reset();
    await flush();
    expect(server.requestsFor('/push/unregister').map((r) => r.body?.token)).toEqual(['fcm-1']);

    // The next person on the device.
    await EasyLiveChat.instance.boot(config, { storage });
    await EasyLiveChat.instance.open();
    await vi.waitFor(() => expect(server.requestsFor('/push/register')).toHaveLength(2));
  });

  describe('the deprecated EasyLiveChatPush alias', () => {
    it('reports push as supported now', () => {
      expect(EasyLiveChatPush.isSupported).toBe(true);
    });

    it('forwards to setPushToken', async () => {
      await EasyLiveChat.instance.boot(config, { storage: new InMemoryStorage() });
      await EasyLiveChat.instance.open();
      await EasyLiveChatPush.registerDeviceToken('fcm-1', { platform: 'ANDROID', appVersion: '1.0' });
      expect(server.requestsFor('/push/register').map((r) => r.body)).toEqual([
        { token: 'fcm-1', platform: 'ANDROID', appVersion: '1.0' },
      ]);
      await EasyLiveChatPush.unregisterDeviceToken();
      expect(server.requestsFor('/push/unregister').map((r) => r.body?.token)).toEqual(['fcm-1']);
    });

    it('rejects, loudly, a call without the platform the old stub never asked for', async () => {
      const error = await EasyLiveChatPush.registerDeviceToken('fcm-1').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(EasyLiveChatError);
      expect((error as EasyLiveChatError).message).toContain('setPushToken');
      expect(server.requestsFor('/push/')).toHaveLength(0);
    });
  });
});
