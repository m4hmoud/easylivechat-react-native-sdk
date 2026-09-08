import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChatErrorCode } from '../src/errors';
import { SessionController } from '../src/session-controller';
import { InMemoryStorage } from '../src/storage';
import { configBody, installFakeServer, sessionBody, type FakeServer } from './fake-server';
import { latestSocket, resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * Port-specific: the send ack is BOUNDED.
 *
 * A socket that drops between emit and ack must yield a TERMINAL failure — the
 * bubble flips to *failed* with tap-to-retry — rather than hanging forever on
 * a promise nobody will ever settle.
 */
describe('send ack timeout', () => {
  let server: FakeServer;
  let controller: SessionController;

  beforeEach(async () => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
    controller = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      new InMemoryStorage(),
    );
    await controller.boot();
    await controller.open();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    controller.dispose();
    server.restore();
  });

  it('flips the bubble to failed when no ack arrives within 20s', async () => {
    const socket = latestSocket('/widgets');
    socket.ackResponder = () => undefined; // the ack never comes

    const { optimistic, serverMessageId } = controller.sendMessage('into the void');
    const settled = expect(serverMessageId).rejects.toMatchObject({
      code: EasyLiveChatErrorCode.SEND_REJECTED,
    });

    // Still pending just before the deadline.
    await vi.advanceTimersByTimeAsync(19_000);
    expect(controller.messages.get().find((m) => m.id === optimistic.id)?.failed).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    await settled;

    const row = controller.messages.get().find((m) => m.id === optimistic.id);
    expect(row?.failed).toBe(true);
    expect(row?.deliveryStatus).toBe('failed');
  });

  it('does not fire the timeout once the ack has arrived', async () => {
    const socket = latestSocket('/widgets');
    socket.ackResponder = () => undefined;
    const { serverMessageId } = controller.sendMessage('answered late');
    socket.pendingAcks[0]?.respond({ ok: true, messageId: 'server-1' });
    await expect(serverMessageId).resolves.toBe('server-1');

    await vi.advanceTimersByTimeAsync(30_000);
    // Still reconciled and healthy — the late timer must not un-send it.
    const row = controller.messages.get()[0];
    expect(row?.id).toBe('server-1');
    expect(row?.failed).toBe(false);
  });
});

describe('agent typing auto-clear', () => {
  let server: FakeServer;
  let controller: SessionController;

  beforeEach(async () => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
    controller = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      new InMemoryStorage(),
    );
    await controller.boot();
    await controller.open();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    controller.dispose();
    server.restore();
  });

  it('arms a 4s auto-clear as a backstop for a dropped stop event', async () => {
    const socket = latestSocket('/widgets');
    socket.fire('agent:typing', { isTyping: true });
    expect(controller.agentTyping.get()).toBe(true);

    await vi.advanceTimersByTimeAsync(3_500);
    expect(controller.agentTyping.get()).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(controller.agentTyping.get()).toBe(false);
  });

  it('clears immediately on an explicit false', () => {
    const socket = latestSocket('/widgets');
    socket.fire('agent:typing', { isTyping: true });
    socket.fire('agent:typing', { isTyping: false });
    expect(controller.agentTyping.get()).toBe(false);
  });

  it('requires an explicit true, so a malformed payload shows no phantom', () => {
    const socket = latestSocket('/widgets');
    socket.fire('agent:typing', {});
    expect(controller.agentTyping.get()).toBe(false);
    socket.fire('agent:typing', { isTyping: 'yes' });
    expect(controller.agentTyping.get()).toBe(false);
  });
});

describe('read watermark', () => {
  let server: FakeServer;
  let controller: SessionController;

  beforeEach(() => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
  });

  afterEach(() => {
    controller.dispose();
    server.restore();
  });

  it('only ever moves FORWARD', async () => {
    server.always('/session', { body: sessionBody() });
    controller = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      new InMemoryStorage(),
    );
    await controller.boot();
    await controller.open();
    const socket = latestSocket('/widgets');

    socket.fire('messages:read', { conversationId: 'c1', readAt: '2026-09-01T12:00:00.000Z' });
    expect(controller.agentLastReadAt.get()?.toISOString()).toBe('2026-09-01T12:00:00.000Z');

    // A SECOND agent opening the thread reports the moment THEY read it, which
    // can be earlier. Taking that literally would un-read messages the visitor
    // already watched turn read.
    socket.fire('messages:read', { conversationId: 'c1', readAt: '2026-09-01T11:00:00.000Z' });
    expect(controller.agentLastReadAt.get()?.toISOString()).toBe('2026-09-01T12:00:00.000Z');

    socket.fire('messages:read', { conversationId: 'c1', readAt: '2026-09-01T13:00:00.000Z' });
    expect(controller.agentLastReadAt.get()?.toISOString()).toBe('2026-09-01T13:00:00.000Z');
  });

  it('drops a malformed readAt rather than defaulting to now', async () => {
    server.always('/session', { body: sessionBody() });
    controller = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      new InMemoryStorage(),
    );
    await controller.boot();
    await controller.open();
    const socket = latestSocket('/widgets');
    // "now" would mark every message in the thread read on the strength of a
    // payload we could not read.
    socket.fire('messages:read', { conversationId: 'c1' });
    socket.fire('messages:read', { conversationId: 'c1', readAt: 'nonsense' });
    expect(controller.agentLastReadAt.get()).toBeNull();
  });

  it('is SEEDED from history, so the ticks are right on the first frame', async () => {
    // `messages:read` only fires while the visitor is connected to hear it. A
    // visitor who closes the app, has their messages read, and comes back gets
    // no event — but history still carries `read` per message.
    server.always('/session', {
      body: sessionBody({
        messages: [
          {
            id: 'm1',
            conversationId: 'c1',
            senderType: 'CUSTOMER',
            read: true,
            createdAt: '2026-09-01T10:00:00.000Z',
          },
          {
            id: 'm2',
            conversationId: 'c1',
            senderType: 'CUSTOMER',
            read: true,
            createdAt: '2026-09-01T11:00:00.000Z',
          },
        ],
      }),
    });
    controller = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      new InMemoryStorage(),
    );
    await controller.boot();
    await controller.open();
    expect(controller.agentLastReadAt.get()?.toISOString()).toBe('2026-09-01T11:00:00.000Z');
  });

  it('is CLEARED before a new conversation is seeded, not after', async () => {
    server.reply('/session', {
      body: sessionBody({
        conversationId: 'c1',
        messages: [
          {
            id: 'm1',
            conversationId: 'c1',
            senderType: 'CUSTOMER',
            read: true,
            createdAt: '2026-09-01T23:00:00.000Z',
          },
        ],
      }),
    });
    controller = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      new InMemoryStorage(),
    );
    await controller.boot();
    await controller.open();
    expect(controller.agentLastReadAt.get()?.toISOString()).toBe('2026-09-01T23:00:00.000Z');

    // A DIFFERENT conversation, whose own history is older. A watermark
    // carried over would outrank anything this thread has to say and show its
    // first messages as already read.
    server.always('/session', {
      body: sessionBody({
        conversationId: 'c2',
        messages: [
          {
            id: 'm9',
            conversationId: 'c2',
            senderType: 'CUSTOMER',
            createdAt: '2026-09-02T09:00:00.000Z',
          },
        ],
      }),
    });
    await controller.silentResume();
    expect(controller.agentLastReadAt.get()).toBeNull();
  });
});
