/**
 * Help articles — the workspace's own knowledge base, shown to visitors.
 *
 * Wire shapes of the public (anonymous, no token) endpoints:
 *
 *   GET  /api/widget/:slug/help/articles?q=&locale=&category=&limit=
 *        → { enabled, articles: HelpArticleSummary[], categories: string[] }
 *   GET  /api/widget/:slug/help/articles/:id?locale= → { article: HelpArticle }
 *   POST /api/widget/:slug/help/articles/:id/view      { visitorId, sessionId }
 *   POST /api/widget/:slug/help/articles/:id/feedback  { visitorId, sessionId, helpful }
 *
 * Copied from the server's shared types rather than imported: this SDK ships
 * on its own and cannot depend on the monorepo's packages. Every parser below
 * ignores fields it does not know and defaults the ones it misses, so an older
 * or a newer server reads cleanly.
 */

/** A search shorter than this lists the top articles instead of searching. */
export const HELP_SEARCH_MIN_LENGTH = 2;

/** One row of a list or a search result, as a visitor may see it. */
export interface HelpArticleSummary {
  id: string;
  title: string;
  /** The opening words of the article, markup removed. */
  excerpt: string;
  /** The tenant's category, or null for an uncategorised article. */
  category: string | null;
  /** Null when the server sent no (or an unreadable) date. */
  updatedAt: Date | null;
}

/** One article, in full. */
export interface HelpArticle {
  id: string;
  title: string;
  /**
   * The article in the help-markdown dialect — parse it with
   * `parseHelpMarkdown` and draw the tree; never render it as HTML.
   */
  body: string;
  category: string | null;
  /** The article's content-locale code, or null when written for everyone. */
  locale: string | null;
  updatedAt: Date | null;
  /** Its public web page, to share or open in a browser. Empty when absent. */
  url: string;
}

/** The answer of `GET /help/articles`. */
export interface HelpArticleList {
  /**
   * The workspace's "Show help articles" switch. False means there is nothing
   * to show and nothing to offer — `articles` and `categories` are empty.
   */
  enabled: boolean;
  articles: HelpArticleSummary[];
  /** The categories in the order the workspace lists them. */
  categories: string[];
}

/** The answer of `POST /help/articles/:id/view`. */
export interface HelpViewResult {
  /** False when the server had already counted this reading (same session). */
  counted: boolean;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function nullableText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function date(v: unknown): Date | null {
  if (typeof v !== 'string' || v.trim().length === 0) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function record(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function parseHelpArticleSummary(raw: Record<string, unknown>): HelpArticleSummary {
  return {
    id: text(raw.id),
    title: text(raw.title),
    excerpt: text(raw.excerpt),
    category: nullableText(raw.category),
    updatedAt: date(raw.updatedAt),
  };
}

export function parseHelpArticle(raw: Record<string, unknown>): HelpArticle {
  return {
    id: text(raw.id),
    title: text(raw.title),
    body: text(raw.body),
    category: nullableText(raw.category),
    locale: nullableText(raw.locale),
    updatedAt: date(raw.updatedAt),
    url: text(raw.url),
  };
}

/**
 * Parse a list or a search result. Rows without an id are dropped — there is
 * nothing a visitor could open — and so are blank categories.
 */
export function parseHelpArticleList(raw: Record<string, unknown>): HelpArticleList {
  const articles: HelpArticleSummary[] = [];
  if (Array.isArray(raw.articles)) {
    for (const row of raw.articles) {
      const r = record(row);
      if (r == null) continue;
      const summary = parseHelpArticleSummary(r);
      if (summary.id.length > 0) articles.push(summary);
    }
  }
  const categories: string[] = [];
  if (Array.isArray(raw.categories)) {
    for (const c of raw.categories) {
      const name = nullableText(c);
      if (name != null && !categories.includes(name)) categories.push(name);
    }
  }
  return { enabled: raw.enabled === true, articles, categories };
}
