import React, { useMemo } from 'react';
import { Linking, Text, type TextStyle } from 'react-native';

import { textDirectionOf } from '../bidi';

/**
 * Auto-linking for message bodies: URLs, email addresses and phone numbers
 * inside plain text become tappable.
 *
 * Message bodies are UNTRUSTED visitor/agent text, NEVER MARKUP — the web
 * widget renders them as text nodes for exactly that reason. So instead of
 * parsing anything, the string is scanned for entity SHAPES and handed back as
 * spans; the text itself is still rendered verbatim.
 *
 * Tapping opens the platform handler (`https:` → browser, `mailto:` → mail,
 * `tel:` → dialer) via React Native's own `Linking`, which needs no peer
 * dependency and no `LSApplicationQueriesSchemes` entry in the host's
 * Info.plist. `canOpenURL` is deliberately NOT called first: it would require
 * exactly that host configuration just to make a link tappable, and a device
 * with no handler simply does nothing.
 */

/** What kind of entity a detected span is. */
export type ElcLinkKind = 'url' | 'email' | 'phone';

/** One auto-detected entity, as a half-open `[start, end)` range. */
export interface ElcLinkSpan {
  start: number;
  end: number;
  kind: ElcLinkKind;
  /** The matched text exactly as it appears in the body (what we display). */
  text: string;
}

/**
 * TLDs we are willing to auto-link WITHOUT a scheme or `www.` prefix.
 *
 * A bare-domain rule of "label dot 2+ letters" turns `main.py`, `photo.png`
 * and `notes.txt` into links, so scheme-less matching is restricted to an
 * explicit list. Anything outside it still links when written as `https://…`
 * or `www.…`. Extend as needed — order is irrelevant.
 */
const BARE_LINK_TLDS = new Set([
  // generic
  'com', 'net', 'org', 'info', 'biz', 'edu', 'gov', 'mil', 'int',
  'io', 'co', 'ai', 'app', 'dev', 'me', 'tv', 'cc', 'xyz', 'online',
  'site', 'shop', 'store', 'tech', 'cloud', 'live', 'link', 'page',
  'blog', 'news', 'space', 'website', 'agency', 'company', 'digital',
  'email', 'group', 'life', 'media', 'network', 'services', 'solutions',
  'support', 'systems', 'today', 'tools', 'world', 'zone', 'chat',
  // country / regional codes in common use for the product's markets
  'uk', 'de', 'fr', 'es', 'it', 'nl', 'se', 'dk', 'fi', 'no', 'ie',
  'pt', 'gr', 'ch', 'at', 'be', 'cz', 'hu', 'ro', 'bg', 'ua', 'ru',
  'tr', 'iq', 'ir', 'sa', 'ae', 'qa', 'kw', 'bh', 'om', 'jo', 'lb',
  'eg', 'ma', 'dz', 'tn', 'ly', 'sd', 'ye', 'ps', 'il',
  'in', 'pk', 'bd', 'lk', 'np', 'cn', 'jp', 'kr', 'hk', 'tw', 'sg',
  'my', 'th', 'vn', 'ph', 'id', 'au', 'nz', 'ca', 'us', 'mx', 'br',
  'ar', 'cl', 'pe', 'za', 'ng', 'ke', 'gh', 'et', 'tz', 'ug', 'eu',
]);

/** Characters a URL/bare-domain match must not run into. Includes RLM/LRM. */
const URL_STOP = '\\s<>"\'`\u200f\u200e';

/**
 * Matched in priority order at each position: scheme/`www.` URL, then email,
 * then bare domain, then phone.
 *
 * Ordering matters — it stops the domain half of `a@b.com` being linked
 * separately, and stops a URL's digits being read as a phone number.
 *
 * Lookbehind is deliberately avoided (the preceding character is checked by
 * hand below): it is supported by current Hermes, but this runs on whatever
 * engine the host ships, and a regex that fails to COMPILE takes the whole
 * bundle down rather than degrading.
 */
