import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChat } from '../src/client';
import { isEdited, parseChatMessage, parseOptionalDate } from '../src/models/chat-message';
import { type DeletedMessage, parseMessagePage, parseSessionResult } from '../src/models/results';
import { SessionController } from '../src/session-controller';
import { InMemoryStorage } from '../src/storage';
import { configBody, installFakeServer, messageRow, sessionBody, type FakeServer } from './fake-server';
import { latestSocket, resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * Port of `message_changes_test.dart`.
 *
 * An agent may edit or unsend a reply for a few minutes after sending it. The
 * visitor's copy has to follow: an edit is the same message with new words, in
 * the same place, marked as edited; an unsent message simply leaves,
 * Telegram-style, with no placeholder — and nothing that arrives late (a
 * read-receipt update, an echo) may bring it back.
 */
describe('editedAt', () => {
  it('parses the edit stamp from the socket and from history', () => {
    const m = parseChatMessage(messageRow({ editedAt: '2026-10-06T10:03:00.000Z' }));
    expect(m.editedAt?.toISOString()).toBe('2026-10-06T10:03:00.000Z');
    expect(isEdited(m)).toBe(true);
  });

  it('is undefined when absent, null or malformed — never the epoch', () => {
    expect(parseChatMessage(messageRow()).editedAt).toBeUndefined();
    expect(parseChatMessage(messageRow({ editedAt: null })).editedAt).toBeUndefined();
    const bad = parseChatMessage(messageRow({ editedAt: 'not a date' }));
    expect(bad.editedAt).toBeUndefined();
    expect(isEdited(bad)).toBe(false);
    expect(parseOptionalDate(undefined)).toBeUndefined();
  });
});

describe('an agent editing or unsending a reply', () => {
  let server: FakeServer;
  let controller: SessionController;

  const thread = [
    messageRow({ id: 'm1', senderType: 'CUSTOMER', body: 'When does it ship?', createdAt: '2026-10-06T10:00:00.000Z' }),
    messageRow({ id: 'a2', body: 'Ships Monday', senderName: 'Ava', createdAt: '2026-10-06T10:01:00.000Z' }),
    messageRow({ id: 'm3', senderType: 'CUSTOMER', body: 'Thanks', createdAt: '2026-10-06T10:02:00.000Z' }),
  ];

  beforeEach(async () => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody({ messages: thread }) });
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

  it('starts from the thread the session handed over', () => {
    expect(controller.messages.get().map((m) => m.id)).toEqual(['m1', 'a2', 'm3']);
  });

  it('replaces an edited message by id, in place, with the new words', () => {
    latestSocket('/widgets').fire(
      'message:updated',
      messageRow({
        id: 'a2',
        body: 'Ships Tuesday',
        createdAt: '2026-10-06T10:01:00.000Z',
        editedAt: '2026-10-06T10:03:00.000Z',
      }),
    );
    const list = controller.messages.get();
    expect(list.map((m) => m.id)).toEqual(['m1', 'a2', 'm3']);
    expect(list[1]?.body).toBe('Ships Tuesday');
    expect(list[1] != null && isEdited(list[1])).toBe(true);
    // The bare update did not wipe the face the bubble already had.
    expect(list[1]?.senderName).toBe('Ava');
  });

  it('removes an unsent message and keeps the rest in order', () => {
    latestSocket('/widgets').fire('message:deleted', { id: 'a2', conversationId: 'c1' });
    expect(controller.messages.get().map((m) => m.id)).toEqual(['m1', 'm3']);
  });

  it('ignores a delete for an id it does not hold, or one with no id', () => {
    const before = controller.messages.get();
    latestSocket('/widgets').fire('message:deleted', { id: 'nope', conversationId: 'c1' });
    latestSocket('/widgets').fire('message:deleted', { conversationId: 'c1' });
    latestSocket('/widgets').fire('message:deleted', null);
    expect(controller.messages.get()).toBe(before);
  });

  it('never brings an unsent message back on a late update or echo', () => {
    const socket = latestSocket('/widgets');
    socket.fire('message:deleted', { id: 'a2', conversationId: 'c1' });
    // The visitor's read receipt travels a slower path than the delete.
    socket.fire(
      'message:updated',
      messageRow({ id: 'a2', createdAt: '2026-10-06T10:01:00.000Z', readByVisitorAt: '2026-10-06T10:01:05.000Z' }),
    );
    socket.fire('message:new', messageRow({ id: 'a2', createdAt: '2026-10-06T10:01:00.000Z' }));
    expect(controller.messages.get().map((m) => m.id)).toEqual(['m1', 'm3']);
  });

  it('takes an unsent reply back off the unread badge', () => {
    const socket = latestSocket('/widgets');
    // Out of the chat view: agent replies count as unread.
    controller.phase.set('idle');
    socket.fire('message:new', messageRow({ id: 'a4', createdAt: '2026-10-06T10:04:00.000Z' }));
    socket.fire('message:new', messageRow({ id: 'a5', createdAt: '2026-10-06T10:05:00.000Z' }));
    expect(controller.unreadCount.get()).toBe(2);
    socket.fire('message:deleted', { id: 'a5', conversationId: 'c1' });
    expect(controller.unreadCount.get()).toBe(1);
    // Once read, the badge is clear and an unsend cannot push it negative.
    controller.markRead();
    socket.fire('message:deleted', { id: 'a4', conversationId: 'c1' });
    expect(controller.unreadCount.get()).toBe(0);
  });
});

