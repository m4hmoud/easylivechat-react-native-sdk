import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChat } from '../src/client';
import { EasyLiveChatError } from '../src/errors';
import { parseConfigResponse } from '../src/models/widget-config';
import { parseVisitorEmailState } from '../src/models/results';
import { SessionController } from '../src/session-controller';
import { InMemoryStorage } from '../src/storage';
import { configBody, fakeJwt, installFakeServer, messageRow, sessionBody, type FakeServer } from './fake-server';
import { resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * The two emails to the visitor, over the web widget's endpoints
 * (apps/api/src/routes/widget.ts): "Email me this chat"
 * (`POST /conversations/:id/transcript`) and "Get the reply by email"
 * (`GET`/`POST /visitor-email`), the second offered while nobody can answer.
 * Both take the widget token — the live session's, or on the screen after the
 * chat the one minted for the conversation that just ended.
 */
const CONFIG = {
  apiBase: 'https://api.example.com',
  tenantSlug: 'acme',
  enableHeartbeat: false,
  enablePresenceSocket: false,
};

describe('the config flags', () => {
  it('reads both, and an older server that sends neither offers neither', () => {
    const both = parseConfigResponse(configBody({ transcriptEmailEnabled: true, replyEmailEnabled: true }));
    expect([both.transcriptEmailEnabled, both.replyEmailEnabled]).toEqual([true, true]);
    const older = parseConfigResponse(configBody());
    expect([older.transcriptEmailEnabled, older.replyEmailEnabled]).toEqual([false, false]);
  });

  it('reads the visitor-email state null-tolerantly', () => {
    expect(parseVisitorEmailState({ emailHint: 'a•••@example.com', unsubscribed: false, transcriptEnabled: true, replyEmailEnabled: true })).toEqual({
      emailHint: 'a•••@example.com',
      unsubscribed: false,
      transcriptEnabled: true,
      replyEmailEnabled: true,
    });
    expect(parseVisitorEmailState({ emailHint: '  ' })).toEqual({
      emailHint: null,
      unsubscribed: false,
      transcriptEnabled: false,
      replyEmailEnabled: false,
    });
  });
});

describe('emails to the visitor', () => {
  let server: FakeServer;
  let controller: SessionController;

  beforeEach(async () => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody({ transcriptEmailEnabled: true, replyEmailEnabled: true }) });
    server.always('/session', { body: sessionBody({ token: fakeJwt(), messages: [messageRow()] }) });
    controller = new SessionController(CONFIG, new InMemoryStorage());
    await controller.boot();
  });

  afterEach(() => {
    controller.dispose();
    server.restore();
  });

  it('says whether the workspace offers the reply by email', async () => {
    expect(controller.replyEmailEnabled.get()).toBe(false);
    await controller.open();
    expect(controller.replyEmailEnabled.get()).toBe(true);
  });

  it('follows a change of the switch on the next availability refresh', async () => {
    await controller.open();
    server.always('/config', { body: configBody({ transcriptEmailEnabled: true, replyEmailEnabled: false }) });
    await controller.refreshAvailability();
    expect(controller.replyEmailEnabled.get()).toBe(false);
  });

  it('asks for the address on file with the widget token, and gets it masked', async () => {
    await controller.open();
    server.reply('/visitor-email', {
      body: { emailHint: 'j•••@example.com', unsubscribed: false, transcriptEnabled: true, replyEmailEnabled: true },
    });
    await expect(controller.visitorEmail()).resolves.toEqual({
      emailHint: 'j•••@example.com',
      unsubscribed: false,
      transcriptEnabled: true,
      replyEmailEnabled: true,
    });
    const [request] = server.requestsFor('/visitor-email');
    expect(request?.method).toBe('GET');
    expect(request?.path).toBe('/api/widget/acme/visitor-email');
    expect(request?.headers.authorization).toMatch(/^Bearer /);
  });

  it('keeps an address for the reply, trimmed, and answers it masked', async () => {
    await controller.open();
    server.reply('/visitor-email', { body: { ok: true, emailHint: 'j•••@example.com' } });
    await expect(controller.setVisitorEmail('  jo@example.com ')).resolves.toEqual({
      emailHint: 'j•••@example.com',
    });
    const [request] = server.requestsFor('/visitor-email');
    expect(request?.method).toBe('POST');
    expect(request?.body).toEqual({ email: 'jo@example.com' });
    expect(request?.headers.authorization).toMatch(/^Bearer /);
  });

  it('refuses a blank address before the network', async () => {
    await controller.open();
    const err = await controller.setVisitorEmail('   ').catch((e: unknown) => e);
    expect((err as EasyLiveChatError).code).toBe('INVALID_EMAIL');
    expect(server.requestsFor('/visitor-email')).toEqual([]);
  });

  it('rejects with the server’s code for an unsubscribed address', async () => {
    await controller.open();
    server.reply('/visitor-email', { status: 409, body: { error: 'EMAIL_UNSUBSCRIBED' } });
    const err = await controller.setVisitorEmail('jo@example.com').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EasyLiveChatError);
    expect((err as EasyLiveChatError).code).toBe('EMAIL_UNSUBSCRIBED');
  });

  it('takes the address for the transcript as `{ email }`', async () => {
    await controller.open();
    server.reply('/transcript', { body: { ok: true, sentTo: 'j•••@example.com' } });
    await expect(controller.emailTranscript({ email: ' jo@example.com ' })).resolves.toEqual({
      sentTo: 'j•••@example.com',
    });
    expect(server.requestsFor('/transcript')[0]?.body).toEqual({ email: 'jo@example.com' });
  });

  it('needs a conversation for either', async () => {
    for (const call of [() => controller.visitorEmail(), () => controller.setVisitorEmail('jo@example.com')]) {
      const err = await call().catch((e: unknown) => e);
      expect((err as EasyLiveChatError).code).toBe('NO_TOKEN');
    }
    expect(server.requestsFor('/visitor-email')).toEqual([]);
  });

  describe('after the chat', () => {
    /** The visitor ended the chat and answered the survey: the session is let go of. */
    async function endAndAnswer(): Promise<void> {
      await controller.open();
      server.always('/post-chat', { body: { ok: true } });
      await controller.submitPostChat({ q1: '5' });
      expect(controller.conversationId).toBeNull();
    }

    it('emails the conversation that just ended, with the token minted for it', async () => {
      await endAndAnswer();
      server.reply('/transcript', { body: { ok: true, sentTo: 'j•••@example.com' } });
      await expect(controller.emailTranscript()).resolves.toEqual({ sentTo: 'j•••@example.com' });
      const [request] = server.requestsFor('/transcript');
      expect(request?.path).toBe('/api/widget/acme/conversations/c1/transcript');
      expect(request?.headers.authorization).toMatch(/^Bearer /);
    });

    it('reads the address on file for it too', async () => {
      await endAndAnswer();
      server.reply('/visitor-email', { body: { emailHint: null } });
      await expect(controller.visitorEmail()).resolves.toMatchObject({ emailHint: null });
    });

    it('never resumes — and so re-opens — the closed chat to retry a refused token', async () => {
      await endAndAnswer();
      const sessions = server.requestsFor('/session').length;
      server.reply('/transcript', { status: 401, body: { error: 'UNAUTHENTICATED' } });
      const err = await controller.emailTranscript().catch((e: unknown) => e);
      expect((err as EasyLiveChatError).code).toBe('UNAUTHENTICATED');
      expect(server.requestsFor('/session')).toHaveLength(sessions);
    });

    it('is the new conversation once another chat starts', async () => {
      await endAndAnswer();
      server.always('/session', { body: sessionBody({ token: fakeJwt(), conversationId: 'c2' }) });
      await controller.open();
      server.reply('/transcript', { body: { ok: true, sentTo: 'j•••@example.com' } });
      await controller.emailTranscript();
      expect(server.requestsFor('/transcript')[0]?.path).toBe('/api/widget/acme/conversations/c2/transcript');
    });

    it('is forgotten when the visitor signs out', async () => {
      controller.identify({ userId: 'u1', userHash: 'h1' });
      await endAndAnswer();
      controller.clearIdentity();
      const err = await controller.emailTranscript().catch((e: unknown) => e);
      expect((err as EasyLiveChatError).code).toBe('NO_TOKEN');
    });
  });
});

