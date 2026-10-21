/**
 * Links a visitor may be sent to: `http:` or `https:` with a host, nothing
 * else.
 *
 * A regular expression, not `new URL()`, whose implementation in Hermes is
 * incomplete — and deliberately no looser than the WHATWG parser the server
 * uses. Shared by a card's link buttons and a link preview's card.
 */

// scheme://[userinfo@]host[:port][/path][?query][#fragment]
const WEB_URL =
  /^https?:\/\/(?:[^\s/?#@]+@)?(\[[0-9a-f:.]+\]|[^\s/?#@:[\]\\<>^|"%]+)(?::(\d{0,5}))?(?:[/?#]\S*)?$/i;

/** An http(s) URL with a host, at most `maxLength` long. */
export function isWebUrl(url: unknown, maxLength: number): url is string {
  if (typeof url !== 'string' || url.length > maxLength) return false;
  const m = WEB_URL.exec(url.trim());
  if (!m) return false;
  return !(m[2] !== undefined && m[2] !== '' && Number(m[2]) > 65535);
}

/** The host of an http(s) URL, lower-cased; `''` for anything else. */
export function webUrlHost(url: string): string {
  const m = WEB_URL.exec(url.trim());
  return m?.[1]?.toLowerCase() ?? '';
}
