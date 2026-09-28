import { describe, expect, it } from 'vitest';

import { fit } from '../src/views/voice-levels';
import { waveformOf } from '../src/views/voice-note-tile';

/**
 * The two waveforms, and the difference between them.
 *
 * The COMPOSER's bars are real microphone metering, fitted to the width when
 * the take is paused. The THREAD's are decorative — measuring a note you only
 * received means decoding it — so they are a stable fingerprint of its url.
 * Nothing in the UI claims otherwise, and these tests hold both to what they
 * actually promise.
 */
describe('fitting a take to the width', () => {
  it('leaves a short take alone', () => {
    expect(fit([0.1, 0.2, 0.3], 10)).toEqual([0.1, 0.2, 0.3]);
  });

  it('averages a long take down to the bars that fit', () => {
    const levels = Array.from({ length: 100 }, (_, i) => i / 100);
    const bars = fit(levels, 10);
    expect(bars).toHaveLength(10);
    // Each bar is the mean of its slice, so they climb with the source.
    expect(bars[0]!).toBeLessThan(bars[9]!);
    expect(bars[0]!).toBeCloseTo(0.045, 3);
  });

  it('never divides by an empty slice', () => {
    expect(fit([], 8)).toEqual([]);
    expect(fit([0.5], 0)).toEqual([]);
    expect(fit(Array.from({ length: 5 }, () => 0.5), 5)).toHaveLength(5);
  });

  it('covers every level, so the end of a take is never dropped', () => {
    const levels = Array.from({ length: 97 }, (_, i) => i);
    const bars = fit(levels, 8);
    // The last bar must include the last sample, or a take visibly loses its
    // tail as it grows.
    expect(bars[7]!).toBeGreaterThan(levels[88]! - 1);
  });
});

describe('the thread tile waveform', () => {
  it('is stable for one note and different between notes', () => {
    const a = '/uploads/t1/2026-09/5d7c5e34-828f-4062-b1b1-36bffb546d5e.m4a';
    const b = '/uploads/t1/2026-09/020f5893-348a-4880-9a9c-7bf7edffea1e.m4a';
    expect(waveformOf(a)).toEqual(waveformOf(a));
    expect(waveformOf(a)).not.toEqual(waveformOf(b));
  });

  it('draws bars that fit the column, always', () => {
    for (const url of ['', 'x', '/uploads/a.m4a', 'https://e.com/b.ogg?sig=1']) {
      const bars = waveformOf(url);
      expect(bars).toHaveLength(28);
      expect(bars.every((v) => v >= 0.18 && v <= 1)).toBe(true);
    }
  });

  it('does not collapse to one flat height', () => {
    // A hash that stopped advancing would draw a straight line and look broken.
    const bars = waveformOf('/uploads/t1/2026-09/abc.m4a');
    expect(new Set(bars).size).toBeGreaterThan(5);
  });
});
