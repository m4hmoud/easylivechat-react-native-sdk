import { describe, expect, it } from 'vitest';

import {
  helpInlineText,
  parseHelpMarkdown,
  safeHelpHref,
  safeHelpImage,
} from '../src/models/help-markdown';

/**
 * Port of the server's `help-markdown.test.ts`. The tree has to come out the
 * same as the server's, or one article reads differently in the app than in
 * the web widget — so these cases are the server's own.
 */
describe('parseHelpMarkdown', () => {
  it('reads headings, paragraphs with line breaks, lists, quotes, code and rules', () => {
    const blocks = parseHelpMarkdown(
      [
        '# Returns',
        'You can send it back',
        'within 30 days.',
        '',
        '- Pack it',
        '- Print the label',
        '',
        '2. Second',
        '3. Third',
        '',
        '> Keep the receipt',
        '',
        '```',
        'ORDER-123',
        '```',
        '---',
      ].join('\n'),
    );
    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'quote',
      'code',
      'rule',
    ]);
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      children: [
        { type: 'text', text: 'You can send it back' },
        { type: 'break' },
        { type: 'text', text: 'within 30 days.' },
      ],
    });
    expect(blocks[3]).toMatchObject({ type: 'list', ordered: true, start: 2 });
    expect(blocks[5]).toEqual({ type: 'code', text: 'ORDER-123' });
  });

  it('reads emphasis, code, links and images', () => {
    const [p] = parseHelpMarkdown(
      '**Bold** and *it* and `x` and [the page](https://acme.com/a) ![shot](https://acme.com/s.png)',
    );
    expect(p).toEqual({
      type: 'paragraph',
      children: [
        { type: 'strong', children: [{ type: 'text', text: 'Bold' }] },
        { type: 'text', text: ' and ' },
        { type: 'em', children: [{ type: 'text', text: 'it' }] },
        { type: 'text', text: ' and ' },
        { type: 'code', text: 'x' },
        { type: 'text', text: ' and ' },
        { type: 'link', href: 'https://acme.com/a', children: [{ type: 'text', text: 'the page' }] },
        { type: 'text', text: ' ' },
        { type: 'image', src: 'https://acme.com/s.png', alt: 'shot' },
      ],
    });
  });

  it('caps headings at three levels and keeps an indented line with its item', () => {
    const [h, list] = parseHelpMarkdown('##### Deep\n- one\n  still one\n- two');
    expect(h).toMatchObject({ type: 'heading', level: 3 });
    expect(list).toMatchObject({ type: 'list', ordered: false });
    expect(list?.type === 'list' ? list.items.map(helpInlineText) : []).toEqual([
      'one still one',
      'two',
    ]);
  });

  it('never turns another scheme into a link or an image', () => {
    const [p] = parseHelpMarkdown('[click](javascript:alert(1)) ![x](data:image/png;base64,AAA)');
    expect(JSON.stringify(p)).not.toContain('"link"');
    expect(JSON.stringify(p)).not.toContain('"image"');
    expect(safeHelpHref('javascript:alert(1)')).toBeNull();
    expect(safeHelpHref('JAVASCRIPT:alert(1)')).toBeNull();
    expect(safeHelpHref('data:text/html,hi')).toBeNull();
    expect(safeHelpHref('//evil.example')).toBeNull();
    expect(safeHelpHref('https://')).toBeNull();
    expect(safeHelpHref('https://acme.com/a\nb')).toBeNull();
    expect(safeHelpHref('mailto:help@acme.com')).toBe('mailto:help@acme.com');
    expect(safeHelpHref('tel:+9647700000000')).toBe('tel:+9647700000000');
    expect(safeHelpHref(' https://acme.com/help ')).toBe('https://acme.com/help');
  });

  it('loads images over http(s) only', () => {
    expect(safeHelpImage('https://acme.com/a.png')).toBe('https://acme.com/a.png');
    expect(safeHelpImage('mailto:a@b.c')).toBeNull();
    expect(safeHelpImage('file:///etc/passwd')).toBeNull();
    const [p] = parseHelpMarkdown('![x](mailto:a@b.c)');
    expect(JSON.stringify(p)).not.toContain('"image"');
  });

  it('shows raw HTML as the characters it is', () => {
    const [p] = parseHelpMarkdown('<img src=x onerror=alert(1)>');
    expect(p).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }],
    });
  });

  it('links bare URLs but not inside a link', () => {
    const [p] = parseHelpMarkdown('See https://acme.com/help.');
    expect(p).toMatchObject({
      children: [
        { type: 'text', text: 'See ' },
        { type: 'link', href: 'https://acme.com/help' },
        { type: 'text', text: '.' },
      ],
    });
    const [q] = parseHelpMarkdown('[https://a.com](https://b.com)');
    expect(q).toEqual({
      type: 'paragraph',
      children: [
        { type: 'link', href: 'https://b.com', children: [{ type: 'text', text: 'https://a.com' }] },
      ],
    });
  });

  it('leaves snake_case, sums and lone stars alone — in any script', () => {
    const [p] = parseHelpMarkdown('use order_id_here and 2*3 is * fine');
    expect(p?.type === 'paragraph' ? helpInlineText(p.children) : '').toBe(
      'use order_id_here and 2*3 is * fine',
    );
    const [ar] = parseHelpMarkdown('رقم_الطلب_هنا');
    expect(ar).toEqual({ type: 'paragraph', children: [{ type: 'text', text: 'رقم_الطلب_هنا' }] });
  });

  it('reads Arabic-script emphasis', () => {
    const [p] = parseHelpMarkdown('**مهم** جداً');
    expect(p).toEqual({
      type: 'paragraph',
      children: [
        { type: 'strong', children: [{ type: 'text', text: 'مهم' }] },
        { type: 'text', text: ' جداً' },
      ],
    });
  });

  it('honours backslash escapes', () => {
    const [p] = parseHelpMarkdown('\\*not italic\\*');
    expect(p).toEqual({ type: 'paragraph', children: [{ type: 'text', text: '*not italic*' }] });
  });

  it('returns nothing for nothing', () => {
    expect(parseHelpMarkdown('')).toEqual([]);
    expect(parseHelpMarkdown(null)).toEqual([]);
    expect(parseHelpMarkdown(undefined)).toEqual([]);
    expect(parseHelpMarkdown('\n\n  \n')).toEqual([]);
  });

  it('stays fast on pathological input', () => {
    const evil = '**a '.repeat(10_000) + '[('.repeat(5_000);
    const t = Date.now();
    parseHelpMarkdown(evil);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
