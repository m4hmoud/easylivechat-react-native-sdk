import {
  type AttachmentKind,
  type MessageContentType,
  type MessageDeliveryStatus,
  type MessageReceipt,
  type SenderType,
  parseAttachmentKind,
  parseMessageContentType,
  parseMessageDeliveryStatus,
  parseSenderType,
} from './enums';

/**
 * A rehosted attachment — the rich shape the server fills in once the media
 * re-host worker runs (arrives via `message:updated`). Prefer this over the
 * flat {@link ChatMessage.attachmentUrls} when present.
 */
export interface RehostedAttachment {
  url: string;
  mime?: string;
  filename?: string;
  size?: number;
  kind: AttachmentKind;
}

/**
 * True for real, loadable URLs. A non-HTTP placeholder like `wa:media:{id}`
 * returns false and must render as an inert "media unavailable" chip — never
 * as a broken image.
 */
export function isResolvableUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/');
}

function kindFromMime(mime: string | undefined): AttachmentKind {
  const m = (mime ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'file';
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function parseRehostedAttachment(raw: Record<string, unknown>): RehostedAttachment {
  const mime = str(raw.mime) ?? str(raw.mimeType);
  return {
    url: String(raw.url ?? ''),
    mime,
    filename: str(raw.filename) ?? str(raw.name),
    size: num(raw.size),
    kind: raw.kind != null ? parseAttachmentKind(raw.kind) : kindFromMime(mime),
  };
}

/**
 * One message in a conversation.
 *
 * A plain data interface with free helper functions below, rather than a class
 * with methods: messages are copied constantly (every list mutation assigns a
 * new array of new objects) and a spread of a class instance silently loses
 * its prototype, so `msg.receiptFor(...)` would be a `TypeError` in exactly
 * the code paths that matter most. The Flutter reference uses methods because
 * Dart has `copyWith`; here the equivalent is `{ ...msg, failed: true }`.
 */
export interface ChatMessage {
  id: string;
  conversationId: string;
  tenantId?: string;
  senderAgentId?: string;

  /**
   * The replying agent's name, photo and job title.
   *
   * All three are gated server-side by the workspace's "Show agent avatars" /
   * "Show agent names" switches — they arrive undefined when the tenant has
   * turned them off, so the UI can render whatever it is given without
   * re-checking. {@link senderAvatarUrl} may be server-relative
   * (`/uploads/...`); resolve it with `EasyLiveChat.resolveUrl` before loading.
   */
  senderName?: string;
  senderAvatarUrl?: string;
  senderJobTitle?: string;

  /**
   * Body text. Note: attachment-only messages come back as the empty string
   * `''` (not null) — relevant for optimistic reconcile-by-body matching.
   */
  body?: string;

  senderType: SenderType;
  contentType: MessageContentType;

  /**
   * Flat URL list — always present (legacy + current). May contain
   * server-relative paths (`/uploads/...`) or placeholders (`wa:media:{id}`).
   */
  attachmentUrls: string[];

  /** Rich attachments — preferred when non-empty (post re-host). */
  attachments: RehostedAttachment[];

  deliveryStatus: MessageDeliveryStatus;

  /**
   * An agent has opened this message and seen it.
   *
   * Only ever true for the visitor's own messages — it is the read half of
   * their sent/read ticks. The server sends it two ways and both are parsed:
   * `read` on the trimmed REST rows, `readByAgentAt` on the raw row that comes
   * down the socket.
   *
   * A per-message flag AND a conversation-level watermark
   * (`agentLastReadAt`) both exist because they answer different questions:
   * this one is history — true for messages already read when the thread
   * loaded — while the watermark is what advances live, for messages already
   * on screen when the agent opens the conversation. {@link receiptFor} folds
   * the two together; prefer it over reading either alone.
   */
  readByAgent: boolean;

  createdAt: Date;

  /**
   * True only for a locally-created optimistic message (id starts `tmp-`),
   * before the server `message:send` ack / echo reconciles it.
   */
  isOptimistic: boolean;

  /** True when the optimistic send failed (ack `ok:false`) — UI shows retry. */
  failed: boolean;

  /**
   * Raw server metadata. SYSTEM notices carry `i18n: { key, params }` here so
   * the UI can render them in the viewer's language; {@link body} stays as the
   * workspace-language fallback. Kept as a loose map — unknown shapes must
   * never break decoding.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Parse a message from either wire shape.
 *
 * Intentionally lenient: it accepts **both** the trimmed REST shape
 * (`GET /messages`, `POST /session`) and the **raw Prisma row** delivered over
 * the `/widgets` socket (`message:new` / `message:updated`), tolerating
 * extra/unknown fields and future enum values.
 */
export function parseChatMessage(raw: Record<string, unknown>): ChatMessage {
  const attachments: RehostedAttachment[] = [];
  if (Array.isArray(raw.attachments)) {
    for (const a of raw.attachments) {
      if (a != null && typeof a === 'object') {
        attachments.push(parseRehostedAttachment(a as Record<string, unknown>));
      }
    }
  }

  const attachmentUrls: string[] = Array.isArray(raw.attachmentUrls)
    ? raw.attachmentUrls.map((u) => String(u))
    : [];

  return {
    id: String(raw.id ?? ''),
    conversationId: String(raw.conversationId ?? raw.conversation_id ?? ''),
    tenantId: raw.tenantId != null ? String(raw.tenantId) : undefined,
    senderAgentId:
      raw.senderAgentId != null
        ? String(raw.senderAgentId)
        : raw.agentId != null
          ? String(raw.agentId)
          : undefined,
    senderName: str(raw.senderName) ?? str(raw.agentName),
    senderAvatarUrl: str(raw.senderAvatarUrl) ?? str(raw.agentAvatarUrl),
    senderJobTitle: str(raw.senderJobTitle),
    body: str(raw.body),
    senderType: parseSenderType(raw.senderType),
    contentType: parseMessageContentType(raw.contentType),
    attachmentUrls,
    attachments,
    deliveryStatus: parseMessageDeliveryStatus(raw.deliveryStatus ?? raw.status),
    // `read` on the trimmed REST rows; `readByAgentAt` on the raw Prisma row
    // from the socket, where a timestamp means read and null means not.
    readByAgent: raw.read === true || raw.readByAgentAt != null,
    createdAt: parseDate(raw.createdAt ?? raw.created_at),
    isOptimistic: false,
    failed: false,
    metadata:
      raw.metadata != null && typeof raw.metadata === 'object'
        ? (raw.metadata as Record<string, unknown>)
        : undefined,
  };
}

/** Parse an array of messages from a REST/session payload, skipping non-objects. */
export function parseChatMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (m != null && typeof m === 'object') out.push(parseChatMessage(m as Record<string, unknown>));
  }
  return out;
}

/**
 * Build a local optimistic message (shown immediately on send).
 *
 * `contentType` mirrors the server's own inference: an attachment with no text
 * is a FILE, everything else is TEXT.
 */
export function optimisticMessage(args: {
  tempId: string;
  conversationId: string;
  body: string;
  attachmentUrls?: string[];
  createdAt: Date;
}): ChatMessage {
  const attachmentUrls = args.attachmentUrls ?? [];
  return {
    id: args.tempId,
    conversationId: args.conversationId,
    body: args.body,
    senderType: 'customer',
    contentType: attachmentUrls.length > 0 && args.body.trim().length === 0 ? 'file' : 'text',
    attachmentUrls,
    attachments: [],
    deliveryStatus: 'pending',
    readByAgent: false,
    createdAt: args.createdAt,
    isOptimistic: true,
    failed: false,
  };
}

/**
 * Parse a wire timestamp.
 *
 * A malformed or missing timestamp becomes **epoch 0** — deterministic, sorts
 * to the top, and stays put on re-parse. NEVER `Date.now()`: that is
 * non-deterministic and would re-order the row on every `message:updated`.
 */
export function parseDate(v: unknown): Date {
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    if (!Number.isNaN(ms)) return new Date(ms);
  }
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  return new Date(0);
}

