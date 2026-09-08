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

  // ── Pre-chat validation (carry `fieldId`) ──
  EXPECTED_OBJECT: 'EXPECTED_OBJECT',
  REQUIRED: 'REQUIRED',
  INVALID_EMAIL: 'INVALID_EMAIL',
  INVALID_NUMBER: 'INVALID_NUMBER',
  INVALID_OPTION: 'INVALID_OPTION',

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
  cause?: unknown;
}

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
  override readonly cause?: unknown;

  constructor(code: string, options: EasyLiveChatErrorOptions = {}) {
    super(options.message ?? code);
    this.name = 'EasyLiveChatError';
    this.code = code;
    this.fieldId = options.fieldId;
    this.httpStatus = options.httpStatus;
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
  const message = map.message != null ? String(map.message) : undefined;

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

  return new EasyLiveChatError(code, { fieldId, httpStatus: status, message });
}
