/**
 * The token in an emailed "Reply in the chat" link.
 *
 * The workspace's emails to a visitor who has left (apps/api
 * `services/visitor-email.ts`) link to the page they were on — or the
 * workspace's site, or our own chat page — with the token in the FRAGMENT:
 * `#elc_chat=<token>` on a site, `#resume=<token>` on our chat page. A fragment
 * because it is never sent to the site's server or its analytics. The web
 * widget's loader reads the first, its panel the second
 * (`apps/widget/src/lib/resume-link.ts`); this reads both, and a bare token, so
 * a host can hand over whatever its deep-link handler received.
 *
 * Only the shape is checked here — a JWT, three base64url parts — exactly as
 * the widget checks it. Whether the token is genuine, unexpired and this
 * workspace's is the server's to say when it is traded.
 */
const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;

/** `elc_chat=` or `resume=` as a parameter of the fragment, never inside another name. */
const LINK_PARAM = /(?:^|&)(?:elc_chat|resume)=([^&]*)/;

/** The token `link` carries, or null when it is not one of ours. */
export function resumeLinkToken(link: string | null | undefined): string | null {
  if (typeof link !== 'string') return null;
  const text = link.trim();
  if (text.length === 0) return null;
  const hashAt = text.indexOf('#');
  // No fragment: the bare token, or nothing of ours.
  if (hashAt === -1) return JWT_SHAPE.test(text) ? text : null;
  const match = LINK_PARAM.exec(text.slice(hashAt + 1));
  const raw = match?.[1];
  if (raw == null || raw.length === 0) return null;
  let token: string;
  try {
    token = decodeURIComponent(raw).trim();
  } catch {
    return null;
  }
  return JWT_SHAPE.test(token) ? token : null;
}
