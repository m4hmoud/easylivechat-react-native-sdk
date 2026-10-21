import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChatError } from '../src/errors';
import { parseQueueUpdate, parseSessionResult } from '../src/models/results';
import { SessionController } from '../src/session-controller';
import { InMemoryStorage } from '../src/storage';
import { configBody, installFakeServer, messageRow, sessionBody, type FakeServer } from './fake-server';
import { latestSocket, resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * Waiting in the queue for a person — the widget's `queue:update` /
 * `conversation:assigned` handling and `lib/queue-phase.ts` — and "Email me
 * this chat" (`POST /:slug/conversations/:id/transcript`).
 */
describe('the queue on the wire', () => {
  it('reads the session’s queue fields, and nothing when not queued', () => {
    const queued = parseSessionResult(
      sessionBody({ queued: true, queuePosition: 3, queueMinutes: 6, queueInfoText: ' You are #3, Sam. ' }),
    );
    expect(queued.queue).toEqual({ position: 3, minutes: 6, text: 'You are #3, Sam.' });
    expect(parseSessionResult(sessionBody({ queued: false, queuePosition: 3 })).queue).toBeNull();
    // An older server sends none of it.
    expect(parseSessionResult(sessionBody()).queue).toBeNull();
  });

  it('reads `queue:update` defensively', () => {
    expect(parseQueueUpdate({ position: 2, minutes: 4, text: 'Nearly there' })).toEqual({
      assigned: false,
      position: 2,
      minutes: 4,
      text: 'Nearly there',
    });
    expect(parseQueueUpdate({ assigned: true, position: 0 }).assigned).toBe(true);
    expect(parseQueueUpdate({ position: -1, minutes: 'soon', text: 5 })).toEqual({
      assigned: false,
      position: 0,
      minutes: 0,
      text: '',
    });
  });
});

describe('waiting in the queue', () => {
  let server: FakeServer;
  let controller: SessionController;

  async function openQueued(before?: () => void): Promise<void> {
    server.always(
      '/session',
      {
        body: sessionBody({
          messages: [messageRow({ id: 'm1', senderType: 'CUSTOMER', body: 'Hi' })],
          queued: true,
          queuePosition: 2,
          queueMinutes: 5,
          queueInfoText: 'You are number 2 in line.',
        }),
      },
    );
    await controller.boot();
    before?.();
    await controller.open();
  }

  beforeEach(() => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    controller = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      new InMemoryStorage(),
    );
  });

  afterEach(() => {
    controller.dispose();
    server.restore();
  });

  it('puts the session’s queue on the store, over a usable chat', async () => {
    await openQueued();
    expect(controller.queue.get()).toEqual({ position: 2, minutes: 5, text: 'You are number 2 in line.' });
    expect(controller.phase.get()).toBe('chat');
  });

  it('moves with `queue:update`', async () => {
    await openQueued();
    latestSocket('/widgets').fire('queue:update', { conversationId: 'c1', position: 1, minutes: 2, text: 'You are next.' });
    expect(controller.queue.get()).toEqual({ position: 1, minutes: 2, text: 'You are next.' });
  });

  it('ends when the chat is assigned — either way the server says it', async () => {
    await openQueued();
    const socket = latestSocket('/widgets');
    socket.fire('queue:update', { conversationId: 'c1', position: 0, minutes: 0, text: '', assigned: true });
    expect(controller.queue.get()).toBeNull();

    socket.fire('queue:update', { conversationId: 'c1', position: 1, minutes: 2, text: 'Back in line' });
    socket.fire('conversation:assigned', { conversationId: 'c1', assignedAgentId: 'ag1' });
    expect(controller.queue.get()).toBeNull();
  });

  it('ends when someone from the team speaks, or starts to type', async () => {
    await openQueued();
    const socket = latestSocket('/widgets');
    socket.fire('message:new', messageRow({ id: 's1', senderType: 'SYSTEM', body: 'Waiting…', createdAt: '2026-10-18T10:00:01.000Z' }));
    // A system notice is nobody.
    expect(controller.queue.get()).not.toBeNull();
    socket.fire('message:new', messageRow({ id: 'a1', body: 'Hi, I’m Ava', createdAt: '2026-10-18T10:00:02.000Z' }));
    expect(controller.queue.get()).toBeNull();

    socket.fire('queue:update', { position: 1, minutes: 1, text: 'Again' });
    socket.fire('agent:typing', { isTyping: true });
    expect(controller.queue.get()).toBeNull();

    socket.fire('queue:update', { position: 1, minutes: 1, text: 'Again' });
    socket.fire('agent:typing', { isTyping: true, actor: 'assistant' });
    expect(controller.queue.get()).toBeNull();
  });

  it('is not ended by the visitor’s own message or a stop in typing', async () => {
    await openQueued();
    const socket = latestSocket('/widgets');
    socket.fire('message:new', messageRow({ id: 'm2', senderType: 'CUSTOMER', body: 'Still there?', createdAt: '2026-10-18T10:00:03.000Z' }));
    socket.fire('agent:typing', { isTyping: false });
    expect(controller.queue.get()).not.toBeNull();
  });

  it('is not carried over to the next person on the device', async () => {
    await openQueued(() => controller.identify({ userId: 'u1' }));
    expect(controller.queue.get()).not.toBeNull();
    // Someone else signs in: everything the first person left goes with them.
    controller.identify({ userId: 'u2' });
    expect(controller.queue.get()).toBeNull();
  });
});

describe('email me this chat', () => {
  let server: FakeServer;
  let controller: SessionController;

  beforeEach(async () => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody({ transcriptEmailEnabled: true }) });
    server.always('/session', { body: sessionBody({ messages: [messageRow()] }) });
    controller = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      new InMemoryStorage(),
    );
    await controller.boot();
  });

  afterEach(() => {
    controller.dispose();
    server.restore();
  });

  it('says whether the workspace offers it', async () => {
    expect(controller.transcriptEmailEnabled.get()).toBe(false);
    await controller.open();
    expect(controller.transcriptEmailEnabled.get()).toBe(true);
  });

  it('posts to the conversation’s transcript with the widget token', async () => {
    await controller.open();
    server.reply('/transcript', { body: { ok: true, sentTo: 'j***@example.com' } });
    await expect(controller.emailTranscript('  jo@example.com ')).resolves.toEqual({ sentTo: 'j***@example.com' });
    const [request] = server.requestsFor('/transcript');
    expect(request?.method).toBe('POST');
    expect(request?.path).toBe('/api/widget/acme/conversations/c1/transcript');
    expect(request?.headers.authorization).toMatch(/^Bearer /);
    expect(request?.body).toEqual({ email: 'jo@example.com' });
  });

  it('sends no address to use the one on file', async () => {
    await controller.open();
    server.reply('/transcript', { body: { ok: true, sentTo: 's***@example.com' } });
    await controller.emailTranscript();
    expect(server.requestsFor('/transcript')[0]?.body).toEqual({});
  });

  it('rejects with the server’s code', async () => {
    await controller.open();
    server.reply('/transcript', { status: 400, body: { error: 'NO_CONTACT_EMAIL' } });
    const err = await controller.emailTranscript().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EasyLiveChatError);
    expect((err as EasyLiveChatError).code).toBe('NO_CONTACT_EMAIL');
  });

  it('refuses before there is a conversation', async () => {
    const err = await controller.emailTranscript('jo@example.com').catch((e: unknown) => e);
    expect((err as EasyLiveChatError).code).toBe('NO_TOKEN');
    expect(server.requestsFor('/transcript')).toEqual([]);
  });
});
