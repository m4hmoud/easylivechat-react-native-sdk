/**
 * Canonical error codes surfaced by the SDK. The first groups are server
 * `{ error }` codes from the widget protocol; the rest are client/transport.
 */
export const EasyLiveChatErrorCode = {
  // ── Server (HTTP `{ error, fieldId?, message? }`) ──
  NOT_FOUND: 'NOT_FOUND',
  ORIGIN_NOT_ALLOWED: 'ORIGIN_NOT_ALLOWED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  /**
   * `403` from `POST /session`: the workspace ENFORCES identity verification
   * and this session claimed a `userId` whose `userHash` is missing or wrong.
   * The error's `reason` says which — see {@link isIdentityNotVerified}.
   */
  IDENTITY_NOT_VERIFIED: 'IDENTITY_NOT_VERIFIED',
  /** `429` — too many requests from this address (the help endpoints). */
  RATE_LIMITED: 'RATE_LIMITED',
  /** `400` — the server could not read the request body. */
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',

  // ── Pre-chat validation (carry `fieldId`) ──
  EXPECTED_OBJECT: 'EXPECTED_OBJECT',
  REQUIRED: 'REQUIRED',
  INVALID_EMAIL: 'INVALID_EMAIL',
  INVALID_NUMBER: 'INVALID_NUMBER',
  INVALID_OPTION: 'INVALID_OPTION',
  /** A required consent checkbox was left unticked. `fieldId` names it. */
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',

  // ── Feedback / survey (one-shot) ──
  INVALID_RATING: 'INVALID_RATING',
  ALREADY_RATED: 'ALREADY_RATED',
  /** The post-chat survey's one-shot rule, under its own server code. */
  ALREADY_SUBMITTED: 'ALREADY_SUBMITTED',

  // ── Uploads ──
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',
  CONTENT_TYPE_MISMATCH: 'CONTENT_TYPE_MISMATCH',

  // ── Client / transport ──
  NETWORK: 'NETWORK',
  NO_TOKEN: 'NO_TOKEN',
  SEND_REJECTED: 'SEND_REJECTED',
  SOCKET: 'SOCKET',
  UNKNOWN: 'UNKNOWN',
} as const;

/** One of the {@link EasyLiveChatErrorCode} values — or any future server code. */
export type EasyLiveChatErrorCodeValue =
  (typeof EasyLiveChatErrorCode)[keyof typeof EasyLiveChatErrorCode];

export interface EasyLiveChatErrorOptions {
  fieldId?: string;
  httpStatus?: number;
  message?: string;
  /** The server's `reason`, for codes that carry one. */
  reason?: string;
  cause?: unknown;
}

/**
 * Why the server refused an identity claim. Kept a plain string on the error
 * itself so a reason added later still arrives intact.
 *
 * - `NO_SECRET` — the workspace turned verification on but never generated a
 *   secret. Nothing the app can send will pass: generate the identity secret
 *   in the dashboard and give it to your backend.
 * - `NO_HASH` — a `userId` was sent without a `userHash`. Pass both to
 *   `identify()`; a bare id proves nothing.
 * - `BAD_HASH` — the hash does not match. It must be
 *   `HMAC_SHA256(identitySecret, userId)` as hex, computed by your BACKEND over
 *   the same `userId` string you pass, with the CURRENT secret — regenerating
 *   the secret invalidates every hash made with the old one.
 */
export type IdentityRejectionReason = 'NO_SECRET' | 'NO_HASH' | 'BAD_HASH';

/**
 * Typed error for every failure path.
 *
 * `code` is one of {@link EasyLiveChatErrorCode} — typed as a plain `string`
 * rather than the union, because the server's `{ error }` code is preferred
 * verbatim and a future protocol code must arrive intact rather than being
 * flattened to `UNKNOWN`. `fieldId` is set for per-field pre-chat errors.
 */
export class EasyLiveChatError extends Error {
  readonly code: string;
  readonly fieldId?: string;
  readonly httpStatus?: number;
  /**
   * The server's `reason`, when the code carries one — for
   * `IDENTITY_NOT_VERIFIED`, one of {@link IdentityRejectionReason}.
   */
  readonly reason?: string;
  override readonly cause?: unknown;

  constructor(code: string, options: EasyLiveChatErrorOptions = {}) {
    super(options.message ?? code);
    this.name = 'EasyLiveChatError';
    this.code = code;
    this.fieldId = options.fieldId;
    this.httpStatus = options.httpStatus;
    this.reason = options.reason;
    this.cause = options.cause;
    // Extending a builtin under a downlevel target loses the prototype chain,
    // so `instanceof` (and every `catch (e) { if (e instanceof …) }` in the
    // controller) would silently fail.
    Object.setPrototypeOf(this, EasyLiveChatError.prototype);
  }

  get isAuthError(): boolean {
    return (
      this.code === EasyLiveChatErrorCode.UNAUTHENTICATED ||
      this.code === EasyLiveChatErrorCode.FORBIDDEN
    );
  }

