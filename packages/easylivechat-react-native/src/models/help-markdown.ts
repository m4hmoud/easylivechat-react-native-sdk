/**
 * The markdown a help article is written in, parsed to a tree.
 *
 * A port of the server's own dialect (the web widget, the public article
 * pages and the dashboard preview all read the same tree), so an article looks
 * the same in every client. Draw the tree with your own components — the UI
 * package's `HelpMarkdownView` does — and never build markup from a string:
 * raw HTML in an article is shown as the characters it is.
 *
 * A deliberately small dialect: headings, paragraphs (a single newline is a
 * line break, as people expect from a text box), bulleted and numbered lists,
 * quotes, fenced code, a rule, **bold**, *italic*, `code`, [links](https://…)
 * and ![images](https://…). Links are http(s), mailto: and tel: only, images
 * http(s) only — anything else stays text, so `javascript:` can never become
 * something to tap.
 *
 * Two differences from the server's copy, both because of React Native:
 * schemes are checked with patterns rather than `new URL()` (RN's `URL` throws
 * on `.protocol`), and the letter/number test falls back to explicit ranges on
 * an engine without Unicode property escapes.
 *
 * Linear in the input apart from the delimiter look-ahead, which is capped, so
 * a pathological article cannot stall the app.
 */

export type HelpInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: HelpInline[] }
  | { type: 'em'; children: HelpInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: HelpInline[] }
  | { type: 'image'; src: string; alt: string }
  | { type: 'break' };

export type HelpBlock =
  | { type: 'heading'; level: 1 | 2 | 3; children: HelpInline[] }
  | { type: 'paragraph'; children: HelpInline[] }
  | { type: 'list'; ordered: boolean; start: number; items: HelpInline[][] }
  | { type: 'quote'; children: HelpBlock[] }
  | { type: 'code'; text: string }
  | { type: 'rule' };

/** How far ahead a closing `**` / `]` / `)` is looked for. */
const LOOKAHEAD = 2000;
/** Emphasis inside emphasis inside a link… stops here and is shown as text. */
const MAX_INLINE_DEPTH = 4;
const MAX_QUOTE_DEPTH = 2;

