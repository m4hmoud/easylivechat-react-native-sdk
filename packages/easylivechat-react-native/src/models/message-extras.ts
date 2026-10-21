/**
 * What a message from the team can carry beyond its words: quick replies,
 * reply buttons (a bot flow's, or ones an agent added) and cards — one, or a
 * carousel of up to ten. Ports of `packages/shared/src/bot-buttons.ts`,
 * `message-card.ts` and the widget's `lib/quick-replies.ts`, so the web
 * widget, the Flutter SDK and this one offer the same things under the same
 * message.
 *
 * Every shape is stored in layers so a client that knows none of them still
 * reads the message (`body` has the words, every card's text and links, and a
 * numbered menu). A client that draws buttons draws `botButtonsOf(m).text` in
 * the bubble — NOT `body`, which would show the options twice.
 *
 * Re-validated here before anything is drawn, never trusted from the row: a
 * link is only ever `http:`/`https:`. That check is a regular expression,
 * not `new URL()`, whose implementation in Hermes is incomplete — it is
 * deliberately no looser than the WHATWG parser the server uses.
 */
import { isWebUrl } from '../internal/web-url';
import type { ChatMessage } from './chat-message';

// ── quick replies ─────────────────────────────────────────────────────────

/** The quick replies on offer right now, and the message they belong under. */
export interface QuickReplyOffer {
  messageId: string;
  /** Never empty, never blank; send one exactly as it is. */
  replies: string[];
}

/** `metadata.quickReplies`, blanks dropped. */
export function quickRepliesOf(m: ChatMessage): string[] {
  const raw = m.metadata?.quickReplies;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is string => typeof r === 'string' && r.trim().length > 0);
}

/**
 * The message whose quick replies are on offer, or null: only the newest
 * message offers them, until the visitor or the team says something else
 * (system notices don't count). A message with reply buttons offers its
 * buttons instead — see `botButtonsOf`.
 */
export function quickRepliesOnOffer(messages: readonly ChatMessage[]): QuickReplyOffer | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.senderType === 'system') continue;
    if (m.senderType === 'customer') return null;
    if (botButtonsOf(m)) return null;
    const replies = quickRepliesOf(m);
    return replies.length > 0 ? { messageId: m.id, replies } : null;
  }
  return null;
}

// ── reply buttons ─────────────────────────────────────────────────────────

export const MAX_BOT_BUTTONS = 10;
const BUTTON_ID = /^[A-Za-z0-9_-]{1,40}$/;

export interface BotButton {
  id: string;
  label: string;
}

/** What `metadata.bot` holds on a message with buttons. */
export interface BotButtons {
  /** The message's own words, without the numbered menu `body` carries. */
  text: string;
  buttons: BotButton[];
}

/** The visitor's answer to a message's buttons (`metadata.botReply`). */
export interface BotReply {
  messageId: string;
  buttonId: string;
  label: string;
}

function collapse(v: string): string {
  return v.replace(/\s+/g, ' ').trim();
}

/** The reply buttons under a team message, or null when it carries none. */
export function botButtonsOf(m: ChatMessage): BotButtons | null {
  if (m.senderType === 'customer' || m.senderType === 'system') return null;
  const bot = m.metadata?.bot;
  if (!bot || typeof bot !== 'object' || Array.isArray(bot)) return null;
  const r = bot as Record<string, unknown>;
  if (!Array.isArray(r.buttons)) return null;
  const buttons: BotButton[] = [];
  const seen = new Set<string>();
  for (const b of r.buttons) {
    if (!b || typeof b !== 'object') continue;
    const { id, label } = b as Record<string, unknown>;
    if (typeof id !== 'string' || !BUTTON_ID.test(id) || seen.has(id) || typeof label !== 'string') continue;
    const clean = collapse(label).slice(0, 40).trim();
    if (!clean) continue;
    seen.add(id);
    buttons.push({ id, label: clean });
    if (buttons.length >= MAX_BOT_BUTTONS) break;
  }
  if (buttons.length === 0) return null;
  return { text: typeof r.text === 'string' ? r.text : '', buttons };
}

/** On the visitor's own message: the button it answered, once the server has matched it. */
export function botReplyOf(m: ChatMessage): BotReply | null {
  const raw = m.metadata?.botReply;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.messageId !== 'string' || typeof r.buttonId !== 'string' || !BUTTON_ID.test(r.buttonId)) return null;
  return { messageId: r.messageId, buttonId: r.buttonId, label: typeof r.label === 'string' ? r.label : '' };
}

