/**
 * Read the `exp` claim out of a widget JWT.
 *
 * Deliberately hand-rolled rather than a dependency: this reads ONE numeric
 * claim to pre-empt a 401, and never verifies anything — the server is the
 * only authority on whether a token is valid. A whole JWT library for that is
 * weight the SDK does not need to put in every host app's bundle.
 *
 * The base64url decoder is also hand-rolled: `atob` exists on Hermes and Node
 * but not on every RN engine/polyfill combination a host might have, and a
 * token we cannot read must degrade to "not expiring" rather than throw.
 */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode base64url (no padding, `-_` alphabet) into raw bytes. */
function base64UrlToBytes(input: string): Uint8Array | null {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of normalized) {
    if (ch === '=') break;
    const value = B64_ALPHABET.indexOf(ch);
    if (value === -1) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

/** Minimal UTF-8 decode, so a token with non-ASCII claims still parses. */
function utf8Decode(bytes: Uint8Array): string {
  const TD = (globalThis as { TextDecoder?: new () => { decode(b: Uint8Array): string } })
    .TextDecoder;
  if (typeof TD === 'function') return new TD().decode(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i++] ?? 0;
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if (b0 < 0xe0) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | ((bytes[i++] ?? 0) & 0x3f));
    } else if (b0 < 0xf0) {
      out += String.fromCharCode(
        ((b0 & 0x0f) << 12) | (((bytes[i++] ?? 0) & 0x3f) << 6) | ((bytes[i++] ?? 0) & 0x3f),
      );
    } else {
      const cp =
        ((b0 & 0x07) << 18) |
        (((bytes[i++] ?? 0) & 0x3f) << 12) |
        (((bytes[i++] ?? 0) & 0x3f) << 6) |
        ((bytes[i++] ?? 0) & 0x3f);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

/** The decoded payload segment, or null when the token is unreadable. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const payload = parts[1];
  if (payload == null || payload.length === 0) return null;
  try {
    const bytes = base64UrlToBytes(payload);
    if (bytes == null) return null;
    const parsed: unknown = JSON.parse(utf8Decode(bytes));
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The token's expiry as epoch milliseconds, or null when unreadable. */
export function jwtExpiryMs(token: string): number | null {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
}

/**
 * True when the token expires within `leewayMs`.
 *
 * An undecodable token is treated as NOT expiring: the auth-error path
 * recovers from a genuinely dead token, whereas guessing "expired" here would
 * re-mint on every single call.
 */
export function isTokenExpiring(token: string, leewayMs: number, now = Date.now()): boolean {
  const exp = jwtExpiryMs(token);
  if (exp == null) return false;
  return exp < now + leewayMs;
}