/** An http(s) address with a host, and no whitespace or control characters. */
const HTTP_URL = /^https?:\/\/[^\s/?#\\]+[^\s]*$/i;
const MAILTO = /^mailto:[^\s]+$/i;
const TEL = /^tel:[^\s]+$/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** `url` when it is safe to put behind a link (http(s), mailto:, tel:), else null. */
export function safeHelpHref(url: string): string | null {
  const u = url.trim();
  if (u.length === 0 || CONTROL.test(u)) return null;
  return HTTP_URL.test(u) || MAILTO.test(u) || TEL.test(u) ? u : null;
}

/** `url` when it is safe to load as an image (http(s) only), else null. */
export function safeHelpImage(url: string): string | null {
  const u = url.trim();
  if (u.length === 0 || CONTROL.test(u)) return null;
  return HTTP_URL.test(u) ? u : null;
}

// ── bare links ─────────────────────────────────────────────────────────────

/** Only an explicit `http(s)://` is linked in running text — never a bare domain. */
const BARE_URL = /https?:\/\/[^\s<>"'`]+/gi;

function unbalanced(s: string, open: string, close: string): boolean {
  return s.split(close).length - 1 > s.split(open).length - 1;
}

/** Trailing characters that read as the sentence's punctuation, not the address's. */
function trimTrailing(url: string): string {
  let out = url;
  for (;;) {
    const last = out[out.length - 1];
    if (last == null) return out;
    if ('.,;:!?"\''.includes(last)) {
      out = out.slice(0, -1);
      continue;
    }
    if (last === ')' && unbalanced(out, '(', ')')) {
      out = out.slice(0, -1);
      continue;
    }
    if (last === ']' && unbalanced(out, '[', ']')) {
      out = out.slice(0, -1);
      continue;
    }
    return out;
  }
}

interface LinkSegment {
  text: string;
  href?: string;
}

function linkSegments(text: string): LinkSegment[] {
  if (!text.includes('://')) return [{ text }];
  const out: LinkSegment[] = [];
  let last = 0;
  BARE_URL.lastIndex = 0;
  for (let m = BARE_URL.exec(text); m != null; m = BARE_URL.exec(text)) {
    const href = trimTrailing(m[0]);
    if (!HTTP_URL.test(href)) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: href, href });
    last = m.index + href.length;
  }
  if (out.length === 0) return [{ text }];
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

// ── inline ─────────────────────────────────────────────────────────────────

const ESCAPABLE = new Set('\\`*_[]()#!>+-.~|{}'.split(''));
const SPACE = /\s/;

/**
 * A letter or a digit in any script. Unicode property escapes are the right
 * tool, but a regex that fails to COMPILE takes the whole bundle down on an
 * engine without them, so the pattern is built defensively with a fallback
 * covering the scripts the product ships.
 */
const WORD: RegExp = (() => {
  try {
    return new RegExp('[\\p{L}\\p{N}]', 'u');
  } catch {
    return /[0-9A-Za-zªµºÀ-ɏͰ-ϿЀ-ӿ԰-֏א-תؠ-ي٠-٩ٮ-ۓەۥ-ۦۮ-ۼۿݐ-ݿऀ-ॿ฀-๿ᄀ-ᇿ぀-ヿ㐀-䶿一-鿿가-힯]/;
  }
})();

function isWord(ch: string | undefined): boolean {
  return ch != null && WORD.test(ch);
}

function isSpace(ch: string | undefined): boolean {
  return ch != null && SPACE.test(ch);
}

function pushText(out: HelpInline[], text: string, inLink: boolean): void {
  if (text.length === 0) return;
  if (inLink) {
    out.push({ type: 'text', text });
    return;
  }
  for (const seg of linkSegments(text)) {
    if (seg.href != null) {
      out.push({ type: 'link', href: seg.href, children: [{ type: 'text', text: seg.text }] });
    } else if (seg.text.length > 0) {
      out.push({ type: 'text', text: seg.text });
    }
  }
}

/** `[text](url)` starting at `i` (which holds `[`), or null. */
function matchLink(s: string, i: number): { text: string; url: string; end: number } | null {
  let depth = 0;
  let close = -1;
  const limit = Math.min(s.length, i + LOOKAHEAD);
  for (let j = i; j < limit; j++) {
    const ch = s[j];
    if (ch === '\\') {
      j++;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        close = j;
        break;
      }
    }
  }
  if (close < 0 || s[close + 1] !== '(') return null;
  let parens = 0;
  let end = -1;
  const urlLimit = Math.min(s.length, close + 2 + LOOKAHEAD);
  for (let j = close + 2; j < urlLimit; j++) {
    const ch = s[j];
    if (ch === '\n') return null;
    if (ch === '(') parens++;
    else if (ch === ')') {
      if (parens === 0) {
        end = j;
        break;
      }
      parens--;
    }
  }
  if (end < 0) return null;
  // `(url "title")` — the title is dropped; the address is the first word.
  const url = s.slice(close + 2, end).trim().split(/\s+/)[0] ?? '';
  return { text: s.slice(i + 1, close), url: url.replace(/^<|>$/g, ''), end: end + 1 };
}

/** The index of the `delim` that closes an emphasis opened before `from`, or -1. */
function findClose(s: string, from: number, delim: string): number {
  const limit = Math.min(s.length, from + LOOKAHEAD);
  let j = s.indexOf(delim, from + 1);
  while (j !== -1 && j < limit) {
    const before = s[j - 1];
    const after = s[j + delim.length];
    const rightFlanking = before != null && !isSpace(before);
    // `**` is not closed by the first half of a `***`, nor `*` by half a `**`.
    const clean = delim.length === 2 || (s[j + 1] !== delim[0] && before !== delim[0]);
    const wordEnd = delim[0] !== '_' || after == null || !isWord(after);
    if (rightFlanking && clean && wordEnd && !s.slice(from, j).includes('\n\n')) return j;
    j = s.indexOf(delim, j + 1);
  }
  return -1;
}

