import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseChatMessage, withReactionsFrom } from '../src/models/chat-message';
import {
  QUICK_REACTIONS,
  canReactTo,
  groupReactions,
  myReaction,
  parseReactions,
  reactionsOf,
  sameEmoji,
  toggledReaction,
  withMyReaction,
} from '../src/models/reactions';
import { parseReactAck, parseReactionsUpdate } from '../src/models/results';
import { SessionController } from '../src/session-controller';
import { InMemoryStorage } from '../src/storage';
import { configBody, installFakeServer, messageRow, sessionBody, type FakeServer } from './fake-server';
import { latestSocket, resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * Reactions (C1), as the visitor sees them — the widget's `lib/reactions.ts`
 * and the `/widgets` socket's `message:react` / `message:reactions`
 * (apps/api server.ts, services/reactions.ts).
 */
describe('the reactions model', () => {
  it('offers the same quick six as every client, in order', () => {
    expect([...QUICK_REACTIONS]).toEqual(['👍', '❤️', '😂', '😮', '😢', '🙏']);
  });

  it('reads only well-formed entries off the wire', () => {
    expect(
      parseReactions([
        { emoji: '👍', by: 'customer' },
        { emoji: '', by: 'agent' },
        { by: 'agent' },
        'x',
        null,
        { emoji: '❤️', by: 'robot' },
        { emoji: 'x'.repeat(33), by: 'agent' },
        { emoji: '🙏', by: 'agent', agentId: 'a1', name: 'Ava' },
      ]),
    ).toEqual([
      { emoji: '👍', by: 'customer' },
      // Never an agent's id or name, even if a server sent one.
      { emoji: '🙏', by: 'agent' },
    ]);
  });

  it('tells "no list on the wire" apart from "no reactions left"', () => {
    expect(parseReactions(undefined)).toBeUndefined();
    expect(parseReactions(null)).toBeUndefined();
    expect(parseReactions({})).toBeUndefined();
    expect(parseReactions([])).toEqual([]);
    expect(parseChatMessage(messageRow()).reactions).toBeUndefined();
    expect(parseChatMessage(messageRow({ reactions: [] })).reactions).toEqual([]);
    expect(reactionsOf(parseChatMessage(messageRow()))).toEqual([]);
  });

  it('parses the reactions on history and live rows', () => {
    const m = parseChatMessage(messageRow({ reactions: [{ emoji: '😂', by: 'customer' }] }));
    expect(m.reactions).toEqual([{ emoji: '😂', by: 'customer' }]);
    expect(myReaction(m)).toBe('😂');
  });

  it('one of the visitor’s own: another replaces it, the same takes it back', () => {
    const m = parseChatMessage(messageRow({ reactions: [{ emoji: '👍', by: 'customer' }] }));
    expect(toggledReaction(m, '👍')).toBeNull();
    expect(toggledReaction(m, '❤️')).toBe('❤️');
    expect(withMyReaction(m.reactions, '❤️')).toEqual([{ emoji: '❤️', by: 'customer' }]);
    expect(withMyReaction(m.reactions, null)).toEqual([]);
  });

  it('keeps the team’s reactions when the visitor reacts', () => {
    expect(withMyReaction([{ emoji: '👍', by: 'agent' }], '😂')).toEqual([
      { emoji: '👍', by: 'agent' },
      { emoji: '😂', by: 'customer' },
    ]);
  });

  it('treats ❤ and ❤️ as the same emoji', () => {
    expect(sameEmoji('❤', '❤️')).toBe(true);
    expect(sameEmoji('❤️', '👍')).toBe(false);
    expect(sameEmoji(null, '👍')).toBe(false);
    const m = parseChatMessage(messageRow({ reactions: [{ emoji: '❤', by: 'customer' }] }));
    expect(toggledReaction(m, '❤️')).toBeNull();
  });

  it('groups chips by emoji in the order first used, marking the visitor’s', () => {
    expect(
      groupReactions([
        { emoji: '👍', by: 'agent' },
        { emoji: '❤️', by: 'agent' },
        { emoji: '👍', by: 'agent' },
        { emoji: '❤', by: 'customer' },
      ]),
    ).toEqual([
      { emoji: '👍', count: 2, mine: false },
      { emoji: '❤️', count: 2, mine: true },
    ]);
  });

  it('lets the visitor react to the team’s messages only, once the server has them', () => {
    expect(canReactTo(parseChatMessage(messageRow({ senderType: 'AGENT' })))).toBe(true);
    expect(canReactTo(parseChatMessage(messageRow({ senderType: 'BOT' })))).toBe(true);
    // The automatic greeting reaches the SDK as `AUTOMATED` (→ unknown).
    expect(canReactTo(parseChatMessage(messageRow({ senderType: 'AUTOMATED' })))).toBe(true);
    expect(canReactTo(parseChatMessage(messageRow({ senderType: 'CUSTOMER' })))).toBe(false);
    expect(canReactTo(parseChatMessage(messageRow({ senderType: 'SYSTEM' })))).toBe(false);
    expect(canReactTo(parseChatMessage(messageRow({ id: 'tmp-1' })))).toBe(false);
  });

  it('keeps the reactions a row without any would erase', () => {
    const held = parseChatMessage(messageRow({ reactions: [{ emoji: '👍', by: 'customer' }] }));
    const bare = parseChatMessage(messageRow({ body: 'edited' }));
    expect(withReactionsFrom(bare, held).reactions).toEqual([{ emoji: '👍', by: 'customer' }]);
    // An explicit empty list is the last one taken back, and wins.
    const cleared = parseChatMessage(messageRow({ reactions: [] }));
    expect(withReactionsFrom(cleared, held).reactions).toEqual([]);
  });

  it('reads the live event and the ack defensively', () => {
    expect(parseReactionsUpdate({ conversationId: 'c1', messageId: 'a1', reactions: [{ emoji: '👍', by: 'agent' }] })).toEqual({
      conversationId: 'c1',
      messageId: 'a1',
      reactions: [{ emoji: '👍', by: 'agent' }],
    });
    expect(parseReactionsUpdate({ conversationId: 'c1' })).toBeNull();
    expect(parseReactionsUpdate({ messageId: 'a1', reactions: 'nope' })?.reactions).toEqual([]);
    expect(parseReactAck({ ok: true, reactions: [] })).toEqual({ ok: true, reactions: [], error: undefined });
    expect(parseReactAck({ ok: false, error: 'NOT_REACTABLE' })).toEqual({
      ok: false,
      reactions: undefined,
      error: 'NOT_REACTABLE',
    });
    expect(parseReactAck(undefined)).toEqual({ ok: false, error: 'NO_ACK' });
  });
});

describe('reacting, and reactions arriving live', () => {
  let server: FakeServer;
  let controller: SessionController;

  const thread = [
    messageRow({ id: 'm1', senderType: 'CUSTOMER', body: 'Is it in stock?', createdAt: '2026-10-18T10:00:00.000Z' }),
    messageRow({ id: 'a2', body: 'It is!', senderName: 'Ava', createdAt: '2026-10-18T10:01:00.000Z' }),
  ];

  const held = (id: string) => controller.messages.get().find((m) => m.id === id);

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

  it('emits `message:react` with the message and the emoji', async () => {
    const socket = latestSocket('/widgets');
    socket.ackResponder = (event) =>
      event === 'message:react' ? { ok: true, reactions: [{ emoji: '👍', by: 'customer' }] } : undefined;
    await expect(controller.react('a2', '👍')).resolves.toBe(true);
    expect(socket.emitsOf('message:react')).toEqual([{ messageId: 'a2', emoji: '👍' }]);
    expect(held('a2')?.reactions).toEqual([{ emoji: '👍', by: 'customer' }]);
  });

  it('shows it at once, before the server answers', async () => {
    const socket = latestSocket('/widgets');
    const pending = controller.react('a2', '❤️');
    expect(held('a2')?.reactions).toEqual([{ emoji: '❤️', by: 'customer' }]);
    socket.pendingAcks[0]?.respond({ ok: true, reactions: [{ emoji: '❤️', by: 'customer' }] });
    await expect(pending).resolves.toBe(true);
  });

  it('takes the server’s list as final', async () => {
    const socket = latestSocket('/widgets');
    // The visitor's other device already reacted; the server says what it holds.
    socket.ackResponder = () => ({ ok: true, reactions: [{ emoji: '😂', by: 'customer' }] });
    await controller.react('a2', '😂');
    expect(held('a2')?.reactions).toEqual([{ emoji: '😂', by: 'customer' }]);
  });

  it('puts it back when the server says no', async () => {
    const socket = latestSocket('/widgets');
    socket.fire('message:reactions', { conversationId: 'c1', messageId: 'a2', reactions: [{ emoji: '👍', by: 'customer' }] });
    socket.ackResponder = () => ({ ok: false, error: 'RATE_LIMITED' });
    await expect(controller.react('a2', '🙏')).resolves.toBe(false);
    expect(held('a2')?.reactions).toEqual([{ emoji: '👍', by: 'customer' }]);
  });

  it('takes the visitor’s reaction back with null', async () => {
    const socket = latestSocket('/widgets');
    socket.fire('message:reactions', { conversationId: 'c1', messageId: 'a2', reactions: [{ emoji: '👍', by: 'customer' }] });
    socket.ackResponder = () => ({ ok: true, reactions: [] });
    await expect(controller.react('a2', null)).resolves.toBe(true);
    expect(socket.emitsOf('message:react')).toEqual([{ messageId: 'a2', emoji: null }]);
    expect(held('a2')?.reactions).toEqual([]);
  });

  it('refuses without asking the server: own messages, unknown ids, no socket', async () => {
    const socket = latestSocket('/widgets');
    await expect(controller.react('m1', '👍')).resolves.toBe(false);
    await expect(controller.react('nope', '👍')).resolves.toBe(false);
    await expect(controller.react('a2', '')).resolves.toBe(false);
    socket.disconnect();
    await expect(controller.react('a2', '👍')).resolves.toBe(false);
    expect(socket.emitsOf('message:react')).toEqual([]);
    expect(held('a2')?.reactions).toBeUndefined();
  });

  it('applies the team’s reaction on the visitor’s message, live', () => {
    const socket = latestSocket('/widgets');
    const before = controller.messages.get();
    socket.fire('message:reactions', { conversationId: 'c1', messageId: 'm1', reactions: [{ emoji: '👍', by: 'agent' }] });
    expect(held('m1')?.reactions).toEqual([{ emoji: '👍', by: 'agent' }]);
    // A new list, every other row as it was.
    expect(controller.messages.get()).not.toBe(before);
    expect(held('a2')).toBe(before[1]);
  });

  it('is not a message: no unread, no message event', () => {
    const socket = latestSocket('/widgets');
    controller.phase.set('idle');
    const heard: string[] = [];
    controller.onMessage((m) => heard.push(m.id));
    socket.fire('message:reactions', { conversationId: 'c1', messageId: 'a2', reactions: [{ emoji: '👍', by: 'customer' }] });
    expect(controller.unreadCount.get()).toBe(0);
    expect(heard).toEqual([]);
  });

  it('ignores an event for a message it does not hold, or another conversation', () => {
    const socket = latestSocket('/widgets');
    const before = controller.messages.get();
    socket.fire('message:reactions', { conversationId: 'c1', messageId: 'zz', reactions: [] });
    socket.fire('message:reactions', { conversationId: 'c9', messageId: 'a2', reactions: [{ emoji: '👍', by: 'customer' }] });
    socket.fire('message:reactions', { reactions: [] });
    socket.fire('message:reactions', null);
    expect(controller.messages.get()).toBe(before);
  });

  it('keeps reactions through an update that carries none', () => {
    const socket = latestSocket('/widgets');
    socket.fire('message:reactions', { conversationId: 'c1', messageId: 'a2', reactions: [{ emoji: '👍', by: 'customer' }] });
    // An edit on a server older than reactions, or a partial row.
    socket.fire('message:updated', messageRow({ id: 'a2', body: 'It is! Two left.', createdAt: '2026-10-18T10:01:00.000Z' }));
    expect(held('a2')?.body).toBe('It is! Two left.');
    expect(held('a2')?.reactions).toEqual([{ emoji: '👍', by: 'customer' }]);
    // …and through a re-delivery of the same message.
    socket.fire('message:new', messageRow({ id: 'a2', body: 'It is! Two left.', createdAt: '2026-10-18T10:01:00.000Z' }));
    expect(held('a2')?.reactions).toEqual([{ emoji: '👍', by: 'customer' }]);
  });

  it('takes an update’s own list when it has one', () => {
    const socket = latestSocket('/widgets');
    socket.fire('message:reactions', { conversationId: 'c1', messageId: 'a2', reactions: [{ emoji: '👍', by: 'customer' }] });
    socket.fire('message:updated', messageRow({ id: 'a2', reactions: [], createdAt: '2026-10-18T10:01:00.000Z' }));
    expect(held('a2')?.reactions).toEqual([]);
  });
});