// ── derived helpers ───────────────────────────────────────────────────────

/** The i18n key of a SYSTEM notice (`conversation.transferred`), or undefined. */
export function systemI18nKey(m: ChatMessage): string | undefined {
  const i18n = m.metadata?.i18n;
  if (i18n == null || typeof i18n !== 'object') return undefined;
  const key = (i18n as Record<string, unknown>).key;
  return key == null ? undefined : String(key);
}

/** A named param of the SYSTEM notice's i18n payload, or `''`. */
export function systemI18nParam(m: ChatMessage, name: string): string {
  const i18n = m.metadata?.i18n;
  if (i18n == null || typeof i18n !== 'object') return '';
  const params = (i18n as Record<string, unknown>).params;
  if (params == null || typeof params !== 'object') return '';
  const value = (params as Record<string, unknown>)[name];
  return value == null ? '' : String(value);
}

/**
 * A post-chat survey the customer submitted (`metadata.postChat`), or
 * undefined.
 *
 * Carried on the message so it sits where they submitted it: a thread the
 * visitor keeps coming back to holds one per visit, where the old
 * conversation-level field held one ever and pinned it to the bottom.
 */
export function postChatSubmission(m: ChatMessage): Record<string, unknown> | undefined {
  const raw = m.metadata?.postChat;
  return raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined;
}