  override toString(): string {
    const parts = [this.code];
    if (this.httpStatus != null) parts.push(` http=${this.httpStatus}`);
    if (this.fieldId != null) parts.push(` field=${this.fieldId}`);
    if (this.reason != null) parts.push(` reason=${this.reason}`);
    const detail = this.message && this.message !== this.code ? `: ${this.message}` : '';
    return `EasyLiveChatError(${parts.join('')}${detail})`;
  }
}

/** Normalize any thrown value into an {@link EasyLiveChatError}. */
export function toEasyLiveChatError(e: unknown): EasyLiveChatError {
  if (e instanceof EasyLiveChatError) return e;
  return new EasyLiveChatError(EasyLiveChatErrorCode.UNKNOWN, {
    message: e instanceof Error ? e.message : String(e),
    cause: e,
  });
}

/**
 * Decode a non-2xx response body `{ error, fieldId, message }` into a typed
 * error.
 *
 * The server's `{ error }` code wins when present — it carries the specific
 * protocol codes (`ORIGIN_NOT_ALLOWED`, `CONTENT_TYPE_MISMATCH`, `REQUIRED`,
 * `INVALID_RATING`, `ALREADY_RATED`, …) that a bare status would flatten. The
 * status map is only the fallback for a body that omits it.
 */
export function errorForResponse(status: number, body: unknown): EasyLiveChatError {
  const map = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const serverCode = map.error != null ? String(map.error) : '';
  const fieldId = map.fieldId != null ? String(map.fieldId) : undefined;
  const reason = typeof map.reason === 'string' && map.reason.length > 0 ? map.reason : undefined;
  let message = map.message != null ? String(map.message) : undefined;

  let code: string;
  if (serverCode.length > 0) {
    code = serverCode;
  } else {
    switch (status) {
      case 401:
        code = EasyLiveChatErrorCode.UNAUTHENTICATED;
        break;
      case 403:
        code = EasyLiveChatErrorCode.FORBIDDEN;
        break;
      case 429:
        code = EasyLiveChatErrorCode.RATE_LIMITED;
        break;
      case 413:
        code = EasyLiveChatErrorCode.FILE_TOO_LARGE;
        break;
      case 415:
        code = EasyLiveChatErrorCode.UNSUPPORTED_TYPE;
        break;
      default:
        code = EasyLiveChatErrorCode.UNKNOWN;
    }
  }

  // The server sends no prose for this one, and the code alone does not tell
  // a developer reading a log what to change.
  if (code === EasyLiveChatErrorCode.IDENTITY_NOT_VERIFIED && message == null) {
    message = identityRejectionMessage(reason);
  }

  return new EasyLiveChatError(code, { fieldId, httpStatus: status, message, reason });
}

/**
 * The session was refused because the workspace ENFORCES identity
 * verification and the claim did not check out (HTTP 403
 * `IDENTITY_NOT_VERIFIED`). `e.reason` is one of
 * {@link IdentityRejectionReason}:
 *
 * - `NO_SECRET` — the workspace has no identity secret yet; generate it in
 *   the dashboard and sign with it on your backend.
 * - `NO_HASH` — `identify()` was given a `userId` but no `userHash`.
 * - `BAD_HASH` — the hash is wrong: compute
 *   `HMAC_SHA256(identitySecret, userId)` as hex ON YOUR BACKEND, over exactly
 *   the `userId` you pass, with the current secret.
 *
 * Never retried by the SDK — sending the same claim again cannot succeed.
 * Anonymous visitors (no `userId`) are never refused, so a host that cannot
 * get a hash for someone should identify them without a `userId` rather than
 * with a wrong one. Workspaces with verification OFF or OPTIONAL never produce
 * this error.
 *
 * ```ts
 * EasyLiveChat.instance.onError((e) => {
 *   if (isIdentityNotVerified(e)) log.warn(`identity refused: ${e.reason}`);
 * });
 * ```
 */
export function isIdentityNotVerified(e: unknown): e is IdentityNotVerifiedError {
  return e instanceof EasyLiveChatError && e.code === EasyLiveChatErrorCode.IDENTITY_NOT_VERIFIED;
}

/**
 * An {@link EasyLiveChatError} whose code is `IDENTITY_NOT_VERIFIED` — what
 * {@link isIdentityNotVerified} narrows to. Narrowing to the code (rather than
 * to the whole class) keeps the `else` branch of a check on an
 * `EasyLiveChatError` typed as one.
 */
export type IdentityNotVerifiedError = EasyLiveChatError & {
  readonly code: typeof EasyLiveChatErrorCode.IDENTITY_NOT_VERIFIED;
};

function identityRejectionMessage(reason: string | undefined): string {
  switch (reason) {
    case 'NO_SECRET':
      return 'Identity verification is enforced but the workspace has no identity secret. Generate one in the dashboard and sign userId with it on your backend.';
    case 'NO_HASH':
      return 'Identity verification is enforced: identify() was given a userId without a userHash.';
    case 'BAD_HASH':
      return 'Identity verification is enforced and userHash does not match. It must be HMAC_SHA256(identitySecret, userId) as hex, computed on your backend over exactly this userId.';
    default:
      return 'Identity verification is enforced and this userId could not be verified.';
  }
}