const ENTITY_PATTERN = new RegExp(
  [
    // 1 — URL with an explicit scheme or a `www.` prefix.
    `(?<surl>(?:https?://|www\\.)[^${URL_STOP}]+)`,
    // 2 — email address.
    '(?<email>[A-Za-z0-9._%+\\-]+@[A-Za-z0-9](?:[A-Za-z0-9\\-]*[A-Za-z0-9])?' +
      '(?:\\.[A-Za-z0-9](?:[A-Za-z0-9\\-]*[A-Za-z0-9])?)*\\.[A-Za-z]{2,24})',
    // 3 — bare domain (TLD validated against BARE_LINK_TLDS), optional
    //     path/query/fragment.
    '(?<bare>(?:[A-Za-z0-9](?:[A-Za-z0-9\\-]*[A-Za-z0-9])?\\.)+(?<tld>[A-Za-z]{2,24})' +
      `(?![A-Za-z0-9\\-])(?:[/?#][^${URL_STOP}]*)?)`,
    // 4 — phone number: optional `+` or area-code bracket, then digits with
    //     common separators. Shape validated in `isPhoneLike`.
    '(?<phone>\\+?\\(?\\d[\\d\\s().\\-]{5,20}\\d)(?!\\w)',
  ].join('|'),
  'gu',
);

/**
 * Trailing characters that are almost always sentence punctuation rather than
 * part of the link (`See https://x.com/a.` → the `.` is not in the path).
 */
const TRAILING_PUNCTUATION = '.,;:!?"\'`»”’)]}>*_~';

const WORD_OR_DOMAIN = /[\w@.\-]/;

/**
 * Find every auto-linkable entity in `input`.
 *
 * Pure and side-effect free so the matching rules can be unit-tested without a
 * component tree. Returns spans in ascending, non-overlapping order.
 */
export function detectLinks(input: string): ElcLinkSpan[] {
  if (input.length === 0) return [];
  const spans: ElcLinkSpan[] = [];
  ENTITY_PATTERN.lastIndex = 0;

  for (const m of input.matchAll(ENTITY_PATTERN)) {
    const groups = m.groups ?? {};
    const matchStart = m.index ?? 0;
    const before = matchStart > 0 ? (input[matchStart - 1] ?? '') : '';

    let raw: string;
    let kind: ElcLinkKind;

    if (groups.surl != null) {
      raw = groups.surl;
      kind = 'url';
    } else if (groups.email != null) {
      raw = groups.email;
      kind = 'email';
    } else if (groups.bare != null) {
      // Not preceded by `@` or a word char, so the tail of an unmatched email
      // (or a filename mid-word) is left alone.
      if (before.length > 0 && WORD_OR_DOMAIN.test(before)) continue;
      const tld = (groups.tld ?? '').toLowerCase();
      if (!BARE_LINK_TLDS.has(tld)) continue;
      raw = groups.bare;
      kind = 'url';
    } else if (groups.phone != null) {
      if (before.length > 0 && (/\w/.test(before) || before === '+')) continue;
      if (!isPhoneLike(groups.phone)) continue;
      raw = groups.phone;
      kind = 'phone';
    } else {
      continue;
    }

    let start = matchStart;
    let text = raw;
    if (kind === 'url') {
      text = trimUrlTail(text);
    } else if (kind === 'phone' && text.startsWith('(') && !text.includes(')')) {
      // `(555-1234)` — the opening bracket is the sentence's, not an area
      // code's, since its partner fell outside the match.
      text = text.slice(1);
      start += 1;
    }
    if (text.length === 0) continue;

    spans.push({ start, end: start + text.length, kind, text });
  }
  return spans;
}

/**
 * Strip trailing punctuation that belongs to the sentence, keeping a closing
 * bracket when the link itself opened one (`…/Foo_(bar)`).
 */
function trimUrlTail(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1] ?? '';
    if (!TRAILING_PUNCTUATION.includes(ch)) break;
    if (ch === ')' || ch === ']' || ch === '}') {
      const open = ch === ')' ? '(' : ch === ']' ? '[' : '{';
      const body = url.slice(0, end);
      const opens = body.split(open).length - 1;
      const closes = body.split(ch).length - 1;
      if (opens >= closes) break; // balanced — the bracket is part of the URL
    }
    end--;
  }
  return url.slice(0, end);
}

/** ISO-ish dates have a phone's digit count and separators, and never dial. */
const ISO_DATE = /^\d{4}-\d{1,2}-\d{1,2}$/;

