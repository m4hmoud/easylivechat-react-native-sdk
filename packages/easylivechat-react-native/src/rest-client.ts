import type { ResolvedConfig } from './config';
import { EasyLiveChatError, EasyLiveChatErrorCode, errorForResponse } from './errors';
import {
  type FeedbackResult,
  type MessagePage,
  type SessionResult,
  type TranscriptResult,
  type UploadedFile,
  type VisitorEmailResult,
  type VisitorEmailState,
  parseFeedbackResult,
  parseMessagePage,
  parseSessionResult,
  parseUploadedFile,
  parseVisitorEmailState,
} from './models/results';
import {
  type HelpArticle,
  type HelpArticleList,
  type HelpViewResult,
  parseHelpArticle,
  parseHelpArticleList,
} from './models/help-articles';
import { type ConfigResponse, parseConfigResponse } from './models/widget-config';

/**
 * Future-proof protocol version header sent on every request. The server
 * currently ignores it (harmless); it lets the wire be versioned later.
 */
const PROTOCOL_VERSION_HEADER = 'X-EasyLiveChat-Protocol-Version';
const PROTOCOL_VERSION = '1';

/**
 * Uploads run up to the server's 25 MB limit; the 20s connect default aborts a
 * large file on a slow cellular link. Give the body its own generous window,
 * independent of the connect/receive defaults.
 */
const UPLOAD_TIMEOUT_MS = 120_000;

/** Anything the upload path can turn into a multipart part. */
export type UploadSource = Blob | ArrayBuffer | Uint8Array | { uri: string };

export interface UploadArgs {
  token: string;
  data: UploadSource;
  filename: string;
  contentType?: string;
  onProgress?: (progress: number) => void;
}

export interface SessionArgs {
  visitorId: string;
  name?: string;
  email?: string;
  phone?: string;
  page?: string;
  locale?: string;
  resumeOnly?: boolean;
  fields?: Record<string, string>;
  /**
   * The host application's OWN user id, for identity verification. Sent as
   * the top-level `userId` key; omitted when blank.
   */
  userId?: string;
  /**
   * `HMAC_SHA256(identitySecret, userId)` as hex, computed by the host's
   * BACKEND. Sent as the top-level `userHash` key; omitted when blank.
   */
  userHash?: string;
  /**
   * The ids of the consent fields the visitor ticked, possibly none. Set, it
   * also declares `capabilities: ['consent']`, which is what lets the server
   * refuse a required one left unticked with `400 CONSENT_REQUIRED` +
   * `fieldId`. Unset sends neither, and the server asks nothing about consent
   * — the request an SDK made before consent existed.
   */
  consents?: readonly string[];
}

/**
 * The device platform the deprecated `setPushToken` took. Kept so a host that
 * still calls it keeps compiling; the SDK no longer registers devices.
 *
 * @deprecated App notifications are your server's job now, driven by the
 * workspace's `message.created` webhook — see `EasyLiveChat.setPushToken`.
 */
export type PushPlatform = 'IOS' | 'ANDROID';

/** Arguments of `GET /help/articles`. */
export interface HelpListArgs {
  /** Two or more characters search; less (or none) lists the top articles. */
  q?: string;
  category?: string;
  limit?: number;
}

/**
 * What a client declares when it can show a consent checkbox: `?caps=` on
 * `GET /config`, `capabilities` on `POST /session` and `/offline-form`
 * (`CONSENT_CAPABILITY` in `packages/shared/src/pre-chat-form.ts`).
 */
export const CONSENT_CAPABILITY = 'consent';

/**
 * The `capabilities` + `consents` pair, or nothing. Always sent together: the
 * ids mean nothing to the server without the declaration, and the declaration
 * alone would make it demand consent the caller never said it collected.
 * Duplicates are dropped.
 */
function consentBody(consents: readonly string[] | undefined): Record<string, unknown> {
  if (consents == null) return {};
  return { capabilities: [CONSENT_CAPABILITY], consents: [...new Set(consents)] };
}

/**
 * 1:1 wrapper over the widget HTTP endpoints + `/api/uploads`.
 *
 * Base: `<apiBase>/api/widget`, tenant resolved by `:slug`. JWT-gated calls
 * (`GET /messages`, feedback, post-chat, uploads) take a Bearer token
 * argument. All `{ error, fieldId, message }` bodies decode to
 * {@link EasyLiveChatError}; transport failures map to `NETWORK`.
 */
