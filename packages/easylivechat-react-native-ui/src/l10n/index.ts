import { deviceLocale } from '../bidi';
import STRINGS from './strings.json';

/**
 * SDK "chrome" strings for the prebuilt UI (`Send`, `Rate your chat`, …).
 *
 * These are the framework's own labels — DISTINCT from tenant-authored copy
 * (`welcomeTitle`, `offlineMessage`, pre-chat and post-chat field labels),
 * which is written per language in the dashboard and rendered VERBATIM, never
 * localized.
 *
 * 13 locales ship (`en ar ckb de es fr hi it kmr pt tr ur zh`), matching the
 * dashboard, and any missing key or locale falls back to English AT RUNTIME —
 * never hardcode English at the call site (the project's i18n rule).
 *
 * Resolution: host-forced locale → explicit prop → server workspace locale →
 * device locale → `en`. Matching is by the LANGUAGE SUBTAG only (`pt-BR` →
 * `pt`, `zh-Hans` → `zh`).
 */
export type StringsTable = Record<string, Record<string, string>>;

const TABLE = STRINGS as unknown as StringsTable;

/** Every key the SDK renders. Derived from the English table, which is total. */
export type StringKey = keyof (typeof STRINGS)['en'];

export const SUPPORTED_LOCALES: readonly string[] = Object.keys(TABLE);

/** Host overrides that apply to EVERY locale. */
let allLocaleOverrides: Record<string, string> = {};

/** Host overrides keyed by locale: `{ ckb: { send: 'بنێرە' } }`. */
let perLocaleOverrides: Record<string, Record<string, string>> = {};

/** Host-forced chrome locale, winning over everything the server says. */
let hostLocale: string | null = null;

/**
 * Replace the all-locale host overrides. Pass `{}` to clear.
 *
 * These apply to EVERY locale. A host whose own copy is multilingual wants
 * {@link overrideByLocale} instead — this one silently shows the same words to
 * a Kurdish and an Arabic visitor.
 */
export function overrideAll(strings: Record<string, string>): void {
  allLocaleOverrides = { ...strings };
}

/**
 * Per-locale host overrides.
 *
 * Beats {@link overrideAll} key by key, because it is the more specific
 * statement. Locale codes are normalized the same way everything else is, so
 * `ku`, `CKB` and `ckb-IQ` all land on `ckb`.
 *
 * A locale the SDK does not ship works too: supply `{ fa: { … } }` and a
 * Persian visitor gets those strings, falling back to English for keys the
 * host did not provide. That makes this the way to add a language WITHOUT
 * waiting on an SDK release.
 */
export function overrideByLocale(byLocale: Record<string, Record<string, string>>): void {
  const out: Record<string, Record<string, string>> = {};
  for (const [code, strings] of Object.entries(byLocale)) {
    const normalized = normalizeLocale(code);
    if (normalized == null) continue;
    out[normalized] = { ...strings };
  }
  perLocaleOverrides = out;
}

/** Force the chrome locale from the host app. Pass null to clear. */
export function setHostLocale(code: string | null): void {
  hostLocale = code;
}

/**
 * Normalize a locale code to its language subtag.
 *
 * Kurdish: `ckb` (Central Kurdish / Sorani) and `kmr` (Northern Kurdish /
 * Kurmanji / Badini) each have their own table. `ku` is the DEPRECATED
 * macrolanguage code platforms still report for Sorani — accepted here so an
 * older host, or a server row not yet migrated, keeps working.
 */
export function normalizeLocale(code: string | null | undefined): string | null {
  if (code == null) return null;
  const c = code.trim().toLowerCase();
  if (c.length === 0) return null;
  const lang = c.split(/[-_]/)[0] ?? '';
  if (lang.length === 0) return null;
  return lang === 'ku' ? 'ckb' : lang;
}

/** A locale we can render: one we ship, or one the host supplied strings for. */
function isKnown(code: string): boolean {
  return TABLE[code] != null || perLocaleOverrides[code] != null;
}

/** Resolve the chrome locale for this render. */
export function resolveLocale(localeCode?: string | null): string {
  const host = normalizeLocale(hostLocale);
  if (host != null && isKnown(host)) return host;
  const explicit = normalizeLocale(localeCode);
  if (explicit != null && isKnown(explicit)) return explicit;
  const device = normalizeLocale(deviceLocale());
  if (device != null && isKnown(device)) return device;
  return 'en';
}

/** The resolved string table for one locale. */
export interface Strings {
  readonly locale: string;
  /** Look up a key, applying overrides then falling back to English. */
  t(key: string): string;
  /** Map a server/SDK error code to a human, localized message. */
  forErrorCode(code: string): string;
}

const EN = TABLE.en ?? {};

class StringsImpl implements Strings {
  constructor(readonly locale: string) {}

  t = (key: string): string => {
    // Most specific first: this locale's host override, then the host's
    // all-locale override, then the shipped table, then English, then the key
    // itself (which is at least diagnosable, unlike an empty string).
    const perLocale = perLocaleOverrides[this.locale]?.[key];
    if (perLocale != null && perLocale.length > 0) return perLocale;
    const all = allLocaleOverrides[key];
    if (all != null && all.length > 0) return all;
    const table = TABLE[this.locale] ?? EN;
    return table[key] ?? EN[key] ?? key;
  };

  forErrorCode = (code: string): string => {
    switch (code) {
      case 'REQUIRED':
        return this.t('fieldRequired');
      case 'INVALID_EMAIL':
        return this.t('invalidEmail');
      case 'INVALID_NUMBER':
        return this.t('invalidNumber');
      case 'INVALID_OPTION':
        return this.t('invalidOption');
      case 'INVALID_RATING':
        // The survey's rating field. "Please pick a rating" and "this field is
        // required" are the same instruction to a visitor staring at an unset
        // row of stars.
        return this.t('fieldRequired');
      default:
        return this.t('somethingWentWrong');
    }
  };
}

const cache = new Map<string, Strings>();

/**
 * Strings for a locale.
 *
 * The instance is cached per locale so `t` keeps a stable identity across
 * renders (it is a bound arrow property), which matters wherever it lands in a
 * dependency array. The cache is cleared whenever overrides change, since
 * those are baked into the lookup.
 */
export function stringsFor(localeCode?: string | null): Strings {
  const locale = resolveLocale(localeCode);
  let s = cache.get(locale);
  if (s == null) {
    s = new StringsImpl(locale);
    cache.set(locale, s);
  }
  return s;
}

/** Raw table access, for the parity test. */
export function rawTable(): StringsTable {
  return TABLE;
}

/** Reset every host override — used by tests to isolate cases. */
export function __resetOverrides(): void {
  allLocaleOverrides = {};
  perLocaleOverrides = {};
  hostLocale = null;
}
