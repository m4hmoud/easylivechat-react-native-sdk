import { describe, expect, it } from 'vitest';

import { detectLinks, isPhoneLike, uriForSpan } from '../src/views/linkified-text';

/**
 * Port of `linkified_text_test.dart`.
 *
 * Message bodies are UNTRUSTED text, never markup — nothing is parsed, the
 * string is only scanned for entity SHAPES.
 */
const kinds = (text: string): string[] => detectLinks(text).map((s) => `${s.kind}:${s.text}`);

describe('URL detection', () => {
  it('links an explicit scheme or www prefix', () => {
    expect(kinds('see https://example.com/docs')).toEqual(['url:https://example.com/docs']);
    expect(kinds('see www.example.co.uk')).toEqual(['url:www.example.co.uk']);
    expect(kinds('see http://localhost:3000/x')).toEqual(['url:http://localhost:3000/x']);
  });

  it('links a bare domain ONLY for an allowlisted TLD', () => {
    expect(kinds('go to example.com')).toEqual(['url:example.com']);
    expect(kinds('go to shop.example.io/a?b=1')).toEqual(['url:shop.example.io/a?b=1']);
    // The whole reason the allowlist exists: a filename is not a link.
    expect(kinds('open main.py')).toEqual([]);
    expect(kinds('here is photo.png')).toEqual([]);
    expect(kinds('see notes.txt')).toEqual([]);
    expect(kinds('run build.sh')).toEqual([]);
    expect(kinds('config.yaml is broken')).toEqual([]);
  });

  it('still links a non-allowlisted TLD when written with a scheme', () => {
    expect(kinds('https://main.py/docs')).toEqual(['url:https://main.py/docs']);
  });

  it('strips sentence punctuation from the tail', () => {
    expect(kinds('See https://example.com/a.')).toEqual(['url:https://example.com/a']);
    expect(kinds('Is it https://example.com?')).toEqual(['url:https://example.com']);
    expect(kinds('(see https://example.com)')).toEqual(['url:https://example.com']);
  });

  it('keeps a closing bracket the link itself opened', () => {
    expect(kinds('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      'url:https://en.wikipedia.org/wiki/Foo_(bar)',
    ]);
  });

  it('does not link the tail of an @-handle as a bare domain', () => {
    // The guard on the preceding character: without it, the domain half of
    // something the email rule did not claim gets linked on its own.
    expect(kinds('@example.com')).toEqual([]);
    expect(kinds('ada@example.com')).toEqual(['email:ada@example.com']);
    // A real subdomain still links.
    expect(kinds('sub.example.com')).toEqual(['url:sub.example.com']);
  });
});

describe('email detection', () => {
  it('links an address and does NOT link its domain separately', () => {
    expect(kinds('mail ada@example.com now')).toEqual(['email:ada@example.com']);
    expect(kinds('ada.lovelace+tag@sub.example.co.uk')).toEqual([
      'email:ada.lovelace+tag@sub.example.co.uk',
    ]);
  });
});

describe('phone detection', () => {
  it('links a plausible dialable run', () => {
    expect(kinds('call +964 770 000 0000')).toEqual(['phone:+964 770 000 0000']);
    expect(kinds('call 0770-000-0000')).toEqual(['phone:0770-000-0000']);
    expect(kinds('call (555) 123-4567')).toEqual(['phone:(555) 123-4567']);
  });

  it('refuses order numbers, versions and dates', () => {
    expect(isPhoneLike('12345')).toBe(false); // too short
    expect(isPhoneLike('1234567890123456')).toBe(false); // beyond E.164
    expect(isPhoneLike('12345678')).toBe(false); // no + and no separator
    expect(isPhoneLike('1.5.3')).toBe(false);
    expect(isPhoneLike('10.20.30.40')).toBe(false);
    expect(isPhoneLike('2026-07-30')).toBe(false);
    expect(kinds('order 2026-07-30 shipped')).toEqual([]);
  });

  it('drops a sentence bracket the match swallowed', () => {
    expect(kinds('ring (555-123-4567')).toEqual(['phone:555-123-4567']);
  });

  it('does not read a URL’s digits as a phone number', () => {
    expect(kinds('https://example.com/2026/07/30/1234567')).toEqual([
      'url:https://example.com/2026/07/30/1234567',
    ]);
  });
});

describe('spans and URIs', () => {
  it('returns ascending, non-overlapping ranges over the ORIGINAL string', () => {
    const text = 'mail ada@example.com or visit example.com today';
    const spans = detectLinks(text);
    expect(spans).toHaveLength(2);
    for (const span of spans) {
      expect(text.slice(span.start, span.end)).toBe(span.text);
    }
    expect(spans[0]!.end).toBeLessThanOrEqual(spans[1]!.start);
  });

  it('builds the right URI per kind', () => {
    expect(uriForSpan({ start: 0, end: 0, kind: 'url', text: 'example.com' })).toBe(
      'https://example.com',
    );
    expect(uriForSpan({ start: 0, end: 0, kind: 'url', text: 'http://a.com' })).toBe('http://a.com');
    expect(uriForSpan({ start: 0, end: 0, kind: 'email', text: 'a@b.co' })).toBe('mailto:a@b.co');
    expect(uriForSpan({ start: 0, end: 0, kind: 'phone', text: '+964 770 000 0000' })).toBe(
      'tel:+9647700000000',
    );
    expect(uriForSpan({ start: 0, end: 0, kind: 'phone', text: '(555) 123-4567' })).toBe(
      'tel:5551234567',
    );
    // Nothing dialable left ⇒ no URI, so the span renders as plain text rather
    // than a dead link.
    expect(uriForSpan({ start: 0, end: 0, kind: 'phone', text: '+' })).toBeNull();
  });

  it('returns nothing for plain prose', () => {
    expect(detectLinks('')).toEqual([]);
    expect(detectLinks('Just a normal sentence, thanks!')).toEqual([]);
  });

  it('handles Arabic text around a link without mangling the offsets', () => {
    const text = 'زیارەت بکە example.com سوپاس';
    const spans = detectLinks(text);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe('example.com');
  });
});