describe('the facade', () => {
  let server: FakeServer;

  beforeEach(() => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody({ replyEmailEnabled: true }) });
    server.always('/session', { body: sessionBody() });
  });

  afterEach(() => {
    EasyLiveChat.instance.shutdown();
    server.restore();
  });

  it('exposes the reply-email switch as a store that survives boot', async () => {
    const store = EasyLiveChat.instance.replyEmailEnabled;
    expect(store.get()).toBe(false);
    await EasyLiveChat.instance.boot(CONFIG, { storage: new InMemoryStorage() });
    await EasyLiveChat.instance.open();
    expect(store.get()).toBe(true);
  });

  it('forwards the three calls', async () => {
    await EasyLiveChat.instance.boot(CONFIG, { storage: new InMemoryStorage() });
    await EasyLiveChat.instance.open();
    server.reply('/visitor-email', { body: { emailHint: null, replyEmailEnabled: true } });
    await expect(EasyLiveChat.instance.visitorEmail()).resolves.toMatchObject({ emailHint: null });
    server.reply('/visitor-email', { body: { ok: true, emailHint: 'j•••@example.com' } });
    await expect(EasyLiveChat.instance.setVisitorEmail('jo@example.com')).resolves.toEqual({
      emailHint: 'j•••@example.com',
    });
    server.reply('/transcript', { body: { ok: true, sentTo: 'j•••@example.com' } });
    await expect(EasyLiveChat.instance.emailTranscript({ email: 'jo@example.com' })).resolves.toEqual({
      sentTo: 'j•••@example.com',
    });
    // The 0.1.5 spelling, a plain address, still reads as `{ email }`.
    server.reply('/transcript', { body: { ok: true, sentTo: 'j•••@example.com' } });
    await EasyLiveChat.instance.emailTranscript('jo@example.com');
    expect(server.requestsFor('/transcript').map((r) => r.body)).toEqual([
      { email: 'jo@example.com' },
      { email: 'jo@example.com' },
    ]);
  });
});
