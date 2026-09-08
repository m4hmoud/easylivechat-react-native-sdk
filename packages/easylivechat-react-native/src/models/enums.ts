/**
 * Wire enums mirroring the server's Prisma enums.
 *
 * Every one carries an `unknown` member and a lenient, case-insensitive
 * `fromWire` parser: the `/widgets` socket delivers the **raw Prisma row**, so
 * a future server enum value must never crash the client — it degrades to
 * `unknown`.
 *
 * Modelled as string-literal unions rather than TS `enum`s: they are wire
 * values, they must compare cheaply against parsed JSON, and `const enum`
 * cannot cross a package boundary under `isolatedModules`.
 */

/** Case-insensitive lookup of a wire value against a set of members. */
function parseWire<T extends string>(
  members: readonly T[],
  wire: unknown,
  fallback: T,
): T {
  if (wire == null) return fallback;
  const s = String(wire).toLowerCase().trim();
  for (const v of members) {
    if (v.toLowerCase() === s) return v;
  }
  return fallback;
}

/** Who sent a message. Server (Prisma `SenderType`): AGENT | CUSTOMER | SYSTEM | BOT. */
export type SenderType = 'agent' | 'customer' | 'system' | 'bot' | 'unknown';
const SENDER_TYPES: readonly SenderType[] = ['agent', 'customer', 'system', 'bot', 'unknown'];
export const parseSenderType = (w: unknown): SenderType => parseWire(SENDER_TYPES, w, 'unknown');

/** Message body kind. Server (Prisma `MessageContentType`). */
export type MessageContentType =
  | 'text'
  | 'image'
  | 'file'
  | 'audio'
  | 'video'
  | 'sticker'
  | 'location'
  | 'template'
  | 'event'
  | 'card'
  | 'unknown';
const CONTENT_TYPES: readonly MessageContentType[] = [
  'text',
  'image',
  'file',
  'audio',
  'video',
  'sticker',
  'location',
  'template',
  'event',
  'card',
  'unknown',
];
export const parseMessageContentType = (w: unknown): MessageContentType =>
  parseWire(CONTENT_TYPES, w, 'unknown');

/** Delivery state of a message. */
export type MessageDeliveryStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'unknown';
const DELIVERY_STATUSES: readonly MessageDeliveryStatus[] = [
  'pending',
  'sent',
  'delivered',
  'read',
  'failed',
  'unknown',
];
export const parseMessageDeliveryStatus = (w: unknown): MessageDeliveryStatus =>
  parseWire(DELIVERY_STATUSES, w, 'unknown');

/** Conversation lifecycle. Server (Prisma `ConversationStatus`). */
export type ConversationStatus =
  | 'open'
  | 'pending'
  | 'closed'
  | 'snoozed'
  | 'archived'
  | 'unknown';
const CONVERSATION_STATUSES: readonly ConversationStatus[] = [
  'open',
  'pending',
  'closed',
  'snoozed',
  'archived',
  'unknown',
];
export const parseConversationStatus = (w: unknown): ConversationStatus =>
  parseWire(CONVERSATION_STATUSES, w, 'unknown');

/** Originating channel of a conversation/message. */
export type ChannelSource =
  | 'widget'
  | 'whatsapp'
  | 'messenger'
  | 'telegram'
  | 'email'
  | 'instagram'
  | 'unknown';
const CHANNEL_SOURCES: readonly ChannelSource[] = [
  'widget',
  'whatsapp',
  'messenger',
  'telegram',
  'email',
  'instagram',
  'unknown',
];
export const parseChannelSource = (w: unknown): ChannelSource =>
  parseWire(CHANNEL_SOURCES, w, 'unknown');

/** Layout direction derived from `WidgetConfig.direction` (ar/ku → rtl). */
export type LocaleDirection = 'ltr' | 'rtl';
export const parseLocaleDirection = (w: unknown): LocaleDirection =>
  String(w ?? '').toLowerCase().trim() === 'rtl' ? 'rtl' : 'ltr';

/** Pre-chat form field input type (`packages/shared` PreChatField.type). */
export type PreChatFieldType = 'text' | 'email' | 'phone' | 'number' | 'textarea' | 'select';
const PRE_CHAT_FIELD_TYPES: readonly PreChatFieldType[] = [
  'text',
  'email',
  'phone',
  'number',
  'textarea',
  'select',
];
export const parsePreChatFieldType = (w: unknown): PreChatFieldType =>
  parseWire(PRE_CHAT_FIELD_TYPES, w, 'text');

/**
 * Post-chat form field types. A superset of {@link PreChatFieldType}: the
 * survey shown after a conversation ends can also ask for a CSAT `rating` and
 * a yes/no `checkbox`.
 */
export type PostChatFieldType = PreChatFieldType | 'checkbox' | 'rating';
const POST_CHAT_FIELD_TYPES: readonly PostChatFieldType[] = [
  ...PRE_CHAT_FIELD_TYPES,
  'checkbox',
  'rating',
];
export const parsePostChatFieldType = (w: unknown): PostChatFieldType =>
  parseWire(POST_CHAT_FIELD_TYPES, w, 'text');

/** Coarse kind of a rehosted attachment, for choosing a renderer. */
export type AttachmentKind = 'image' | 'video' | 'audio' | 'file';
const ATTACHMENT_KINDS: readonly AttachmentKind[] = ['image', 'video', 'audio', 'file'];
export const parseAttachmentKind = (w: unknown): AttachmentKind =>
  parseWire(ATTACHMENT_KINDS, w, 'file');

/**
 * What a visitor is shown about the fate of their OWN message.
 *
 * Not a wire enum — there is no server field with these four values. It is the
 * answer {@link receiptFor} computes from the delivery status, the optimistic
 * flags and the conversation's read watermark, so that every host renders the
 * same four states from one rule instead of each re-deriving them.
 *
 * There is no `delivered` here on purpose. The other channels get that from a
 * provider webhook (WhatsApp, Telegram); a message to an SDK visitor is stored
 * by our own server, so "stored" and "delivered" are the same instant, and a
 * third tick state would be a distinction the visitor could never observe.
 */
export type MessageReceipt =
  /** Written locally, not yet acknowledged by the server. */
  | 'pending'
  /** Stored server-side. No agent has opened it yet. */
  | 'sent'
  /** An agent has opened the conversation and seen it. */
  | 'read'
  /** The send failed and can be retried. */
  | 'failed';
