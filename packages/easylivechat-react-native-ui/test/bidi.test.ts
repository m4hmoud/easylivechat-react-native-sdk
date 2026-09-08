import { describe, expect, it } from 'vitest';

import { isRtlLanguage, textDirectionOf } from '../src/bidi';
import { directionStyles, isolate } from '../src/direction';

/**
 * Port of `bidi_test.dart`.
 *
 * A composer takes the workspace's direction, which is right until somebody
 * types in another language. The keyboard's language is not something iOS or
 * Android tells an app, so the FIRST STRONG CHARACTER is the signal — the same
 * rule HTML calls `dir="auto"`.
 */
describe('textDirectionOf', () => {
  it('returns ltr for the first strong Latin character', () => {
    expect(textDirectionOf('Hello')).toBe('ltr');
    expect(textDirectionOf('  Hello مرحبا')).toBe('ltr');
    expect(textDirectionOf('123 Hello')).toBe('ltr');
  });

  it('returns rtl for the first strong Arabic-script character', () => {
    expect(textDirectionOf('مرحبا')).toBe('rtl');
    expect(textDirectionOf('سڵاو')).toBe('rtl'); // Kurdish Sorani
    expect(textDirectionOf('سلام')).toBe('rtl'); // Persian / Urdu
    expect(textDirectionOf('שלום')).toBe('rtl'); // Hebrew
    expect(textDirectionOf('!!! مرحبا Hello')).toBe('rtl');
  });

  it('returns null when there is nothing strong to read', () => {
    // The caller then KEEPS the direction it had — an empty box must not flip.
    expect(textDirectionOf('')).toBeNull();
    expect(textDirectionOf('   ')).toBeNull();
    expect(textDirectionOf('12345')).toBeNull();
    expect(textDirectionOf('!?.,-()')).toBeNull();
    expect(textDirectionOf('😀🎉')).toBeNull();
    expect(textDirectionOf('+964 770 000 0000')).toBeNull();
  });

  it('reads surrogate pairs as whole code points', () => {
    // Iterating UTF-16 units would split these and read a lone surrogate.
    expect(textDirectionOf('😀 Hello')).toBe('ltr');
    expect(textDirectionOf('😀 مرحبا')).toBe('rtl');
  });

  it('handles pre-shaped Arabic presentation forms', () => {
    expect(textDirectionOf('ﺱﺎ')).toBe('rtl');
  });
});

describe('isRtlLanguage', () => {
  it('covers the product locales', () => {
    for (const code of ['ar', 'ckb', 'kmr', 'ku', 'ur', 'fa', 'he']) {
      expect(isRtlLanguage(code)).toBe(true);
    }
    for (const code of ['en', 'de', 'es', 'fr', 'hi', 'it', 'pt', 'tr', 'zh']) {
      expect(isRtlLanguage(code)).toBe(false);
    }
  });

  it('matches on the language subtag only', () => {
    expect(isRtlLanguage('ar-IQ')).toBe(true);
    expect(isRtlLanguage('ckb_IQ')).toBe(true);
    expect(isRtlLanguage('AR')).toBe(true);
    expect(isRtlLanguage('pt-BR')).toBe(false);
  });
});

describe('directionStyles', () => {
  it('gives logical row/alignment/text styles per direction', () => {
    const ltr = directionStyles('ltr');
    expect(ltr.row).toBe('row');
    expect(ltr.alignStart).toBe('flex-start');
    expect(ltr.textStart.textAlign).toBe('left');
    expect(ltr.mirror.transform[0].scaleX).toBe(1);

    const rtl = directionStyles('rtl');
    expect(rtl.row).toBe('row-reverse');
    expect(rtl.alignStart).toBe('flex-end');
    expect(rtl.alignEnd).toBe('flex-start');
    expect(rtl.textStart.textAlign).toBe('right');
    expect(rtl.textStart.writingDirection).toBe('rtl');
    // A back chevron IS directional and gets mirrored; ticks are
    // shape-symmetric and are not.
    expect(rtl.mirror.transform[0].scaleX).toBe(-1);
  });
});

describe('isolate', () => {
  it('wraps a run in FSI/PDI', () => {
    // `12/08/2026` is digits joined by NEUTRAL characters, and neutrals take
    // the direction of the paragraph around them — dropped bare into Kurdish
    // or Arabic copy, the date reads back to front.
    expect(isolate('12/08/2026')).toBe('⁨' + '12/08/2026' + '⁩');
  });
});