export class RestClient {
  constructor(readonly config: ResolvedConfig) {}

  private get base(): string {
    return `${this.config.normalizedApiBase}/api/widget`;
  }

  private get slug(): string {
    return this.config.tenantSlug;
  }

  private headers(token?: string): Record<string, string> {
    const h: Record<string, string> = {
      [PROTOCOL_VERSION_HEADER]: PROTOCOL_VERSION,
      accept: 'application/json',
    };
    if (token != null && token.length > 0) h.authorization = `Bearer ${token}`;
    return h;
  }

  /**
   * `fetch` with a timeout and typed failure decoding. Non-2xx bodies become
   * {@link EasyLiveChatError}; anything the transport threw becomes `NETWORK`.
   */
  private async request(
    url: string,
    init: RequestInit,
    timeoutMs = this.config.connectTimeoutMs,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (e) {
      throw new EasyLiveChatError(EasyLiveChatErrorCode.NETWORK, {
        message: e instanceof Error ? e.message : String(e),
        cause: e,
      });
    } finally {
      clearTimeout(timer);
    }

    const body = await readJson(response);
    if (!response.ok) throw errorForResponse(response.status, body);
    return body;
  }

  private async getJson(
    path: string,
    query: Record<string, string | number | undefined>,
    token?: string,
  ): Promise<unknown> {
    const qs = buildQuery(query);
    return this.request(`${path}${qs}`, { method: 'GET', headers: this.headers(token) });
  }

