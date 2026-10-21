/**
 * The emoji picker's model — a port of `packages/shared/src/emoji.ts`, the one
 * the web widget's and the dashboard's pickers read: the categories in tab
 * order, how the table is read, the search, and the recently used list.
 *
 * Category NAMES are words, so they live in the string table
 * (`emojiRecent`, `emojiSmileys`, …), in every language the UI ships.
 */
import { EMOJI_TABLE } from './emoji-data';

/** Tabs in picker order. `recent` is the device's own list, first. */
export const EMOJI_CATEGORIES = [
  'recent',
  'smileys',
  'people',
  'animals',
  'food',
  'travel',
  'activities',
  'objects',
  'symbols',
  'flags',
] as const;

export type EmojiCategory = (typeof EMOJI_CATEGORIES)[number];

/** A tab's icon: one emoji standing for it, drawn by the device's own font. */
export const EMOJI_CATEGORY_ICON: Record<EmojiCategory, string> = {
  recent: '🕘',
  smileys: '😀',
  people: '👋',
  animals: '🐻',
  food: '🍔',
  travel: '🚗',
  activities: '⚽',
  objects: '💡',
  symbols: '❤️',
  flags: '🏁',
};

/** The string-table key that names a category. */
export function emojiCategoryKey(category: EmojiCategory): string {
  return `emoji${category.charAt(0).toUpperCase()}${category.slice(1)}`;
}

export interface EmojiEntry {
  emoji: string;
  /** Lower-case English search words. */
  words: string[];
}

export type EmojiCatalog = Array<{ category: Exclude<EmojiCategory, 'recent'>; emoji: EmojiEntry[] }>;

/** Read a table shaped like `EMOJI_TABLE` (./emoji-data) into lists. */
export function emojiCatalog(table: Record<string, string> = EMOJI_TABLE): EmojiCatalog {
  const out: EmojiCatalog = [];
  for (const category of EMOJI_CATEGORIES) {
    if (category === 'recent') continue;
    const raw = table[category];
    if (!raw) continue;
    out.push({
      category,
      emoji: raw.split('|').map((entry) => {
        const space = entry.indexOf(' ');
        return space === -1
          ? { emoji: entry, words: [] }
          : { emoji: entry.slice(0, space), words: entry.slice(space + 1).split(' ').filter(Boolean) };
      }),
    });
  }
  return out;
}

let shared: EmojiCatalog | null = null;

/** The shipped table, read once, on first use. */
export function defaultEmojiCatalog(): EmojiCatalog {
  shared ??= emojiCatalog(EMOJI_TABLE);
  return shared;
}

/**
 * Emoji whose words match every word of `query` (each as a word's start —
 * "hap" finds 😀 "happy"), best first: an exact word beats a prefix, and the
 * table's own order breaks ties. A query that is itself an emoji finds it.
 * The words are English, as on the web.
 */
export function searchEmoji(catalog: EmojiCatalog, query: string, limit = 120): EmojiEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const scored: Array<{ entry: EmojiEntry; score: number; order: number }> = [];
  let order = 0;
  for (const group of catalog) {
    for (const entry of group.emoji) {
      order++;
      if (entry.emoji === query.trim()) {
        scored.push({ entry, score: -1, order });
        continue;
      }
      let score = 0;
      let all = true;
      for (const term of terms) {
        const exact = entry.words.indexOf(term);
        if (exact !== -1) {
          score += exact;
          continue;
        }
        const prefix = entry.words.findIndex((w) => w.startsWith(term));
        if (prefix === -1) {
          all = false;
          break;
        }
        score += 10 + prefix;
      }
      if (all) scored.push({ entry, score, order });
    }
  }
  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.slice(0, limit).map((s) => s.entry);
}

/** How many emoji the recent row keeps. */
export const RECENT_EMOJI_MAX = 24;

/** The recent list after using `emoji`: it moves to the front, the oldest falls off. */
export function addRecentEmoji(
  recent: readonly string[],
  emoji: string,
  max = RECENT_EMOJI_MAX,
): string[] {
  return [emoji, ...recent.filter((e) => e !== emoji)].slice(0, max);
}

/**
 * The device's recently used emoji, newest first, for this run of the app —
 * as the Flutter UI keeps them. (The web keeps its own in the browser.)
 */
let recent: string[] = [];

export function recentEmoji(): readonly string[] {
  return recent;
}

/** Note `emoji` as just used; returns the new list. */
export function rememberEmoji(emoji: string): readonly string[] {
  recent = addRecentEmoji(recent, emoji);
  return recent;
}

/** Forget the recent list — for tests. */
export function __resetRecentEmoji(): void {
  recent = [];
}
