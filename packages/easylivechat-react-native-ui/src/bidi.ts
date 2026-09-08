import { NativeModules, Platform } from 'react-native';

import type { Direction } from './direction';

/**
 * The direction a piece of text wants to be laid out in, from its own content
 * — the rule HTML calls `dir="auto"`.
 *
 * A composer takes the workspace's direction, which is right until somebody
 * types in another language. An Arabic sentence in an English workspace was
 * laid out left-to-right: the caret sat on the wrong end, punctuation landed
 * on the wrong side, and the text hugged the wrong edge of the box. The
 * keyboard's language is not something iOS or Android tells an app, so the
 * FIRST STRONGLY-DIRECTIONAL CHARACTER the visitor types is the signal — the
 * same one every messenger uses.
 *
 * Returns null for text with nothing strong in it (empty, digits, emoji,
 * punctuation), where the caller should KEEP whatever direction it had.
 */
export function textDirectionOf(text: string): Direction | null {
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c == null) continue;
    if (isStrongRtl(c)) return 'rtl';
    if (isStrongLtr(c)) return 'ltr';
  }
  return null;
}

/**
 * Right-to-left scripts, by Unicode block.
 *
 * Arabic covers Persian, Urdu and Kurdish Sorani — the three the product ships
 * and the reason this exists. Hebrew, Syriac, Thaana and N'Ko are here because
 * a visitor writing in them has the same problem and the ranges cost nothing;
 * the Arabic Presentation Forms blocks catch text that arrives already shaped.
 */
function isStrongRtl(c: number): boolean {
  return (
    (c >= 0x0590 && c <= 0x05ff) || // Hebrew
    (c >= 0x0600 && c <= 0x06ff) || // Arabic
    (c >= 0x0700 && c <= 0x074f) || // Syriac
    (c >= 0x0750 && c <= 0x077f) || // Arabic Supplement
    (c >= 0x0780 && c <= 0x07bf) || // Thaana
    (c >= 0x07c0 && c <= 0x07ff) || // N'Ko
    (c >= 0x0860 && c <= 0x08ff) || // Syriac Supplement + Arabic Extended-A
    (c >= 0xfb1d && c <= 0xfdff) || // Hebrew + Arabic Presentation Forms-A
    (c >= 0xfe70 && c <= 0xfeff) // Arabic Presentation Forms-B
  );
}

/**
 * Left-to-right: the Latin/Greek/Cyrillic range plus everything above the RTL
 * blocks. Deliberately coarse — this only has to answer "is the first strong
 * character RTL or not", and anything that is neither returns null above and
 * leaves the caller's direction alone.
 */
function isStrongLtr(c: number): boolean {
  return (
    (c >= 0x0041 && c <= 0x005a) || // A-Z
    (c >= 0x0061 && c <= 0x007a) || // a-z
    (c >= 0x00c0 && c <= 0x058f) || // Latin-1 supplement … Armenian
    (c >= 0x0900 && c <= 0x1fff) || // Devanagari … Greek Extended
    (c >= 0x2c00 && c <= 0xd7ff) || // Glagolitic … Hangul
    (c >= 0xf900 && c <= 0xfb17) || // CJK compatibility … Alphabetic pres.
    (c >= 0x10000 && c <= 0x10fff) // Linear B and friends
  );
}

/**
 * The languages that are written right-to-left, by subtag.
 *
 * `ckb` and `kmr` are the product's two Kurdish codes and `ku` the deprecated
 * macrolanguage some platforms still report for Sorani.
 */
const RTL_LANGUAGES = new Set([
  'ar',
  'fa',
  'he',
  'iw',
  'ur',
  'ps',
  'sd',
  'ug',
  'yi',
  'ji',
  'dv',
  'ku',
  'ckb',
  'kmr',
  'arc',
  'syr',
  'nqo',
  'rhg',
]);

export function isRtlLanguage(languageCode: string): boolean {
  const lang = languageCode.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return RTL_LANGUAGES.has(lang);
}

/**
 * The device's PRIMARY locale, read from the platform without a dependency.
 *
 * `expo-localization` would answer this, but making it a required peer for one
 * string is not worth it — these are the same natives RN itself reads.
 */
export function deviceLocale(): string {
  try {
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings as
        | { AppleLocale?: string; AppleLanguages?: string[] }
        | undefined;
      const fromList = settings?.AppleLanguages?.[0];
      return settings?.AppleLocale ?? fromList ?? 'en';
    }
    const localeIdentifier = (NativeModules.I18nManager as { localeIdentifier?: string } | undefined)
      ?.localeIdentifier;
    return localeIdentifier ?? 'en';
  } catch {
    // A platform that exposes neither is not worth an exception; English is
    // the documented final fallback everywhere else in the SDK too.
    return 'en';
  }
}

/**
 * Which way the visitor's PHONE is written, for an EMPTY composer.
 *
 * The keyboard's language would be the right answer and there is no way to ask
 * for it: React Native surfaces no API for the active input method, and
 * reading `UITextInputMode` / `InputMethodManager` means native code, which
 * would turn this package into a native module and change the build of every
 * app that embeds it. The device's own language is the closest thing that
 * costs nothing — someone whose phone is in Kurdish is typing Kurdish.
 *
 * Only the PRIMARY locale counts. Someone with an English phone who also has
 * an Arabic keyboard installed has Arabic somewhere in their locale list, and
 * turning their composer around on that would be wrong more often than right.
 */
export function deviceTextDirection(): Direction | null {
  return isRtlLanguage(deviceLocale()) ? 'rtl' : null;
}
