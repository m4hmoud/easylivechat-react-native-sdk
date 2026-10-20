import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ChatMessage, parseChatMessage } from '../src/models/chat-message';
import {
  botButtonsOf,
  buttonsOpen,
  chosenButtonId,
  isSafeCardUrl,
  messageCardsOf,
  parseMessageCard,
  quickRepliesOnOffer,
  replyLabel,
} from '../src/models/message-extras';
import { SessionController } from '../src/session-controller';
import { InMemoryStorage } from '../src/storage';
import { configBody, installFakeServer, sessionBody, type FakeServer } from './fake-server';
import { latestSocket, resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * Quick replies, reply buttons (a bot's, or an agent's) and cards — ports of
 * the shared bot-buttons and message-card rules, on the shapes the server
 * stores.
 */
const row = (over: Record<string, unknown>): ChatMessage =>
  parseChatMessage({ id: 'x', conversationId: 'c1', senderType: 'AGENT', contentType: 'TEXT', createdAt: '2026-10-18T09:00:00Z', ...over });

const asked = row({
  id: 'm1',
  body: 'Call you?\n\n1. Yes\n2. No\n\nReply with the number of your choice.',
  metadata: {
    bot: {
      text: 'Call you?',
      buttons: [
        { id: 'q_1', label: 'Yes' },
        { id: 'q_2', label: 'No' },
        { id: 'not ours', label: 'Dropped' },
      ],
    },
    quickReplies: ['Yes', 'No'],
  },
});
const answer = row({
  id: 'm2',
  senderType: 'CUSTOMER',
  body: 'No',
  createdAt: '2026-10-18T09:00:01Z',
  metadata: { botReply: { messageId: 'm1', buttonId: 'q_2', label: 'No' } },
});

describe('reply buttons', () => {
  it('reads the words and the buttons, never a visitor’s message', () => {
    expect(botButtonsOf(asked)).toEqual({ text: 'Call you?', buttons: [{ id: 'q_1', label: 'Yes' }, { id: 'q_2', label: 'No' }] });
    expect(botButtonsOf(row({ senderType: 'CUSTOMER', metadata: asked.metadata }))).toBeNull();
  });

  it('are open until answered or the conversation moves on', () => {
    expect(buttonsOpen([asked], 'm1')).toBe(true);
    expect(buttonsOpen([asked, answer], 'm1')).toBe(false);
    expect(chosenButtonId([asked, answer], 'm1')).toBe('q_2');
    expect(buttonsOpen([asked, row({ id: 's', senderType: 'SYSTEM' })], 'm1')).toBe(true);
  });

  it('offer their buttons instead of the quick replies they carry for older clients', () => {
    expect(quickRepliesOnOffer([asked])).toBeNull();
    const greeting = row({ id: 'g', senderType: 'BOT', metadata: { quickReplies: ['Pricing', ' '] } });
    expect(quickRepliesOnOffer([greeting])).toEqual({ messageId: 'g', replies: ['Pricing'] });
    expect(quickRepliesOnOffer([greeting, answer])).toBeNull();
  });
});

describe('cards', () => {
  it('keep link and reply buttons, links only http(s)', () => {
    expect(parseMessageCard({
      title: 'Order',
      buttons: [
        { label: 'Track', url: 'https://e.example/t' },
        { label: 'Change date', reply: 'k9_1' },
        { label: 'Bad', url: 'javascript:alert(1)' },
      ],
    })?.buttons).toEqual([{ label: 'Track', url: 'https://e.example/t' }, { label: 'Change date', reply: 'k9_1' }]);
    expect(isSafeCardUrl('https://example.com/x')).toBe(true);
    expect(isSafeCardUrl('ftp://example.com')).toBe(false);
  });

  it('read a carousel, else one card, else none — and name the card in a carousel answer', () => {
    const carousel = row({
      contentType: 'CARD',
      metadata: {
        cards: [
          { title: 'Blue', buttons: [{ label: 'Buy', reply: 's_1' }] },
          { title: 'Red', buttons: [{ label: 'Buy', reply: 's_2' }] },
        ],
        bot: { text: 'Blue\n\nRed', buttons: [{ id: 's_1', label: 'Blue · Buy' }, { id: 's_2', label: 'Red · Buy' }] },
      },
    });
    expect(messageCardsOf(carousel).map((c) => c.title)).toEqual(['Blue', 'Red']);
    expect(replyLabel(carousel, 's_2', 'Buy')).toBe('Red · Buy');
    expect(messageCardsOf(row({ contentType: 'CARD', metadata: { card: { title: 'One' } } }))).toHaveLength(1);
    expect(messageCardsOf(row({ metadata: { card: { title: 'Not a card message' } } }))).toEqual([]);
  });
});

describe('answering a button', () => {
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

  it('sends the label as the visitor’s words with the button beside it', async () => {
    const socket = latestSocket('/widgets');
    socket.ackResponder = () => ({ ok: true, messageId: 'server-1' });
    const { optimistic, serverMessageId } = controller.sendMessage('No', { reply: { messageId: 'm1', buttonId: 'q_2' } });
    expect(optimistic.body).toBe('No');
    await serverMessageId;
    expect(socket.emitsOf('message:send').at(-1)).toEqual({ body: 'No', reply: { messageId: 'm1', buttonId: 'q_2' } });
  });

  it('sends nothing extra with an ordinary message', async () => {
    const socket = latestSocket('/widgets');
    socket.ackResponder = () => ({ ok: true, messageId: 'server-2' });
    await controller.sendMessage('hello').serverMessageId;
    expect(socket.emitsOf('message:send').at(-1)).toEqual({ body: 'hello' });
  });
});
