import { describe, expect, it } from 'vitest';

import { MAX_RECORD_SECONDS, formatRecordDuration, takeLength } from '../src/views/composer-bar';

const SECOND = 1000;

/**
 * How long a take is, and why nothing counts it.
 *
 * The recording bar shows `m:ss`, and once the take is paused that same
 * number is the timeline the playhead sweeps — a containerless recording
 * cannot state its own length while it is being written (a WAV's data-chunk
 * size is a placeholder until `stop()`, ADTS has no duration field at all),
 * so the only honest measurement of it is ours.
 *
 * It used to be a `setInterval` adding one per tick, which was wrong twice:
 * it drifted late under load, and it was never stopped when the microphone
 * was, so a take paused for review kept accruing seconds of silence it had
 * not recorded.
 */
describe('measuring a take', () => {
  it('is just the banked time while the microphone is shut', () => {
    // runStartedAt 0 is the paused state, and it is the whole fix: a take
    // being reviewed does not grow, however long it is reviewed for.
    expect(takeLength(4 * SECOND, 0, 1_000_000)).toBe(4 * SECOND);
    expect(takeLength(4 * SECOND, 0, 9_000_000)).toBe(4 * SECOND);
  });

  it('adds the live run to what is already banked', () => {
    const startedAt = 500_000;
    expect(takeLength(0, startedAt, startedAt + 3 * SECOND)).toBe(3 * SECOND);
    // Resumed after a pause: the second run stacks on the first.
    expect(takeLength(3 * SECOND, startedAt, startedAt + 2 * SECOND)).toBe(5 * SECOND);
  });

  it('survives a take paused and resumed repeatedly', () => {
    let banked = 0;
    let clock = 1_000_000;
    // Three runs of two seconds, with arbitrarily long reviews between them.
    for (let i = 0; i < 3; i++) {
      const startedAt = clock;
      clock += 2 * SECOND;
      banked = takeLength(banked, startedAt, clock);
      clock += 30 * SECOND; // reviewing, microphone shut
      expect(takeLength(banked, 0, clock)).toBe(banked);
    }
    expect(banked).toBe(6 * SECOND);
  });

  it('never exceeds the cap the composer auto-sends at', () => {
    // Any non-zero start: zero is the sentinel for a shut microphone.
    const startedAt = 1;
    expect(takeLength(0, startedAt, (MAX_RECORD_SECONDS + 60) * SECOND)).toBe(
      MAX_RECORD_SECONDS * SECOND,
    );
    expect(takeLength(MAX_RECORD_SECONDS * SECOND, startedAt, 10 * SECOND)).toBe(
      MAX_RECORD_SECONDS * SECOND,
    );
  });

  it('never runs backwards if the clock does', () => {
    // Date.now() is wall time and can step back (NTP, the user changing it).
    // A negative run would shorten the take and drag the playhead with it.
    expect(takeLength(5 * SECOND, 900_000, 800_000)).toBe(5 * SECOND);
  });

  it('reads out as the m:ss the bar shows', () => {
    const at = (ms: number) => formatRecordDuration(Math.floor(ms / 1000));
    expect(at(takeLength(0, 1000, 1000))).toBe('0:00');
    expect(at(takeLength(0, 1000, 1000 + 9 * SECOND))).toBe('0:09');
    expect(at(takeLength(0, 1000, 1000 + 61 * SECOND))).toBe('1:01');
    // The cap itself reads out, rather than rolling over to zero.
    expect(at(takeLength(0, 1, (MAX_RECORD_SECONDS + 1) * SECOND))).toBe('5:00');
  });
});