function parseInline(s: string, depth: number, inLink: boolean): HelpInline[] {
  const out: HelpInline[] = [];
  let buf = '';
  const flush = (): void => {
    pushText(out, buf, inLink);
    buf = '';
  };
  const nested = (text: string, link: boolean): HelpInline[] =>
    depth < MAX_INLINE_DEPTH ? parseInline(text, depth + 1, link) : [{ type: 'text', text }];

  let i = 0;
  while (i < s.length) {
    const ch = s[i] as string;
    const next = s[i + 1];

    if (ch === '\\' && next != null && ESCAPABLE.has(next)) {
      buf += next;
      i += 2;
      continue;
    }

    if (ch === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1 && end - i < LOOKAHEAD) {
        flush();
        out.push({ type: 'code', text: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (ch === '!' && next === '[') {
      const m = matchLink(s, i + 1);
      const src = m != null ? safeHelpImage(m.url) : null;
      if (m != null && src != null) {
        flush();
        out.push({ type: 'image', src, alt: m.text.trim() });
        i = m.end;
        continue;
      }
    }

    if (ch === '[' && !inLink) {
      const m = matchLink(s, i);
      const href = m != null ? safeHelpHref(m.url) : null;
      if (m != null && href != null) {
        flush();
        const children = nested(m.text, true);
        out.push({
          type: 'link',
          href,
          children: children.length > 0 ? children : [{ type: 'text', text: href }],
        });
        i = m.end;
        continue;
      }
    }

    if (ch === '*' || ch === '_') {
      const double = next === ch;
      const delim = double ? ch + ch : ch;
      const after = s[i + delim.length];
      const before = i > 0 ? s[i - 1] : undefined;
      // snake_case and 2*3*4 are words and sums, not emphasis.
      const intraword = ch === '_' && isWord(before);
      if (after != null && !isSpace(after) && !intraword) {
        const close = findClose(s, i + delim.length - 1, delim);
        if (close > i + delim.length - 1) {
          flush();
          out.push({
            type: double ? 'strong' : 'em',
            children: nested(s.slice(i + delim.length, close), inLink),
          });
          i = close + delim.length;
          continue;
        }
      }
      // An unmatched delimiter is just a character; a run of them stays together.
      buf += delim;
      i += delim.length;
      continue;
    }

    if (ch === '\n') {
      flush();
      out.push({ type: 'break' });
      i++;
      continue;
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

// ── blocks ─────────────────────────────────────────────────────────────────

const FENCE = /^\s{0,3}(```|~~~)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line)
  );
}

function parseBlocks(lines: readonly string[], quoteDepth: number): HelpBlock[] {
  const blocks: HelpBlock[] = [];
  const at = (k: number): string => lines[k] ?? '';
  let i = 0;
  while (i < lines.length) {
    const line = at(i);

    if (line.trim().length === 0) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence != null) {
      const marker = fence[1] ?? '```';
      const body: string[] = [];
      i++;
      while (i < lines.length && !at(i).trimStart().startsWith(marker)) body.push(at(i++));
      i++; // the closing fence, or the end
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading != null) {
      const level = Math.min((heading[1] ?? '#').length, 3) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, children: parseInline(heading[2] ?? '', 0, false) });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      for (let m = QUOTE.exec(at(i)); i < lines.length && m != null; m = QUOTE.exec(at(i))) {
        inner.push(m[1] ?? '');
        i++;
      }
      blocks.push({
        type: 'quote',
        children:
          quoteDepth < MAX_QUOTE_DEPTH
            ? parseBlocks(inner, quoteDepth + 1)
            : [{ type: 'paragraph', children: parseInline(inner.join('\n'), 0, false) }],
      });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet != null ? null : NUMBERED.exec(line);
    if (bullet != null || numbered != null) {
      const ordered = numbered != null;
      const pattern = ordered ? NUMBERED : BULLET;
      const start = numbered != null ? Math.min(parseInt(numbered[1] ?? '1', 10), 999_999) : 1;
      const items: string[] = [];
      while (i < lines.length) {
        const m = pattern.exec(at(i));
        if (m != null) {
          items.push((ordered ? m[2] : m[1]) ?? '');
          i++;
          continue;
        }
        // An indented line carries on the item above it.
        const cur = at(i);
        if (items.length > 0 && cur.trim().length > 0 && /^\s{2,}/.test(cur) && !startsBlock(cur)) {
          items[items.length - 1] += `\n${cur.trim()}`;
          i++;
          continue;
        }
        break;
      }
      blocks.push({
        type: 'list',
        ordered,
        start,
        items: items.map((t) => parseInline(t, 0, false)),
      });
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      at(i).trim().length > 0 &&
      (para.length === 0 || !startsBlock(at(i)))
    ) {
      para.push(at(i).trim());
      i++;
    }
    blocks.push({ type: 'paragraph', children: parseInline(para.join('\n'), 0, false) });
  }
  return blocks;
}

/** An article body as blocks, ready to draw. */
export function parseHelpMarkdown(src: string | null | undefined): HelpBlock[] {
  if (src == null || src.length === 0) return [];
  return parseBlocks(src.replace(/\r\n?/g, '\n').split('\n'), 0);
}

/** The words of a run of inlines, markup gone — for accessibility labels and direction. */
export function helpInlineText(nodes: readonly HelpInline[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text' || n.type === 'code') out += n.text;
    else if (n.type === 'break') out += ' ';
    else if (n.type === 'image') out += n.alt;
    else out += helpInlineText(n.children);
  }
  return out;
}
