import { describe, expect, it } from 'vitest';

import { parseChatMessage } from '../src/models/chat-message';
import {
  LINK_PREVIEW_LIMITS,
  isSafePreviewImage,
  linkPreviewOf,
  parseLinkPreview,
  previewHost,
} from '../src/models/link-preview';
import { isSafeCardUrl } from '../src/models/message-extras';
import { messageRow } from './fake-server';

/**
 * Link previews (C2) — the server's `metadata.linkPreview`, read through a
 * port of `packages/shared/src/link-preview.ts`. Everything in one came from
 * a page someone else wrote, so it is checked before anything is drawn.
 */
const GOOD = {
  url: 'https://www.example.com/shoes/42',
  title: 'Trail runner 42',
  description: 'Light, grippy, waterproof.',
  siteName: 'Example Shop',
  imageUrl: '/uploads/previews/abc.jpg',
};

describe('parseLinkPreview', () => {
  it('reads a well-formed preview', () => {
    expect(parseLinkPreview(GOOD)).toEqual(GOOD);
  });

  it('opens http and https only', () => {
    expect(parseLinkPreview({ ...GOOD, url: 'http://example.com' })?.url).toBe('http://example.com');
    for (const url of ['javascript:alert(1)', 'ftp://example.com', 'data:text/html,hi', '//example.com', 'example.com', 'https://', '']) {
      expect(parseLinkPreview({ ...GOOD, url }), url).toBeNull();
    }
    expect(parseLinkPreview({ ...GOOD, url: `https://example.com/${'a'.repeat(LINK_PREVIEW_LIMITS.url)}` })).toBeNull();
  });

  it('needs a title, and nothing malformed', () => {
    expect(parseLinkPreview({ ...GOOD, title: '   ' })).toBeNull();
    expect(parseLinkPreview({ ...GOOD, title: 7 })).toBeNull();
    expect(parseLinkPreview(null)).toBeNull();
    expect(parseLinkPreview([GOOD])).toBeNull();
    expect(parseLinkPreview('https://example.com')).toBeNull();
  });

  it('keeps the picture only when it is the server’s own upload or https', () => {
    expect(parseLinkPreview({ ...GOOD, imageUrl: 'https://cdn.example.com/a.png' })?.imageUrl).toBe(
      'https://cdn.example.com/a.png',
    );
    for (const imageUrl of ['http://cdn.example.com/a.png', '/uploads/../secret', '/etc/passwd', 'data:image/png;base64,AAA', 42]) {
      expect(parseLinkPreview({ ...GOOD, imageUrl })?.imageUrl, String(imageUrl)).toBeUndefined();
    }
    expect(isSafePreviewImage('/uploads/x/y.webp')).toBe(true);
  });

  it('collapses text to one line and caps it', () => {
    const p = parseLinkPreview({
      ...GOOD,
      title: 'Trail\n  runner\t42',
      description: 'x'.repeat(400),
    });
    expect(p?.title).toBe('Trail runner 42');
    expect(Array.from(p?.description ?? '')).toHaveLength(LINK_PREVIEW_LIMITS.description);
    expect(p?.description?.endsWith('…')).toBe(true);
  });

  it('drops a description that only repeats the title', () => {
    expect(parseLinkPreview({ ...GOOD, description: GOOD.title })?.description).toBeUndefined();
  });

  it('names the site by its host when it gave no name', () => {
    expect(parseLinkPreview({ ...GOOD, siteName: undefined })?.siteName).toBe('example.com');
    expect(previewHost('https://WWW.Example.COM:8443/x?y#z')).toBe('example.com');
    expect(previewHost('not a url')).toBe('');
  });
});

describe('linkPreviewOf', () => {
  it('reads the preview off a message’s metadata', () => {
    const m = parseChatMessage(messageRow({ body: 'Look: https://www.example.com/shoes/42', metadata: { linkPreview: GOOD } }));
    expect(linkPreviewOf(m)).toEqual(GOOD);
  });

  it('none on a message without one, a broken one, or a card', () => {
    expect(linkPreviewOf(parseChatMessage(messageRow()))).toBeNull();
    expect(linkPreviewOf(parseChatMessage(messageRow({ metadata: { linkPreview: { url: 'nope' } } })))).toBeNull();
    const card = parseChatMessage(
      messageRow({ contentType: 'CARD', metadata: { linkPreview: GOOD, card: { title: 'Shoes' } } }),
    );
    expect(linkPreviewOf(card)).toBeNull();
  });
});

describe('isSafeCardUrl', () => {
  it('is unchanged by sharing the link check with previews', () => {
    expect(isSafeCardUrl('https://example.com/a?b=c#d')).toBe(true);
    expect(isSafeCardUrl('https://example.com:65535')).toBe(true);
    expect(isSafeCardUrl('https://example.com:65536')).toBe(false);
    expect(isSafeCardUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeCardUrl(`https://example.com/${'a'.repeat(1000)}`)).toBe(false);
  });
});