/**
 * Is this digit run actually dialable?
 *
 * E.164 allows up to 15 digits; below 7 we are looking at an order number or a
 * quantity. A bare digit run with no `+` and no separator is too ambiguous to
 * link unless it is long enough to only plausibly be a phone number.
 */
export function isPhoneLike(candidate: string): boolean {
  const trimmed = candidate.trim();
  // The date check runs on the digits themselves — a match may have swallowed
  // a sentence bracket (`(2026-07-30`) that would otherwise defeat it.
  if (ISO_DATE.test(trimmed.replace(/^[(\s]+|[)\s]+$/g, ''))) return false;

  const digitCount = trimmed.replace(/\D/g, '').length;
  if (digitCount < 7 || digitCount > 15) return false;

  const hasPlus = trimmed.startsWith('+');
  const hasSeparator = /[\s().\-]/.test(trimmed);
  if (!hasPlus && !hasSeparator && digitCount < 9) return false;

  // `1.5.3` / `10.20.30` — version-ish runs separated only by single dots.
  if (!hasPlus && /^\d{1,3}(?:\.\d{1,3}){2,}$/.test(trimmed)) return false;

  return true;
}

/**
 * The URI to hand to the platform, or null when the match cannot be turned
 * into one (such a span renders as plain text rather than a dead link).
 */
export function uriForSpan(span: ElcLinkSpan): string | null {
  switch (span.kind) {
    case 'url': {
      const hasScheme = span.text.startsWith('http://') || span.text.startsWith('https://');
      return hasScheme ? span.text : `https://${span.text}`;
    }
    case 'email':
      return `mailto:${span.text}`;
    case 'phone': {
      // Keep only what a dialer accepts: a leading `+` and digits.
      const digits = span.text.replace(/[^\d+]/g, '');
      const normalized = digits.startsWith('+')
        ? `+${digits.slice(1).replace(/\+/g, '')}`
        : digits.replace(/\+/g, '');
      return normalized.replace(/\+/g, '').length === 0 ? null : `tel:${normalized}`;
    }
  }
}

/** Open a span's target. Never throws — an unopenable link is a no-op. */
export async function openElcLink(span: ElcLinkSpan): Promise<void> {
  const uri = uriForSpan(span);
  if (uri == null) return;
  try {
    await Linking.openURL(uri);
  } catch {
    // No handler installed / platform refused — nothing useful to show inside
    // a message bubble.
  }
}

export interface LinkifiedTextProps {
  text: string;
  style: TextStyle;
  /**
   * Colour for the tappable runs. Kept separate from `style` so a bubble can
   * keep its own foreground contrast — a link on the accent-coloured customer
   * bubble must not switch to the accent colour.
   */
  linkColor: string;
}

/**
 * Renders `text` with detected URLs / emails / phone numbers as tappable,
 * underlined runs. Plain text renders identically to a bare `<Text>` when
 * nothing is detected.
 */
export function LinkifiedText({ text, style, linkColor }: LinkifiedTextProps): React.JSX.Element {
  const spans = useMemo(() => detectLinks(text), [text]);
  // Each message faces the way ITS OWN text reads, not the way the workspace
  // does. A thread where the visitor writes Arabic and the agent answers in
  // English is the normal case in a bilingual workspace, and forcing one
  // direction on both put half of it against the wrong edge with the
  // punctuation on the wrong end.
  const writingDirection = textDirectionOf(text) ?? undefined;

  if (spans.length === 0) {
    return <Text style={[style, writingDirection != null ? { writingDirection } : null]}>{text}</Text>;
  }

  const linkStyle: TextStyle = {
    color: linkColor,
    textDecorationLine: 'underline',
    textDecorationColor: linkColor,
    fontWeight: '600',
  };

  const children: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, i) => {
    if (span.start > cursor) {
      children.push(<Text key={`t${i}`}>{text.slice(cursor, span.start)}</Text>);
    }
    children.push(
      <Text
        key={`l${i}`}
        style={linkStyle}
        accessibilityRole="link"
        onPress={() => {
          void openElcLink(span);
        }}
      >
        {span.text}
      </Text>,
    );
    cursor = span.end;
  });
  if (cursor < text.length) children.push(<Text key="tail">{text.slice(cursor)}</Text>);

  return (
    <Text style={[style, writingDirection != null ? { writingDirection } : null]}>{children}</Text>
  );
}