  private async postJson(
    path: string,
    body: unknown,
    token?: string,
  ): Promise<unknown> {
    return this.request(path, {
      method: 'POST',
      headers: { ...this.headers(token), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /**
   * `GET /:slug/config?channel=&origin=&locale=` — public.
   *
   * The `channel` parameter belongs here, not only on the session call: the
   * server resolves per-channel overrides from exactly this parameter.
   * Omitting it means the app gets workspace defaults for the welcome screen,
   * the queue and offline text, and the pre-chat form, while the dashboard
   * shows an inbox configured differently and nobody can see why changing it
   * makes no difference.
   *
   * `origin` is usually omitted on native — the server's `allowedOrigins` gate
   * is skipped entirely when no origin is supplied.
   *
   * `consent: true` adds `caps=consent`. Without it the server leaves consent
   * fields out of the pre-chat form, because a client that cannot draw a
   * checkbox would draw a text box labelled "I agree to…" instead. A server
   * that predates consent ignores the parameter.
   */
  async getConfig(options: { consent?: boolean } = {}): Promise<ConfigResponse> {
    const raw = await this.getJson(`${this.base}/${this.slug}/config`, {
      caps: options.consent === true ? CONSENT_CAPABILITY : undefined,
      channel: emptyToUndefined(this.config.channel),
      origin: emptyToUndefined(this.config.originHeader),
      // The CONTENT locale: which translation of the tenant's own copy to
      // return. `config.locale` is the free-form display value agents see.
      locale: emptyToUndefined(this.config.contentLocale),
    });
    return parseConfigResponse(asRecord(raw));
  }

  /**
   * `POST /:slug/session` — public; MINTS the widget JWT.
   *
   * On a `resumeOnly: true` call with no active conversation the response
   * carries no `token` and `hasActiveConversation: false`. Returned as-is —
   * never connect a socket without a token. On pre-chat validation failure the
   * server answers `400 { error, fieldId }`, which decodes to a typed error.
   */
  async postSession(args: SessionArgs): Promise<SessionResult> {
    const body: Record<string, unknown> = { visitorId: args.visitorId };
    if (args.name != null) body.name = args.name;
    if (args.email != null) body.email = args.email;
    // Omitted when blank, matching the server's expectations for an absent
    // value versus an explicit empty one.
    if (args.phone != null && args.phone.trim().length > 0) body.phone = args.phone;
    if (args.page != null) body.page = args.page;

    // Prefer the explicit per-call locale, fall back to config.locale.
    const locale = args.locale ?? this.config.locale;
    if (locale != null) body.locale = locale;

    // The locale CODE. `locale` above is free-form — hosts put a readable
    // language name there because it is what agents see — so the server cannot
    // match it against anything. This is what picks the visitor's language for
    // the auto-greeting and the tenant's own copy.
    if (emptyToUndefined(this.config.contentLocale) != null) {
      body.contentLocale = this.config.contentLocale;
    }
    // Channel/inbox routing key — omitted when absent (server ⇒ default).
    if (this.config.channel != null) body.channel = this.config.channel;
    // Client-provided custom attributes (device/app info). Stored as-is by the
    // server; not validated like pre-chat fields.
    if (this.config.attributes != null && Object.keys(this.config.attributes).length > 0) {
      body.attributes = this.config.attributes;
    }
    if (args.resumeOnly === true) body.resumeOnly = true;

    // Open on the visit being started, not on every visit ever made. A
    // returning customer lands back in a conversation that can span months,
    // and handing them all of it at once buries what they came back for.
    // Earlier visits stay one scroll up, behind the cursor.
    body.historyScope = 'session';

    if (args.fields != null && Object.keys(args.fields).length > 0) body.fields = args.fields;
    Object.assign(body, consentBody(args.consents));

    // Identity verification. Both keys go on EVERY session call — the silent
    // resume as much as the start — because the server checks the claim on
    // each one, and a resume is what most returning visitors ever send. Blank
    // values are omitted rather than sent empty: an empty `userId` is no claim.
    const userId = emptyToUndefined(args.userId?.trim());
    const userHash = emptyToUndefined(args.userHash?.trim());
    if (userId != null) body.userId = userId;
    if (userHash != null) body.userHash = userHash;

    const raw = await this.postJson(`${this.base}/${this.slug}/session`, body);
    return parseSessionResult(asRecord(raw));
  }

  /**
   * `POST /:slug/resume-link { token }` — public. Trades the token in an
   * emailed "Reply in the chat" link for the visitor id that reaches its
   * conversation, which the client then adopts and resumes as. `410
   * LINK_INVALID` for a link that has expired, is another workspace's, or
   * names a chat that is gone.
   */
  async postResumeLink(token: string): Promise<{ visitorId: string; conversationId: string | null }> {
    const raw = asRecord(await this.postJson(`${this.base}/${this.slug}/resume-link`, { token }));
    const visitorId = typeof raw.visitorId === 'string' ? raw.visitorId.trim() : '';
    if (visitorId.length === 0) {
      // A 2xx without a visitor is a protocol violation, not a visitor to adopt.
      throw new EasyLiveChatError(EasyLiveChatErrorCode.UNKNOWN, {
        message: 'POST /resume-link response missing a `visitorId`.',
      });
    }
    const conversationId = raw.conversationId;
    return {
      visitorId,
      conversationId:
        typeof conversationId === 'string' && conversationId.length > 0 ? conversationId : null,
    };
  }

  // ── help articles (public, no token) ────────────────────────────────────

  /**
   * `GET /:slug/help/articles?q=&locale=&category=&limit=` — public.
   *
   * A `q` shorter than two characters (or none) lists the top articles in the
   * workspace's own order; a longer one is a ranked search. The server clamps
   * `limit` (list: default 20, max 50; search: default 5, max 20). A workspace
   * with the switch off answers `{ enabled: false }` with nothing in it.
   */
  async getHelpArticles(args: HelpListArgs = {}): Promise<HelpArticleList> {
    const limit =
      args.limit != null && Number.isFinite(args.limit)
        ? Math.max(1, Math.trunc(args.limit))
        : undefined;
    const raw = await this.getJson(`${this.base}/${this.slug}/help/articles`, {
      q: emptyToUndefined(args.q?.trim()),
      // The CONTENT locale — which language's articles to prefer.
      locale: emptyToUndefined(this.config.contentLocale),
      category: emptyToUndefined(args.category?.trim()),
      limit,
    });
    return parseHelpArticleList(asRecord(raw));
  }

  /**
   * `GET /:slug/help/articles/:id?locale=` — public. A 404 (`NOT_FOUND`) means
   * the article is unpublished, gone, or the workspace switched help off.
   */
  async getHelpArticle(id: string): Promise<HelpArticle> {
    const raw = await this.getJson(
      `${this.base}/${this.slug}/help/articles/${encodeURIComponent(id)}`,
      { locale: emptyToUndefined(this.config.contentLocale) },
    );
    const article = asRecord(raw).article;
    if (article == null || typeof article !== 'object' || Array.isArray(article)) {
      // A 2xx without the article is a protocol violation, not a crash.
      throw new EasyLiveChatError(EasyLiveChatErrorCode.UNKNOWN, {
        message: 'GET /help/articles/:id response missing an `article` object.',
      });
    }
    return parseHelpArticle(article as Record<string, unknown>);
  }

  /**
   * `POST /:slug/help/articles/:id/view` — public. Counted once per
   * `(article, visitorId, sessionId)`; a repeat answers `counted: false`.
   */
  async postHelpView(
    id: string,
    args: { visitorId: string; sessionId: string },
  ): Promise<HelpViewResult> {
    const raw = await this.postJson(
      `${this.base}/${this.slug}/help/articles/${encodeURIComponent(id)}/view`,
      { visitorId: args.visitorId, sessionId: args.sessionId },
    );
    return { counted: asRecord(raw).counted === true };
  }

  /**
   * `POST /:slug/help/articles/:id/feedback` — public. "Was this helpful?";
   * answering again in the same session changes the answer rather than adding
   * a second one.
   */
  async postHelpFeedback(
    id: string,
    args: { visitorId: string; sessionId: string; helpful: boolean },
  ): Promise<void> {
    await this.postJson(
      `${this.base}/${this.slug}/help/articles/${encodeURIComponent(id)}/feedback`,
      { visitorId: args.visitorId, sessionId: args.sessionId, helpful: args.helpful },
    );
  }

  /**
   * `GET /:slug/messages?cursor=&limit=` — Bearer token.
   *
   * Returns a page oldest→newest with `nextCursor` set to the OLDEST message
   * id in the page; pass it back as `cursor` to walk further back in time.
   * `limit` is clamped to 1..100 CLIENT-SIDE — the server does not clamp it.
   */
  async getMessages(args: {
    token: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<MessagePage> {
    const limit = Math.min(100, Math.max(1, Math.trunc(args.limit ?? 50)));
    const raw = await this.getJson(
      `${this.base}/${this.slug}/messages`,
      { cursor: emptyToUndefined(args.cursor ?? undefined), limit },
      args.token,
    );
    return parseMessagePage(asRecord(raw));
  }

  /**
   * `POST /:slug/offline-form` — public. Returns the created conversationId.
   *
   * NOTE: this creates an UNRESUMABLE conversation (random `externalId`, no
   * token) — a terminal "we'll get back to you" flow. Never connect a socket
   * after it.
   *
   * `consents` works as it does on {@link postSession}.
   */
  async postOfflineForm(args: {
    name?: string;
    email?: string;
    message: string;
    consents?: readonly string[];
  }): Promise<string> {
    const body: Record<string, unknown> = { message: args.message };
    if (args.name != null) body.name = args.name;
    if (args.email != null) body.email = args.email;
    Object.assign(body, consentBody(args.consents));
    const raw = await this.postJson(`${this.base}/${this.slug}/offline-form`, body);
    return String(asRecord(raw).conversationId ?? '');
  }

  /**
   * `POST /:slug/conversations/:id/feedback` — Bearer token; the token's
   * conversationId must equal `conversationId`. One-shot (409 ALREADY_RATED).
   */
  async postFeedback(args: {
    token: string;
    conversationId: string;
    rating: number;
    comment?: string;
  }): Promise<FeedbackResult> {
    const body: Record<string, unknown> = { rating: args.rating };
    if (args.comment != null) body.comment = args.comment;
    const raw = await this.postJson(
      `${this.base}/${this.slug}/conversations/${encodeURIComponent(args.conversationId)}/feedback`,
      body,
      args.token,
    );
    return parseFeedbackResult(asRecord(raw));
  }

  /**
   * `POST /:slug/conversations/:id/post-chat` — Bearer token. One-shot, like
   * feedback, but the server answers 409 `ALREADY_SUBMITTED` rather than
   * `ALREADY_RATED`.
   *
   * `fields` is keyed by field **id**, never label — the same contract the
   * pre-chat form submits under, and what the dashboard reads back.
   */
  async postChat(args: {
    token: string;
    conversationId: string;
    fields: Record<string, string>;
    locale?: string;
  }): Promise<void> {
    const body: Record<string, unknown> = { fields: args.fields };
    if (args.locale != null && args.locale.length > 0) body.locale = args.locale;
    await this.postJson(
      `${this.base}/${this.slug}/conversations/${encodeURIComponent(args.conversationId)}/post-chat`,
      body,
      args.token,
    );
  }

  /**
   * `POST /:slug/conversations/:id/transcript { email? }` — Bearer token; the
   * token's conversationId must equal `conversationId`. "Email me this chat":
   * to `email`, or to the address the contact already has when it is left
   * out. Errors arrive as the server's codes — `NO_CONTACT_EMAIL`,
   * `INVALID_EMAIL`, `EMAIL_UNSUBSCRIBED`, `TRANSCRIPT_DISABLED`,
   * `TRANSCRIPT_RATE_LIMITED`.
   */
  async postTranscript(args: {
    token: string;
    conversationId: string;
    email?: string;
  }): Promise<TranscriptResult> {
    const body: Record<string, unknown> = {};
    if (args.email != null && args.email.length > 0) body.email = args.email;
    const raw = await this.postJson(
      `${this.base}/${this.slug}/conversations/${encodeURIComponent(args.conversationId)}/transcript`,
      body,
      args.token,
    );
    const sentTo = asRecord(raw).sentTo;
    return { sentTo: typeof sentTo === 'string' ? sentTo : '' };
  }

  /**
   * `GET /:slug/visitor-email` — Bearer token: the address on the visitor's
   * contact, masked, and whether the workspace offers each email.
   */
  async getVisitorEmail(args: { token: string }): Promise<VisitorEmailState> {
    const raw = await this.getJson(`${this.base}/${this.slug}/visitor-email`, {}, args.token);
    return parseVisitorEmailState(asRecord(raw));
  }

  /**
   * `POST /:slug/visitor-email { email }` — Bearer token: "Get the reply by
   * email". Answers the address as the contact now holds it, masked. Errors:
   * `INVALID_EMAIL`, `EMAIL_UNSUBSCRIBED`.
   */
  async postVisitorEmail(args: { token: string; email: string }): Promise<VisitorEmailResult> {
    const raw = await this.postJson(
      `${this.base}/${this.slug}/visitor-email`,
      { email: args.email },
      args.token,
    );
    const hint = asRecord(raw).emailHint;
    return { emailHint: typeof hint === 'string' ? hint : '' };
  }

  /**
   * `POST /visitor/heartbeat` — public; the tenant comes from `body.tenantSlug`
   * (NOTE: no `:slug` path segment).
   *
   * The endpoint is deliberately tolerant and always answers 2xx. Everything
   * is swallowed here — a non-2xx, an `{ ok: false }` body, a transport
   * failure — because a presence ping must never affect UX.
   */
  async heartbeat(args: {
    visitorId: string;
    currentUrl?: string;
    currentTitle?: string;
    referrerUrl?: string;
    language?: string;
  }): Promise<void> {
    const body: Record<string, unknown> = {
      visitorId: args.visitorId,
      tenantSlug: this.slug,
    };
    if (args.currentUrl != null) body.currentUrl = args.currentUrl;
    if (args.currentTitle != null) body.currentTitle = args.currentTitle;
    if (args.referrerUrl != null) body.referrerUrl = args.referrerUrl;
    const language = args.language ?? this.config.locale;
    if (language != null) body.language = language;
    try {
      await this.postJson(`${this.base}/visitor/heartbeat`, body);
    } catch {
      // Non-fatal by design.
    }
  }

  /**
   * `POST /api/uploads` — Bearer token. Note the path: NOT under `/api/widget`.
   *
   * The multipart field name MUST be `file`. The response is a JSON ARRAY —
   * element `[0]` is the file. Limits are server-enforced (25 MB): 413 maps to
   * `FILE_TOO_LARGE`, 415 to `UNSUPPORTED_TYPE`.
   *
   * `XMLHttpRequest` rather than `fetch`: RN's fetch gives no upload progress
   * at all, and a 25 MB attachment with no progress indicator looks frozen.
   */
  async uploadBytes(args: UploadArgs): Promise<UploadedFile> {
    const url = `${this.config.normalizedApiBase}/api/uploads`;
    const form = new FormData();
    form.append('file', toFormPart(args.data, args.filename, args.contentType));

    const raw = await xhrUpload({
      url,
      form,
      headers: this.headers(args.token),
      timeoutMs: UPLOAD_TIMEOUT_MS,
      onProgress: args.onProgress,
    });

    if (Array.isArray(raw) && raw.length > 0) {
      const first = raw[0];
      if (first != null && typeof first === 'object') {
        return parseUploadedFile(first as Record<string, unknown>);
      }
    }
    // A 2xx with an unexpected (non-array / empty) body is a protocol
    // violation — an unknown server error, not a crash.
    throw new EasyLiveChatError(EasyLiveChatErrorCode.UNKNOWN, {
      message: 'upload response was not a non-empty JSON array',
    });
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

function emptyToUndefined(v: string | undefined): string | undefined {
  return v != null && v.length > 0 ? v : undefined;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function buildQuery(query: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v == null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** Parse a JSON body, tolerating an empty or non-JSON one. */
async function readJson(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Build the multipart part.
 *
 * React Native's `FormData` accepts a `{ uri, name, type }` object and streams
 * the file off disk, which is how a large attachment (or a voice recording)
 * avoids being read into JS memory first. A `Blob`/`ArrayBuffer` is appended
 * directly for hosts that already hold the bytes.
 */
function toFormPart(
  data: UploadSource,
  filename: string,
  contentType?: string,
): string | Blob {
  if ('uri' in data) {
    // RN's FormData understands this shape natively and streams the file off
    // disk, which is how a large attachment (or a voice recording) avoids
    // being read into JS memory first. The cast is because the DOM lib's
    // FormData typing does not know about it.
    return {
      uri: data.uri,
      name: filename,
      type: contentType ?? 'application/octet-stream',
    } as unknown as Blob;
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data;
  if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
    const view = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (typeof Blob !== 'undefined') {
      // `BlobPart` wants an ArrayBuffer-backed view; slicing gives a clean one.
      return new Blob([view.slice().buffer as ArrayBuffer], {
        type: contentType ?? 'application/octet-stream',
      });
    }
    throw new EasyLiveChatError(EasyLiveChatErrorCode.UNKNOWN, {
      message: 'This runtime has no Blob; pass a { uri } file reference instead.',
    });
  }
  throw new EasyLiveChatError(EasyLiveChatErrorCode.UNKNOWN, {
    message: 'Unsupported upload source.',
  });
}

/**
 * Multipart POST with upload progress.
 *
 * `fetch` is useless for this in RN — it exposes no upload progress — so this
 * is the one place the SDK reaches for `XMLHttpRequest`, which RN implements
 * and which gives `upload.onprogress`.
 */
function xhrUpload(args: {
  url: string;
  form: FormData;
  headers: Record<string, string>;
  timeoutMs: number;
  onProgress?: (progress: number) => void;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', args.url);
    xhr.timeout = args.timeoutMs;
    for (const [k, v] of Object.entries(args.headers)) {
      // Never set content-type: the boundary has to come from FormData.
      if (k.toLowerCase() === 'content-type') continue;
      xhr.setRequestHeader(k, v);
    }

    const onProgress = args.onProgress;
    if (onProgress != null && xhr.upload != null) {
      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
      };
    }

    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText.length > 0 ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
        return;
      }
      reject(errorForResponse(xhr.status, body));
    };
    xhr.onerror = () => {
      reject(
        new EasyLiveChatError(EasyLiveChatErrorCode.NETWORK, {
          message: 'Upload failed (network error).',
        }),
      );
    };
    xhr.ontimeout = () => {
      reject(
        new EasyLiveChatError(EasyLiveChatErrorCode.NETWORK, {
          message: `Upload timed out after ${args.timeoutMs}ms.`,
        }),
      );
    };
    xhr.onabort = () => {
      reject(
        new EasyLiveChatError(EasyLiveChatErrorCode.NETWORK, { message: 'Upload aborted.' }),
      );
    };

    xhr.send(args.form);
  });
}
