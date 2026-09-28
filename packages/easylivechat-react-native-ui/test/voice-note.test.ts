import { describe, expect, it } from 'vitest';

import { SUPPORTED_LOCALES, rawTable } from '../src/l10n';
import { formatDuration, looksLikeAudio } from '../src/views/voice-note-tile';

/**
 * A voice note is something you listen to.
 *
 * The composer could record and send them, but the thread rendered what came
 * back through the generic attachment path: `richTile` special-cased images
 * and every other kind fell through to the download chip, so a visitor's own
 * recording appeared as a uuid with a download arrow and hearing it meant
 * leaving the chat. The Flutter SDK had the identical bug (fixed in
 * easylivechat_ui 0.1.68); these are the same rules.
 *
 * Rendering is covered by the example app — see the note in vitest.config.ts.
 */
describe('recognising a voice note by its url', () => {
  it('accepts every container the API stores audio in', () => {
    // uploads.ts keeps the extension and only rewrites the filename, so this
    // is the whole set an attachment url can arrive with.
    for (const ext of ['m4a', 'mp3', 'ogg', 'oga', 'opus', 'aac', 'amr', 'wav']) {
      expect(looksLikeAudio(`/uploads/t1/2026-09/note.${ext}`), ext).toBe(true);
    }
  });

  it('reads the exact shape the composer produces', () => {
    // stopAndTake() records m4a; uploadBytes replaces the name with a uuid.
    expect(looksLikeAudio('/uploads/t1/2026-09/15ff7ad3-c699-4bbe-8f05-1b162.m4a')).toBe(true);
  });

  it('leaves `.webm` to the file chip', () => {
    // adapters/media-out.ts classifies .webm as video, and the API rewraps a
    // browser-recorded audio .webm to .ogg on upload — so one arriving with
    // that extension really is a video. An audio-only one still plays: it
    // comes through the rich path carrying kind: 'audio'.
    expect(looksLikeAudio('/uploads/t1/2026-09/clip.webm')).toBe(false);
  });

  it('is not fooled by pictures, documents or placeholders', () => {
    expect(looksLikeAudio('/uploads/t1/2026-09/photo.png')).toBe(false);
    expect(looksLikeAudio('/uploads/t1/2026-09/invoice.pdf')).toBe(false);
    expect(looksLikeAudio('wa:media:1234')).toBe(false);
    // An extension in the middle of the path is not the file's extension.
    expect(looksLikeAudio('/uploads/mp3/report.pdf')).toBe(false);
  });

  it('ignores case and query strings', () => {
    expect(looksLikeAudio('/uploads/t1/NOTE.M4A')).toBe(true);
    expect(looksLikeAudio('https://cdn.example.com/n.ogg?sig=abc&x=1')).toBe(true);
  });
});

describe('the running time', () => {
  it('is m:ss, zero-padded', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(7)).toBe('0:07');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(614)).toBe('10:14');
  });

  it('floors a fractional position rather than rounding up past the end', () => {
    // The poll reads a float; 59.9s of a 60s note must not read "1:00".
    expect(formatDuration(59.9)).toBe('0:59');
  });

  it('never renders a negative clock', () => {
    expect(formatDuration(-3)).toBe('0:00');
  });
});

describe('the playback strings', () => {
  const table = rawTable();

  it('ships in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of ['voiceMessage', 'playVoice', 'pauseVoice']) {
        expect(table[locale]?.[key]?.trim(), `${locale}.${key}`).toBeTruthy();
      }
    }
  });

  it('says kmr in Badini, in Arabic script — not Kurmanji in Latin', () => {
    // `kmr` is "Kurdish (Badini)" everywhere else in the product and sits in
    // bidi.ts's RTL set, so Latin-script Kurmanji here was laid out
    // right-to-left. The voice and microphone strings shipped that way once;
    // this is the guard against it happening again.
    const latin = /[A-Za-z]/;
    const arabic = /[؀-ۿ]/;
    const kmr = table.kmr;
    expect(kmr).toBeDefined();
    for (const [key, value] of Object.entries(kmr!)) {
      // The product name is deliberately untranslated in all 13 locales.
      if (value === table.en?.[key]) continue;
      // `{time}` and friends are substituted, not read.
      const words = value.replace(/\{[a-z]+\}/gi, '');
      expect(arabic.test(words), `kmr.${key} should be Arabic script: ${value}`).toBe(true);
      expect(latin.test(words), `kmr.${key} should not be Latin: ${value}`).toBe(false);
    }
  });
});