export const isFromCustomer = (m: ChatMessage): boolean => m.senderType === 'customer';
export const isFromAgent = (m: ChatMessage): boolean => m.senderType === 'agent';

/**
 * True while this row still carries its local `tmp-` id — an optimistic send
 * not yet reconciled to a server id, even if already ack'd (which clears
 * `isOptimistic` but keeps the temp id). Used to reconcile the server echo in
 * place instead of appending a duplicate.
 */
export const isLocalTemp = (m: ChatMessage): boolean => m.id.startsWith('tmp-');

export const hasAttachments = (m: ChatMessage): boolean =>
  m.attachments.length > 0 || m.attachmentUrls.length > 0;

/**
 * What to show next to this message: nothing, or one of the four states of the
 * visitor's own send.
 *
 * `null` for anything the visitor did not write — an agent's message has no
 * receipt to show the visitor, and a system notice has no sender at all.
 *
 * `agentLastReadAt` is the conversation-level watermark; pass null if you are
 * not tracking it and only `readByAgent` decides.
 *
 * The watermark is deliberately NOT applied to a message still carrying its
 * local `tmp-` id. Its timestamp came from the device clock while the
 * watermark comes from the server's, and comparing the two across even a few
 * seconds of skew would show a message as read that no one has opened. Once
 * the server row replaces it — moments later — both sides are server time and
 * the comparison is sound.
 */
export function receiptFor(m: ChatMessage, agentLastReadAt: Date | null): MessageReceipt | null {
  if (!isFromCustomer(m)) return null;
  if (m.failed || m.deliveryStatus === 'failed') return 'failed';
  if (m.isOptimistic || m.deliveryStatus === 'pending') return 'pending';
  if (m.readByAgent || m.deliveryStatus === 'read') return 'read';
  if (
    !isLocalTemp(m) &&
    agentLastReadAt != null &&
    m.createdAt.getTime() <= agentLastReadAt.getTime()
  ) {
    return 'read';
  }
  return 'sent';
}

/** True when this row says nothing about who sent it. */
function hasNoIdentity(m: ChatMessage): boolean {
  return m.senderName == null && m.senderAvatarUrl == null && m.senderJobTitle == null;
}

/**
 * Keep the face that a bare row would erase.
 *
 * `senderName` / `senderAvatarUrl` / `senderJobTitle` are not columns — the
 * server resolves them per viewer and adds them on the way out. Only some
 * paths do: `message:updated` (a delivery receipt, a media re-host) fans out
 * the raw row, and since clients replace by id, applying it blanked the
 * agent's name and photo on a bubble that already had them. The visitor's own
 * read receipt fires that update seconds after every reply lands, so the face
 * appeared and then vanished, and only came back on restart when history was
 * read again.
 *
 * Fixed server-side; this keeps an app already in the field from being blanked
 * by a server that has not been updated yet. Identity never changes for a
 * given message, so inheriting it is always sound — and a row that does carry
 * its own always keeps it.
 *
 * Apply it in BOTH the `message:new` (already-known id) and `message:updated`
 * handlers.
 */
export function withIdentityFrom(next: ChatMessage, previous: ChatMessage): ChatMessage {
  if (!hasNoIdentity(next) || hasNoIdentity(previous)) return next;
  return {
    ...next,
    senderAgentId: next.senderAgentId ?? previous.senderAgentId,
    senderName: previous.senderName,
    senderAvatarUrl: previous.senderAvatarUrl,
    senderJobTitle: previous.senderJobTitle,
  };
}
