/**
 * Link previews: the compact card (title, site, picture) under a message that
 * carries a link — a port of `packages/shared/src/link-preview.ts`.
 *
 * The server makes them. It fetches the page once, through its SSRF guard,
 * and stores what it found on the message as `metadata.linkPreview`, so the
 * widget, the dashboard, the apps and this SDK all draw the same card from the
 * same data, and no visitor's phone ever fetches the linked page to find out
 * what it is. The picture is re-hosted into the server's own uploads, so
 * showing it tells the linked site nothing either. The preview usually lands a
 * moment after the message, on `message:updated`.
 *
 * Everything in a preview came from a page someone else wrote, so it is read
 * through {@link parseLinkPreview} before anything is drawn: lengths capped,
 * the link http(s) only, the picture the server's own upload or https. Text is
 * text.
 */
import { isWebUrl, webUrlHost } from '../internal/web-url';
import type { ChatMessage } from './chat-message';

export interface LinkPreview {
  /** The link as it appears in the message: what the card opens. http(s) only. */
  url: string;
  title: string;
  description?: string;
  /** The site's own name (`og:site_name`), else its host. */
  siteName: string;
  /**
   * `/uploads/…` (re-hosted by the server — resolve it with
   * `EasyLiveChat.resolveUrl`) or an https URL.
   */
  imageUrl?: string;
}

export const LINK_PREVIEW_LIMITS = { title: 200, description: 300, siteName: 80, url: 2048 } as const;

function clip(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  // One line: a page title with a newline in it is still one title.
  const one = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (one.length === 0) return undefined;
  const chars = Array.from(one);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : one;
}

/** An image a client may load: the server's own re-hosted upload, or https. */
export function isSafePreviewImage(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > LINK_PREVIEW_LIMITS.url) return false;
  if (/^\/uploads\/[\w./-]+$/.test(v) && !v.includes('..')) return true;
  return /^https:\/\//i.test(v.trim()) && isWebUrl(v, LINK_PREVIEW_LIMITS.url);
}

/** The host a card names when the site gave no name of its own: `www.` dropped. */
export function previewHost(url: string): string {
  return webUrlHost(url).replace(/^www\./i, '');
}

/** A stored preview, checked; null for anything malformed or with nothing to show. */
export function parseLinkPreview(raw: unknown): LinkPreview | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isWebUrl(r.url, LINK_PREVIEW_LIMITS.url)) return null;
  const url = r.url.trim();
  const title = clip(r.title, LINK_PREVIEW_LIMITS.title);
  if (title == null) return null;
  const siteName = clip(r.siteName, LINK_PREVIEW_LIMITS.siteName) ?? previewHost(url);
  const description = clip(r.description, LINK_PREVIEW_LIMITS.description);
  const preview: LinkPreview = { url, title, siteName };
  if (description != null && description !== title) preview.description = description;
  if (isSafePreviewImage(r.imageUrl)) preview.imageUrl = r.imageUrl.trim();
  return preview;
}

/**
 * The preview under a message (`metadata.linkPreview`), checked — or null.
 *
 * A card message draws its cards instead, so it never has one; draw this only
 * while the workspace's `linkPreviews` switch is on (`WidgetConfig`).
 */
export function linkPreviewOf(m: Pick<ChatMessage, 'metadata' | 'contentType'>): LinkPreview | null {
  if (m.contentType === 'card') return null;
  return parseLinkPreview(m.metadata?.linkPreview);
}
