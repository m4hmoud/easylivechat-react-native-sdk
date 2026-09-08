import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChatErrorCode } from '../src/errors';
import { isLocalTemp } from '../src/models/chat-message';
import { SessionController } from '../src/session-controller';
import { InMemoryStorage } from '../src/storage';
import { configBody, installFakeServer, messageRow, sessionBody, type FakeServer } from './fake-server';
import { latestSocket, resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * Port-specific: the optimistic send/reconcile path.
 *
 * The widget protocol does NOT echo a `clientId`, so our own message has to be
 * recognised by (trimmed) body against the oldest still-unreconciled `tmp-`
 * row — which is only correct if consuming one really does consume it.
 */
describe('optimistic send and reconcile', () => {
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
  });

  afterEach(() => {
    controller.dispose();
    server.restore();
  });

  it('shows the bubble immediately, before any ack', () => {
    const socket = latestSocket('/widgets');
    socket.ackResponder = () => undefined; // never acks
    const { optimistic } = controller.sendMessage('hello');
    expect(optimistic.id).toMatch(/^tmp-/);
    expect(optimistic.deliveryStatus).toBe('pending');
    expect(controller.messages.get().map((m) => m.id)).toContain(optimistic.id);
  });

  it('reconciles the temp row to the server id on ack', async () => {
    const socket = latestSocket('/widgets');
    socket.ackResponder = () => ({ ok: true, messageId: 'server-1' });
    const { serverMessageId } = controller.sendMessage('hello');
    await expect(serverMessageId).resolves.toBe('server-1');
    const ids = controller.messages.get().map((m) => m.id);
    expect(ids).toEqual(['server-1']);
    expect(controller.messages.get()[0]?.isOptimistic).toBe(false);
  });

  it('keeps the temp id when the ack carries none, and still reconciles the echo', async () => {
    const socket = latestSocket('/widgets');
    socket.ackResponder = () => ({ ok: true });
    const { optimistic, serverMessageId } = controller.sendMessage('hello');
    await serverMessageId;

    // Ack'd but id-less: `isOptimistic` is cleared while the `tmp-` id stays,
    // which is exactly why the echo matcher keys on the ID, not on the flag.
    const row = controller.messages.get()[0];
    expect(row?.id).toBe(optimistic.id);
    expect(row?.isOptimistic).toBe(false);
    expect(isLocalTemp(row!)).toBe(true);

    socket.fire('message:new', messageRow({ id: 'server-1', body: 'hello', senderType: 'CUSTOMER' }));
    expect(controller.messages.get().map((m) => m.id)).toEqual(['server-1']);
  });

  it('reconciles two identical sends FIFO, without duplicating', async () => {
    const socket = latestSocket('/widgets');
    socket.ackResponder = () => undefined; // no acks: only the echoes reconcile
    controller.sendMessage('same');
    controller.sendMessage('same');
    expect(controller.messages.get()).toHaveLength(2);

    // Echoes arrive; each consumes the OLDEST remaining temp with that body.
    socket.fire('message:new', messageRow({ id: 's1', body: 'same', senderType: 'CUSTOMER', createdAt: '2026-09-01T10:00:01.000Z' }));
    socket.fire('message:new', messageRow({ id: 's2', body: 'same', senderType: 'CUSTOMER', createdAt: '2026-09-01T10:00:02.000Z' }));

    const ids = controller.messages.get().map((m) => m.id);
    expect(ids).toEqual(['s1', 's2']);
    expect(ids.filter((id) => id.startsWith('tmp-'))).toHaveLength(0);
  });

  it('matches on the TRIMMED body', () => {
    const socket = latestSocket('/widgets');
    socket.ackResponder = () => undefined;
    controller.sendMessage('  padded  ');
    socket.fire('message:new', messageRow({ id: 's1', body: 'padded', senderType: 'CUSTOMER' }));
    expect(controller.messages.get().map((m) => m.id)).toEqual(['s1']);
  });

  it('appends an agent message rather than reconciling it', () => {
    const socket = latestSocket('/widgets');
    socket.ackResponder = () => undefined;
    controller.sendMessage('hello');
    socket.fire('message:new', messageRow({ id: 'a1', body: 'hello', senderType: 'AGENT' }));
    expect(controller.messages.get()).toHaveLength(2);
  });

  it('drops the temp when the live echo beat the ack', () => {
    const socket = latestSocket('/widgets');
    // No synchronous ack: the emit parks its callback so we can answer AFTER
    // the echo has already landed.
    socket.ackResponder = () => undefined;
    const { optimistic } = controller.sendMessage('race');

    socket.fire(
      'message:new',
      messageRow({ id: 'server-race', body: 'race', senderType: 'CUSTOMER' }),
    );
    // The echo already consumed the temp row.
    expect(controller.messages.get().map((m) => m.id)).toEqual(['server-race']);

    // The late ack must NOT resurrect it or duplicate the server row.
    socket.pendingAcks[0]?.respond({ ok: true, messageId: 'server-race' });
    const ids = controller.messages.get().map((m) => m.id);
    expect(ids).toEqual(['server-race']);
    expect(ids).not.toContain(optimistic.id);
  });

  it('marks the bubble failed when the server rejects the send', async () => {
    const socket = latestSocket('/widgets');
    socket.ackResponder = () => ({ ok: false, error: 'CONVERSATION_CLOSED' });
    const { optimistic, serverMessageId } = controller.sendMessage('nope');
    await expect(serverMessageId).rejects.toMatchObject({
      code: EasyLiveChatErrorCode.SEND_REJECTED,
    });
    const row = controller.messages.get().find((m) => m.id === optimistic.id);
    expect(row?.failed).toBe(true);
    expect(row?.deliveryStatus).toBe('failed');
  });

  it('fails immediately with NO_TOKEN when there is no socket', async () => {
    controller.closeSession();
    const { optimistic, serverMessageId } = controller.sendMessage('offline');
    await expect(serverMessageId).rejects.toMatchObject({
      code: EasyLiveChatErrorCode.NO_TOKEN,
    });
    expect(controller.messages.get().find((m) => m.id === optimistic.id)?.failed).toBe(true);
  });

  it('resend() drops the failed row and sends afresh', async () => {
    const socket = latestSocket('/widgets');
    socket.ackResponder = () => ({ ok: false, error: 'NOPE' });
    const first = controller.sendMessage('retry me');
    await first.serverMessageId.catch(() => '');
    const failed = controller.messages.get().find((m) => m.failed);
    expect(failed).toBeDefined();

    socket.ackResponder = () => ({ ok: true, messageId: 'server-2' });
    const again = controller.resend(failed!);
    expect(again).not.toBeNull();
    await again!.serverMessageId;
    expect(controller.messages.get().map((m) => m.id)).toEqual(['server-2']);

    // A message that is not failed cannot be resent.
    expect(controller.resend(controller.messages.get()[0]!)).toBeNull();
  });

  it('keeps the list immutable and re-referenced on every mutation', () => {
    const socket = latestSocket('/widgets');
    socket.ackResponder = () => undefined;
    const before = controller.messages.get();
    controller.sendMessage('x');
    const after = controller.messages.get();
    // `useSyncExternalStore` compares by reference; an in-place push renders
    // nothing.
    expect(after).not.toBe(before);
    expect(Object.isFrozen(after)).toBe(true);
  });

  it('sorts by createdAt with ties broken by id', () => {
    const socket = latestSocket('/widgets');
    socket.fire('message:new', messageRow({ id: 'b', createdAt: '2026-09-01T10:00:00.000Z' }));
    socket.fire('message:new', messageRow({ id: 'a', createdAt: '2026-09-01T10:00:00.000Z' }));
    socket.fire('message:new', messageRow({ id: 'c', createdAt: '2026-09-01T09:00:00.000Z' }));
    expect(controller.messages.get().map((m) => m.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('unread counting', () => {
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
  });

  afterEach(() => {
    controller.dispose();
    server.restore();
  });

  it('counts only agent replies, and only outside the chat/feedback phases', () => {
    const socket = latestSocket('/widgets');
    // In `chat`: the visitor is looking at it.
    socket.fire('message:new', messageRow({ id: 'a1', senderType: 'AGENT' }));
    expect(controller.unreadCount.get()).toBe(0);

    controller.phase.set('idle');
    socket.fire('message:new', messageRow({ id: 'a2', senderType: 'AGENT' }));
    expect(controller.unreadCount.get()).toBe(1);

    // Never our own echoes, never system/bot rows.
    socket.fire('message:new', messageRow({ id: 'c1', senderType: 'CUSTOMER', body: 'mine' }));
    socket.fire('message:new', messageRow({ id: 's1', senderType: 'SYSTEM' }));
    socket.fire('message:new', messageRow({ id: 'b1', senderType: 'BOT' }));
    expect(controller.unreadCount.get()).toBe(1);

    controller.phase.set('feedback');
    socket.fire('message:new', messageRow({ id: 'a3', senderType: 'AGENT' }));
    expect(controller.unreadCount.get()).toBe(1);
  });

  it('markRead clears the badge AND tells the server', () => {
    const socket = latestSocket('/widgets');
    controller.phase.set('idle');
    socket.fire('message:new', messageRow({ id: 'a1', senderType: 'AGENT' }));
    expect(controller.unreadCount.get()).toBe(1);

    controller.markRead();
    expect(controller.unreadCount.get()).toBe(0);
    // Without the server half a message sits on a permanent single check and
    // no agent can tell read from ignored.
    expect(socket.emitsOf('messages:seen')).toHaveLength(1);
  });
});
