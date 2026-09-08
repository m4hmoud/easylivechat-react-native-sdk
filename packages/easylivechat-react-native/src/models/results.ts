import { type ChatMessage, parseChatMessages, parseDate } from './chat-message';

/**
 * Result of `POST /:slug/session`. On a `resumeOnly` call with no active
 * conversation, `token` is undefined and `hasActiveConversation` is false —
 * NEVER connect a socket without a token.
 */
export interface SessionResult {
  token?: string;
  conversationId?: string;
  nextCursor?: string;
  resumed: boolean;
  hasActiveConversation: boolean;
  messages: ChatMessage[];
}

function optionalString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function parseSessionResult(raw: Record<string, unknown>): SessionResult {
  return {
    token: optionalString(raw.token),
    conversationId: optionalString(raw.conversationId),
    nextCursor: optionalString(raw.nextCursor),
    resumed: raw.resumed === true,
    hasActiveConversation: raw.hasActiveConversation === true,
    messages: parseChatMessages(raw.messages),
  };
}

/**
 * A page of history from `GET /:slug/messages` (oldest→newest).
 *
 * `nextCursor` is the id of the *oldest* message in the page; pass it as
 * `?cursor=` to load the previous (older) page. Null when there is no more
 * history.
 */
export interface MessagePage {
  messages: ChatMessage[];
  nextCursor: string | null;
}

export function parseMessagePage(raw: Record<string, unknown>): MessagePage {
  return {
    messages: parseChatMessages(raw.messages),
    nextCursor: optionalString(raw.nextCursor) ?? null,
  };
}

/**
 * One uploaded file as returned (in an array) by `POST /api/uploads`.
 * Note the field is `mimeType` (not `mime`); `url` is server-relative.
 */
export interface UploadedFile {
  url: string;
  filename?: string;
  mimeType?: string;
  size?: number;
}

export function parseUploadedFile(raw: Record<string, unknown>): UploadedFile {
  return {
    url: String(raw.url ?? ''),
    filename: typeof raw.filename === 'string' ? raw.filename : undefined,
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : undefined,
    size: typeof raw.size === 'number' ? raw.size : undefined,
  };
}

/** Result of `POST /:slug/conversations/:id/feedback` (CSAT). */
export interface FeedbackResult {
  ok: boolean;
  rating: number;
  comment?: string;
  ratedAt: Date | null;
}

export function parseFeedbackResult(raw: Record<string, unknown>): FeedbackResult {
  return {
    ok: raw.ok !== false,
    rating: typeof raw.rating === 'number' ? Math.trunc(raw.rating) : 0,
    comment: typeof raw.comment === 'string' ? raw.comment : undefined,
    ratedAt: typeof raw.ratedAt === 'string' ? parseDate(raw.ratedAt) : null,
  };
}

/** A proactive outreach pushed by an agent (`widget:proactive-message`). */
export interface ProactiveMessage {
  conversationId: string;
  message: string;
}

export function parseProactiveMessage(raw: Record<string, unknown>): ProactiveMessage {
  return {
    conversationId: String(raw.conversationId ?? ''),
    message: String(raw.message ?? ''),
  };
}

/**
 * The visitor's locally-cached identity/profile, persisted across launches.
 *
 * `phone` is here for the same reason `name` and `email` are: `identify()`
 * used to keep it in memory only, so it survived neither an app restart nor
 * the resume path — a host that named a signed-in customer got the name
 * through and the phone nowhere. A key absent from an older cache simply
 * decodes to undefined.
 */
export interface StoredProfile {
  name?: string;
  email?: string;
  phone?: string;
  preChat?: Record<string, string>;
}

export function parseStoredProfile(raw: Record<string, unknown>): StoredProfile {
  const preChatRaw = raw.preChat;
  let preChat: Record<string, string> | undefined;
  if (preChatRaw != null && typeof preChatRaw === 'object' && !Array.isArray(preChatRaw)) {
    preChat = {};
    for (const [k, v] of Object.entries(preChatRaw as Record<string, unknown>)) {
      preChat[k] = String(v);
    }
  }
  return {
    name: typeof raw.name === 'string' ? raw.name : undefined,
    email: typeof raw.email === 'string' ? raw.email : undefined,
    phone: typeof raw.phone === 'string' ? raw.phone : undefined,
    preChat,
  };
}

/** Serialize a profile, omitting absent keys (matching the Flutter cache shape). */
export function serializeStoredProfile(profile: StoredProfile): string {
  const out: Record<string, unknown> = {};
  if (profile.name != null) out.name = profile.name;
  if (profile.email != null) out.email = profile.email;
  if (profile.phone != null) out.phone = profile.phone;
  if (profile.preChat != null) out.preChat = profile.preChat;
  return JSON.stringify(out);
}

/** Socket ack for `message:send` / `conversation:end`. */
export interface SendAck {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export function parseSendAck(raw: unknown): SendAck {
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    const m = raw as Record<string, unknown>;
    return {
      ok: m.ok !== false,
      messageId: typeof m.messageId === 'string' ? m.messageId : undefined,
      error: typeof m.error === 'string' ? m.error : undefined,
    };
  }
  return { ok: false, error: 'NO_ACK' };
}

/**
 * Returned by `EasyLiveChat.sendMessage`: the optimistic message to show
 * immediately, plus a promise resolving to the server message id on ack (or
 * rejecting with an `EasyLiveChatError`).
 */
export interface SendResult {
  optimistic: ChatMessage;
  serverMessageId: Promise<string>;
}