/** Which button of `messageId` the thread says was chosen, if any. */
export function chosenButtonId(messages: readonly ChatMessage[], messageId: string): string | null {
  for (const m of messages) {
    if (m.senderType !== 'customer') continue;
    const reply = botReplyOf(m);
    if (reply?.messageId === messageId) return reply.buttonId;
  }
  return null;
}

/**
 * Whether the buttons under `messageId` can still be tapped: it is the newest
 * thing anyone but the system said, and nobody has answered it.
 */
export function buttonsOpen(messages: readonly ChatMessage[], messageId: string): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.senderType === 'system') continue;
    return m.id === messageId && chosenButtonId(messages, messageId) === null;
  }
  return false;
}

/**
 * What a tap on button `id` sends as the visitor's words: the label the bot
 * layer gives it (on a carousel it names the card), else `fallback`.
 */
export function replyLabel(m: ChatMessage, id: string, fallback: string): string {
  return botButtonsOf(m)?.buttons.find((b) => b.id === id)?.label ?? fallback;
}

// ── cards ─────────────────────────────────────────────────────────────────

/** A card's button: a link (`url`), or a reply the visitor taps (`reply`, its id). */
export type MessageCardButton = { label: string; url: string; reply?: undefined } | { label: string; reply: string; url?: undefined };

export interface MessageCard {
  /** An http(s) URL, or one of the server's own `/uploads/…` paths (resolve it with `EasyLiveChat.resolveUrl`). */
  imageUrl?: string;
  title: string;
  text?: string;
  buttons: MessageCardButton[];
}

export const MAX_CARD_BUTTONS = 3;
export const MAX_CAROUSEL_CARDS = 10;
const MAX_CARD_URL = 1000;

/** A link a visitor may be sent to: http or https with a host; nothing else (see the header). */
export function isSafeCardUrl(url: unknown): url is string {
  return isWebUrl(url, MAX_CARD_URL);
}

function isCardImage(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  if (/^\/uploads\/[A-Za-z0-9._\-/]+$/.test(url) && !url.includes('..')) return true;
  return isSafeCardUrl(url);
}

function clean(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = collapse(v);
  return t ? t.slice(0, max).trim() : undefined;
}

/** A card, cleaned — or null when it has no title or is not a card's shape. */
export function parseMessageCard(raw: unknown): MessageCard | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const title = clean(r.title, 80);
  if (!title) return null;
  const card: MessageCard = { title, buttons: [] };
  const text = typeof r.text === 'string' ? r.text.trim().slice(0, 300).trim() : '';
  if (text) card.text = text;
  if (isCardImage(r.imageUrl)) card.imageUrl = r.imageUrl.trim();
  if (Array.isArray(r.buttons)) {
    const replies = new Set<string>();
    for (const b of r.buttons) {
      if (!b || typeof b !== 'object') continue;
      const button = b as Record<string, unknown>;
      const label = clean(button.label, 30);
      if (!label) continue;
      // A safe link is a link; otherwise a reply id of ours is an answer.
      if (isSafeCardUrl(button.url)) card.buttons.push({ label, url: button.url.trim() });
      else if (typeof button.reply === 'string' && BUTTON_ID.test(button.reply) && !replies.has(button.reply)) {
        replies.add(button.reply);
        card.buttons.push({ label, reply: button.reply });
      } else continue;
      if (card.buttons.length === MAX_CARD_BUTTONS) break;
    }
  }
  return card;
}

/**
 * The cards a card message draws as: its carousel (`metadata.cards`, two or
 * more), else its one card (`metadata.card`), else none — it then reads as
 * its `body`.
 */
export function messageCardsOf(m: ChatMessage): MessageCard[] {
  if (m.contentType !== 'card') return [];
  const meta = m.metadata ?? {};
  const carousel: MessageCard[] = [];
  if (Array.isArray(meta.cards)) {
    const replies = new Set<string>();
    for (const raw of meta.cards) {
      const card = parseMessageCard(raw);
      if (!card) continue;
      card.buttons = card.buttons.filter((b) => {
        if (b.reply === undefined) return true;
        if (replies.has(b.reply)) return false;
        replies.add(b.reply);
        return true;
      });
      carousel.push(card);
      if (carousel.length === MAX_CAROUSEL_CARDS) break;
    }
  }
  if (carousel.length >= 2) return carousel;
  const one = parseMessageCard(meta.card) ?? carousel[0] ?? null;
  return one ? [one] : [];
}
