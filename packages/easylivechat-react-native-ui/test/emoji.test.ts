import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUICK_REACTIONS } from '@easylivechat/react-native';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EMOJI_CATEGORIES,
  EMOJI_CATEGORY_ICON,
  __resetRecentEmoji,
  addRecentEmoji,
  defaultEmojiCatalog,
  emojiCategoryKey,
  recentEmoji,
  rememberEmoji,
  searchEmoji,
} from '../src/emoji/emoji';
import { rawTable } from '../src/l10n';

/**
 * Port of `packages/shared/src/emoji.test.ts` — the model every EasyLiveChat
 * picker reads — so the RN picker finds what the web widget's finds.
 */
const catalog = defaultEmojiCatalog();
const all = catalog.flatMap((g) => g.emoji);

describe('the emoji catalog', () => {
  it('has every category but the device’s own recent list, in picker order', () => {
    expect(catalog.map((g) => g.category)).toEqual(EMOJI_CATEGORIES.filter((c) => c !== 'recent'));
    for (const c of EMOJI_CATEGORIES) expect(EMOJI_CATEGORY_ICON[c]).toBeTruthy();
  });

  it('holds well-formed, distinct emoji with search words', () => {
    expect(all.length).toBe(1805);
    expect(new Set(all.map((e) => e.emoji)).size).toBe(all.length);
    for (const e of all) expect(e.words.length, e.emoji).toBeGreaterThan(0);
  });

  it('offers every quick reaction', () => {
    for (const q of QUICK_REACTIONS) expect(all.some((e) => e.emoji === q), q).toBe(true);
  });

  it('names every category in every language the UI ships', () => {
    for (const [locale, entries] of Object.entries(rawTable())) {
      for (const c of EMOJI_CATEGORIES) {
        expect(entries[emojiCategoryKey(c)]?.trim(), `${locale}.${emojiCategoryKey(c)}`).toBeTruthy();
      }
    }
  });

  // The same table as the web's. Only inside the monorepo: the public mirror
  // of this SDK carries no `packages/shared`.
  const shared = join(__dirname, '../../../../packages/shared/src/emoji-data.ts');
  it.skipIf(!existsSync(shared))('is the shared table, byte for byte below its header', () => {
    const body = (path: string): string => {
      const text = readFileSync(path, 'utf8');
      return text.slice(text.indexOf("import type { EmojiCategory } from './emoji';"));
    };
    expect(body(join(__dirname, '../src/emoji/emoji-data.ts'))).toBe(body(shared));
  });
});

describe('searchEmoji', () => {
  it('finds by word start, every word, best match first', () => {
    expect(searchEmoji(catalog, 'joy')[0]?.emoji).toBe('😂');
    expect(searchEmoji(catalog, 'thumbs up').map((e) => e.emoji)).toContain('👍');
    expect(searchEmoji(catalog, 'pizz').map((e) => e.emoji)).toContain('🍕');
    expect(searchEmoji(catalog, 'germany').map((e) => e.emoji)).toContain('🇩🇪');
    expect(searchEmoji(catalog, 'HAPPY').length).toBeGreaterThan(0);
  });

  it('finds an emoji typed or pasted as itself, first', () => {
    expect(searchEmoji(catalog, '🍕')[0]?.emoji).toBe('🍕');
  });

  it('finds nothing for blank or nonsense, and caps what it finds', () => {
    expect(searchEmoji(catalog, '   ')).toEqual([]);
    expect(searchEmoji(catalog, 'zzzqqq')).toEqual([]);
    expect(searchEmoji(catalog, 'a', 5)).toHaveLength(5);
  });
});

describe('the recent list', () => {
  afterEach(() => __resetRecentEmoji());

  it('keeps it short, newest first, without repeats', () => {
    let recent: string[] = [];
    recent = addRecentEmoji(recent, '👍');
    recent = addRecentEmoji(recent, '😂');
    recent = addRecentEmoji(recent, '👍');
    expect(recent).toEqual(['👍', '😂']);
    expect(addRecentEmoji(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });

  it('is remembered for this run of the app', () => {
    expect(recentEmoji()).toEqual([]);
    rememberEmoji('🍕');
    rememberEmoji('🎉');
    expect(recentEmoji()).toEqual(['🎉', '🍕']);
  });
});
