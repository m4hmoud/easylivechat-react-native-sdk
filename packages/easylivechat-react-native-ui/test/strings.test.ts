import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SUPPORTED_LOCALES,
  __resetOverrides,
  normalizeLocale,
  overrideAll,
  overrideByLocale,
  rawTable,
  resolveLocale,
  setHostLocale,
  stringsFor,
} from '../src/l10n';

/**
 * Ports of `strings_in_sync_test.dart` and `strings_override_test.dart`.
 */
describe('the shipped string table', () => {
  const table = rawTable();

  it('ships every product locale', () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual(
      ['ar', 'ckb', 'de', 'en', 'es', 'fr', 'hi', 'it', 'kmr', 'pt', 'tr', 'ur', 'zh'].sort(),
    );
  });

  it('has FULL parity — every key in every locale, none blank', () => {
    // The project's i18n rule: new strings get a key AND translations in all
    // 12 non-en locales in the same change. A gap here is a visitor reading
    // English inside an otherwise Kurdish screen.
    const en = table.en;
    expect(en).toBeDefined();
    const keys = Object.keys(en!);
    expect(keys.length).toBeGreaterThan(0);

    for (const locale of SUPPORTED_LOCALES) {
      const entries = table[locale];
      expect(entries, `missing locale ${locale}`).toBeDefined();
      expect(Object.keys(entries!).sort(), `key drift in ${locale}`).toEqual([...keys].sort());
      for (const key of keys) {
        expect(entries![key]?.trim(), `${locale}.${key} is blank`).toBeTruthy();
      }
    }
  });

  it('still matches the on-disk strings.json it is compiled from', () => {
    // The Flutter pair drifted apart once already — the JSON carried edits
    // that were never applied, and the only symptom was the app quietly
    // showing the old wording.
    const onDisk = JSON.parse(
      readFileSync(join(__dirname, '../src/l10n/strings.json'), 'utf8'),
    ) as Record<string, Record<string, string>>;
    expect(rawTable()).toEqual(onDisk);
  });

  it('keeps every placeholder that its English original declares', () => {
    const en = table.en!;
    const placeholders = (s: string): string[] => (s.match(/\{[a-z]+\}/gi) ?? []).sort();
    for (const [key, english] of Object.entries(en)) {
      const expected = placeholders(english);
      if (expected.length === 0) continue;
      for (const locale of SUPPORTED_LOCALES) {
        expect(placeholders(table[locale]![key]!), `${locale}.${key}`).toEqual(expected);
      }
    }
  });
});

describe('locale resolution', () => {
  afterEach(() => __resetOverrides());

  it('matches on the language subtag only', () => {
    expect(normalizeLocale('pt-BR')).toBe('pt');
    expect(normalizeLocale('zh-Hans')).toBe('zh');
    expect(normalizeLocale('ar_IQ')).toBe('ar');
    expect(normalizeLocale('  DE  ')).toBe('de');
    expect(normalizeLocale('')).toBeNull();
    expect(normalizeLocale(null)).toBeNull();
  });

  it('maps the deprecated `ku` to `ckb` (Sorani)', () => {
    expect(normalizeLocale('ku')).toBe('ckb');
    expect(normalizeLocale('ku-IQ')).toBe('ckb');
    // `kmr` is Badini/Kurmanji and keeps its own table.
    expect(normalizeLocale('kmr')).toBe('kmr');
  });

  it('prefers the host-forced locale over everything', () => {
    setHostLocale('ar');
    expect(resolveLocale('de')).toBe('ar');
    setHostLocale(null);
    expect(resolveLocale('de')).toBe('de');
  });

  it('falls back to English for a locale nobody supplied', () => {
    expect(resolveLocale('sw')).toBe('en');
    expect(stringsFor('sw').t('send')).toBe('Send');
  });

  it('falls back to English for a MISSING KEY at runtime', () => {
    // Never hardcode English at the call site — this is the fallback.
    expect(stringsFor('ar').t('definitelyNotAKey')).toBe('definitelyNotAKey');
    expect(stringsFor('ar').t('send')).not.toBe('Send');
  });
});

describe('host string overrides', () => {
  afterEach(() => __resetOverrides());

  it('per-locale beats all-locale beats built-in', () => {
    expect(stringsFor('ckb').t('send')).toBe('ناردن');

    overrideAll({ send: 'ALL' });
    expect(stringsFor('ckb').t('send')).toBe('ALL');
    expect(stringsFor('ar').t('send')).toBe('ALL');

    overrideByLocale({ ckb: { send: 'CKB' } });
    // The per-locale map is the MORE SPECIFIC statement, so it wins key by key.
    expect(stringsFor('ckb').t('send')).toBe('CKB');
    expect(stringsFor('ar').t('send')).toBe('ALL');
    // A key neither override defines still comes from the shipped table.
    expect(stringsFor('ckb').t('retry')).not.toBe('Retry');
  });

  it('normalizes the locale keys of a per-locale override', () => {
    overrideByLocale({ KU: { send: 'FROM_KU' }, 'pt-BR': { send: 'FROM_PT' } });
    expect(stringsFor('ckb').t('send')).toBe('FROM_KU');
    expect(stringsFor('pt').t('send')).toBe('FROM_PT');
  });

  it('lets a host add a language the SDK does not ship', () => {
    // Without waiting on an SDK release.
    expect(resolveLocale('fa')).toBe('en');
    overrideByLocale({ fa: { send: 'ارسال' } });
    expect(resolveLocale('fa')).toBe('fa');
    const fa = stringsFor('fa');
    expect(fa.t('send')).toBe('ارسال');
    // …falling back to English for keys the host did not provide.
    expect(fa.t('retry')).toBe('Retry');
  });

  it('ignores a blank override rather than showing an empty label', () => {
    overrideAll({ send: '' });
    expect(stringsFor('en').t('send')).toBe('Send');
  });
});

describe('forErrorCode', () => {
  afterEach(() => __resetOverrides());

  it('maps every validation code to a localized message', () => {
    const en = stringsFor('en');
    expect(en.forErrorCode('REQUIRED')).toBe(en.t('fieldRequired'));
    expect(en.forErrorCode('INVALID_EMAIL')).toBe(en.t('invalidEmail'));
    expect(en.forErrorCode('INVALID_NUMBER')).toBe(en.t('invalidNumber'));
    expect(en.forErrorCode('INVALID_OPTION')).toBe(en.t('invalidOption'));
    // "Please pick a rating" and "this field is required" are the same
    // instruction to a visitor staring at an unset row of stars.
    expect(en.forErrorCode('INVALID_RATING')).toBe(en.t('fieldRequired'));
    expect(en.forErrorCode('FILE_TOO_LARGE')).toBe(en.t('somethingWentWrong'));
    expect(en.forErrorCode('WHATEVER')).toBe(en.t('somethingWentWrong'));
  });
});