/**
 * The server remembers a week of unsent ids and lists them on every history
 * response, so a visitor who was away when an agent took a reply back — socket
 * down, app suspended or closed — still sees it go.
 */
describe('unsentIds on history responses', () => {
  let server: FakeServer;
  let controller: SessionController | null = null;

  const held = [
    messageRow({ id: 'm1', senderType: 'CUSTOMER', body: 'Hi', createdAt: '2026-10-06T10:00:00.000Z' }),
    messageRow({ id: 'a2', body: 'Ships Monday', createdAt: '2026-10-06T10:01:00.000Z' }),
    messageRow({ id: 'm3', senderType: 'CUSTOMER', body: 'Thanks', createdAt: '2026-10-06T10:02:00.000Z' }),
  ];

  async function openWith(session: Record<string, unknown>): Promise<{ c: SessionController; deleted: DeletedMessage[] }> {
    server.always('/session', { body: sessionBody(session) });
    const c = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      new InMemoryStorage(),
    );
    controller = c;
    const deleted: DeletedMessage[] = [];
    c.onMessageDeleted((d) => deleted.push(d));
    await c.boot();
    await c.open();
    return { c, deleted };
  }

  beforeEach(() => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
  });

  afterEach(() => {
    controller?.dispose();
    controller = null;
    server.restore();
  });

  it('are parsed from the session and from a page; a missing field is none', () => {
    expect(parseSessionResult({ unsentIds: ['a2', 7, '', 'a3'] }).unsentIds).toEqual(['a2', 'a3']);
    expect(parseMessagePage({ messages: [], unsentIds: ['a2'] }).unsentIds).toEqual(['a2']);
    expect(parseSessionResult({}).unsentIds).toEqual([]);
    expect(parseMessagePage({ messages: [] }).unsentIds).toEqual([]);
  });

  it('a restore drops them and announces each one, with its conversation', async () => {
    const { c, deleted } = await openWith({ messages: held, unsentIds: ['a2', 'a9'] });
    expect(c.messages.get().map((m) => m.id)).toEqual(['m1', 'm3']);
    expect(deleted).toEqual([
      { id: 'a2', conversationId: 'c1' },
      { id: 'a9', conversationId: 'c1' },
    ]);
  });

  it('a page of older history takes down a message already on screen', async () => {
    const { c, deleted } = await openWith({ messages: held, nextCursor: 'm1' });
    expect(c.messages.get().map((m) => m.id)).toEqual(['m1', 'a2', 'm3']);
    server.reply('/messages', {
      body: {
        messages: [messageRow({ id: 'm0', createdAt: '2026-10-06T09:00:00.000Z' })],
        nextCursor: null,
        unsentIds: ['a2'],
      },
    });
    await c.loadOlderMessages();
    expect(c.messages.get().map((m) => m.id)).toEqual(['m0', 'm1', 'm3']);

    // Remembered: the live event for the same unsend, or a late update,
    // neither re-announces it nor brings it back.
    const socket = latestSocket('/widgets');
    socket.fire('message:deleted', { id: 'a2', conversationId: 'c1' });
    socket.fire('message:updated', messageRow({ id: 'a2', createdAt: '2026-10-06T10:01:00.000Z' }));
    expect(c.messages.get().map((m) => m.id)).toEqual(['m0', 'm1', 'm3']);
    expect(deleted.map((d) => d.id)).toEqual(['a2']);
  });

  it('the reconnect backfill takes down what went while the socket was down', async () => {
    const { c, deleted } = await openWith({ messages: held });
    const socket = latestSocket('/widgets');
    server.reply('/messages', { body: { messages: held.filter((m) => m.id !== 'a2'), nextCursor: null, unsentIds: ['a2'] } });
    socket.disconnect();
    socket.connect();
    await vi.waitFor(() => expect(c.messages.get().map((m) => m.id)).toEqual(['m1', 'm3']));
    expect(deleted.map((d) => d.id)).toEqual(['a2']);
  });

  it('an older server without the field removes nothing', async () => {
    const { c, deleted } = await openWith({ messages: held });
    server.reply('/messages', { body: { messages: [], nextCursor: null } });
    await c.loadOlderMessages();
    expect(c.messages.get().map((m) => m.id)).toEqual(['m1', 'a2', 'm3']);
    expect(deleted).toEqual([]);
  });
});

describe('EasyLiveChat.onMessageDeleted', () => {
  let server: FakeServer;

  beforeEach(() => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', {
      body: sessionBody({ messages: [messageRow({ id: 'a1', createdAt: '2026-10-06T10:00:00.000Z' })] }),
    });
  });

  afterEach(() => {
    EasyLiveChat.instance.shutdown();
    server.restore();
  });

  it('can be subscribed before boot and fires once per id', async () => {
    const elc = EasyLiveChat.instance;
    const deleted: DeletedMessage[] = [];
    const off = elc.onMessageDeleted((d) => deleted.push(d));
    await elc.boot(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      { storage: new InMemoryStorage() },
    );
    await elc.open();
    const socket = latestSocket('/widgets');
    socket.fire('message:deleted', { id: 'a1', conversationId: 'c1' });
    socket.fire('message:deleted', { id: 'a1', conversationId: 'c1' });
    expect(deleted).toEqual([{ id: 'a1', conversationId: 'c1' }]);
    expect(elc.messages.get()).toEqual([]);
    off();
  });
});
