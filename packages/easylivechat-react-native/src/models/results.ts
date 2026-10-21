import { type ChatMessage, parseChatMessages, parseDate } from './chat-message';
import { type MessageReaction, parseReactions } from './reactions';

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
  /** Messages an agent unsent in this conversation lately — see {@link MessagePage.unsentIds}. */
  unsentIds: string[];
  /**
   * The visitor is waiting in the queue for a person — with where they stand,
   * or null when they are not. Absent on an older server: not queued.
   */
  queue: QueueStatus | null;
}

/**
 * Where a visitor waiting for a person stands.
 *
 * A notice above the conversation, never a screen of its own: the visitor
 * reads what has been said and writes their question while they wait.
 */
export interface QueueStatus {
  /** 1-based place in the queue; 0 when the server has none to give. */
  position: number;
  /** The estimated wait in minutes; 0 when unknown. */
  minutes: number;
  /**
   * The workspace's queue notice, with the visitor's name, place and wait
   * already filled in BY THE SERVER, in their language — render VERBATIM.
   * May be empty.
   */
  text: string;
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
}

/** The queue as a session response states it, or null when not queued. */
function sessionQueue(raw: Record<string, unknown>): QueueStatus | null {
  if (raw.queued !== true) return null;
  return {
    position: count(raw.queuePosition),
    minutes: count(raw.queueMinutes),
    text: typeof raw.queueInfoText === 'string' ? raw.queueInfoText.trim() : '',
  };
}

/**
 * `queue:update` — the visitor's place changed, or (`assigned: true`) a person
 * took the chat and the wait is over.
 */
export interface QueueUpdate extends QueueStatus {
  assigned: boolean;
}

export function parseQueueUpdate(raw: Record<string, unknown>): QueueUpdate {
  return {
    assigned: raw.assigned === true,
    position: count(raw.position),
    minutes: count(raw.minutes),
    text: typeof raw.text === 'string' ? raw.text.trim() : '',
  };
}

/**
 * `message:reactions` — one message's reactions changed. `reactions` is the
 * message's whole list after the change, in the visitor's view.
 */
export interface ReactionsUpdate {
  conversationId: string;
  messageId: string;
  reactions: MessageReaction[];
}

export function parseReactionsUpdate(raw: Record<string, unknown>): ReactionsUpdate | null {
  const messageId = raw.messageId;
  if (typeof messageId !== 'string' || messageId.length === 0) return null;
  return {
    conversationId: String(raw.conversationId ?? ''),
    messageId,
    // A list that is not one reads as none: the event only ever carries the
    // whole list, so there is nothing on screen worth keeping against it.
    reactions: parseReactions(raw.reactions) ?? [],
  };
}

/** Socket ack for `message:react`: the message's reactions as the server now holds them. */
export interface ReactAck {
  ok: boolean;
  /** On `ok`: the visitor's view of the message's reactions. */
  reactions?: MessageReaction[];
  /** `MESSAGE_NOT_FOUND`, `NOT_REACTABLE`, `INVALID_EMOJI`, `RATE_LIMITED`, … */
  error?: string;
}

export function parseReactAck(raw: unknown): ReactAck {
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    const m = raw as Record<string, unknown>;
    const ok = m.ok === true;
    return {
      ok,
      reactions: ok ? parseReactions(m.reactions) : undefined,
      error: typeof m.error === 'string' ? m.error : undefined,
    };
  }
  return { ok: false, error: 'NO_ACK' };
}

/** Result of `POST /:slug/conversations/:id/transcript`. */
export interface TranscriptResult {
  /** Where it went, masked by the server (`j•••@example.com`). */
  sentTo: string;
}

/**
 * What `GET /:slug/visitor-email` says about emailing the visitor: the address
 * on their contact — masked, because the device may not be theirs — and
 * whether the workspace offers each email.
 */
export interface VisitorEmailState {
  /** `a•••@example.com`, or null when the contact has no address. */
  emailHint: string | null;
  /** The address asked not to be written to; the server refuses to. */
  unsubscribed: boolean;
  /** "Email me this chat" is on offer. */
  transcriptEnabled: boolean;
  /** "Get the reply by email" is on offer. */
  replyEmailEnabled: boolean;
}

/** Result of `POST /:slug/visitor-email`: the address the contact now holds. */
export interface VisitorEmailResult {
  /** Masked by the server (`j•••@example.com`). */
  emailHint: string;
}

/** Null-tolerant: an older server's missing flags read as not offered. */
export function parseVisitorEmailState(raw: Record<string, unknown>): VisitorEmailState {
  const hint = raw.emailHint;
  return {
    emailHint: typeof hint === 'string' && hint.trim().length > 0 ? hint : null,
    unsubscribed: raw.unsubscribed === true,
    transcriptEnabled: raw.transcriptEnabled === true,
    replyEmailEnabled: raw.replyEmailEnabled === true,
  };
}

function optionalString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * The ids in a response's `unsentIds`. Anything that is not one is dropped, and
 * a server that predates the field reads as none.
 */
export function parseUnsentIds(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
}

export function parseSessionResult(raw: Record<string, unknown>): SessionResult {
  return {
    token: optionalString(raw.token),
    conversationId: optionalString(raw.conversationId),
    nextCursor: optionalString(raw.nextCursor),
    resumed: raw.resumed === true,
    hasActiveConversation: raw.hasActiveConversation === true,
    messages: parseChatMessages(raw.messages),
    unsentIds: parseUnsentIds(raw.unsentIds),
    queue: sessionQueue(raw),
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
  /**
   * Messages an agent unsent in this conversation lately (the server keeps a
   * week of them). A client holding any of them takes them down — that is how
   * a visitor who was away when one went stops seeing it. Empty from a server
   * that predates the field.
   */
  unsentIds: string[];
}

export function parseMessagePage(raw: Record<string, unknown>): MessagePage {
  return {
    messages: parseChatMessages(raw.messages),
    nextCursor: optionalString(raw.nextCursor) ?? null,
    unsentIds: parseUnsentIds(raw.unsentIds),
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

/**
 * A message an agent unsent — see `EasyLiveChat.onMessageDeleted`.
 *
 * Arrives live (`message:deleted`) or, for one that went while this client was
 * not listening, from the `unsentIds` a history response carries.
 */
export interface DeletedMessage {
  /** The unsent message's id. */
  id: string;
  /** The conversation it was in. */
  conversationId: string;
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
