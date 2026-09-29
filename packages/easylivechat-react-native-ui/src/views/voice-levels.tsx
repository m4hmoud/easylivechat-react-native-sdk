import React, { useLayoutEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  type LayoutChangeEvent,
  View,
  useAnimatedValue,
} from 'react-native';

import type { DirectionStyles } from '../direction';
import { withAlpha } from '../theme';

const BAR_WIDTH = 3;
const GAP = 1.6;
const PITCH = BAR_WIDTH + GAP;
const HEIGHT = 28;

/**
 * The waveform on the recording bar.
 *
 * These bars are REAL: they are the microphone's own metering, sampled as the
 * take is made. (The THREAD's tile cannot do this for a note it merely
 * received — measuring that means decoding it — so the two look alike and
 * only one of them is a measurement.)
 *
 * Two ways of drawing the same levels:
 *
 *  - **recording** — a fixed bar pitch scrolling past, newest at the trailing
 *    edge. Bars never change width as the take grows, and the run slides a
 *    whole pitch over one sample interval rather than jumping, so it reads as
 *    motion instead of a stutter. The slide is an `Animated` translate on the
 *    NATIVE driver: a per-frame `setState` would do this work on the JS
 *    thread, sixteen times a second, next to a live microphone.
 *  - **paused** — the WHOLE take fitted to the width, averaged down into as
 *    many bars as fit, with everything past the playhead dimmed.
 */
export function VoiceLevels({
  levels,
  fraction,
  color,
  dir,
  reviewing,
  intervalMs,
  onSeek,
}: {
  levels: number[];
  /** How far playback has got, 0..1. Ignored while recording. */
  fraction: number;
  color: string;
  dir: DirectionStyles;
  /** Paused: fit the whole take and stop scrolling. */
  reviewing: boolean;
  intervalMs: number;
  onSeek?: (fraction: number) => void;
}): React.JSX.Element {
  const width = useRef(0);
  const slide = useAnimatedValue(0);
  const seen = useRef(levels.length);
  /** When the previous sample landed, for pacing the slide to the real gap. */
  const lastAt = useRef(0);
  /** How long that step was given, to work out what it had left to travel. */
  const lastDuration = useRef(0);
  /** And how far it was travelling, which is a pitch only when nothing carried. */
  const lastFrom = useRef(0);
  // `dir.row` is relative to the HOST's direction and is no longer a test
  // for ours — these coordinates are physical, so they ask the chat directly.
  const rtl = dir.isRtl;

  /**
   * One pitch of travel per level, animated down to zero over the gap until
   * the next one.
   *
   * Two things made this stutter rather than scroll.
   *
   * `Animated.timing` defaults to `Easing.inOut(Easing.ease)`, so every 60ms
   * step accelerated away and braked again. Sixteen of those a second is not
   * a run of bars sliding past, it is a run of bars TWITCHING past — which is
   * the whole complaint. A conveyor moves at one speed: `Easing.linear`.
   *
   * And the step was paced at the nominal interval while the samples arrive on
   * a JS `setInterval`, which drifts and runs late under load. A sample 20ms
   * late left the run parked at zero for 20ms and then snapped back a whole
   * pitch; one that came early was cut off mid-travel and snapped anyway.
   * Pacing each step by the gap that ACTUALLY elapsed keeps it moving at the
   * speed of the take instead of fighting it.
   */
  useLayoutEffect(() => {
    if (reviewing || levels.length === seen.current) {
      seen.current = levels.length;
      return;
    }
    const restarted = levels.length < seen.current;
    const first = restarted || lastAt.current === 0;
    seen.current = levels.length;

    const now = Date.now();
    // Bounded, so one stalled frame cannot leave the run crawling, and a burst
    // of samples cannot make it look like a jump cut.
    const gap = first ? intervalMs : now - lastAt.current;
    const duration = Math.max(intervalMs * 0.5, Math.min(intervalMs * 3, gap));

    /**
     * Whatever travel the last step had not finished, carried over.
     *
     * `setValue(PITCH)` threw it away: if the previous animation was still a
     * third of the way from home when the next sample landed, the run jumped
     * BACKWARDS by that third before starting again. Samples arrive off a JS
     * `setInterval`, so that happened constantly. Computed rather than read
     * back, because a native-driven value lives on the UI thread and the JS
     * copy is stale by definition.
     *
     * Scaled by where the last step actually STARTED, which is a pitch plus
     * whatever it had itself carried — not a bare pitch, or a carry compounded
     * over several jittery samples is undercounted every time.
     *
     * CAPPED at one pitch, and that cap is load-bearing. Unbounded, this is
     * `L' = (PITCH + L)·r`, whose fixed point runs away as `r` approaches 1 —
     * which is exactly what a burst of samples arriving far faster than the
     * interval produces. The run would slide off its own window.
     */
    const leftover = first
      ? 0
      : Math.min(PITCH, Math.max(0, 1 - gap / lastDuration.current) * lastFrom.current);
    const from = PITCH + leftover;

    lastAt.current = now;
    lastDuration.current = duration;
    lastFrom.current = from;

    // The sign lives on the value, not on a wrapper node — see the transform.
    slide.setValue(from * (rtl ? -1 : 1));
    const animation = Animated.timing(slide, {
      toValue: 0,
      duration,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [levels.length, reviewing, intervalMs, slide, rtl]);

  const slots = Math.max(1, Math.floor((width.current || 160) / PITCH));
  const visible = useMemo(
    () => (reviewing ? fit(levels, slots) : levels.slice(Math.max(0, levels.length - slots - 1))),
    [levels, reviewing, slots],
  );

  const bars = visible.length === 0 ? [0.06] : visible;

  const body = (
    <View
      onLayout={(e: LayoutChangeEvent) => {
        width.current = e.nativeEvent.layout.width;
      }}
      // The run is deliberately wider than the window while it scrolls, so it
      // is clipped rather than allowed to push the timer off the bar.
      style={{ height: HEIGHT, overflow: 'hidden', justifyContent: 'center' }}
    >
      <Animated.View
        style={{
          flexDirection: dir.row,
          alignItems: 'center',
          // Anchored to the trailing edge, where the newest bar lives.
          justifyContent: 'flex-end',
          /**
           * The value carries its own sign; this is only ever `slide`.
           *
           * It used to be `Animated.multiply(slide, -1)` in RTL — a NEW
           * animated node built on every render, and this component renders
           * every time a sample lands, sixteen times a second. Under the
           * native driver each one has to be created and attached natively
           * while the last is detached, so the transform was being rebuilt
           * out from under the animation continuously. That is why the run
           * stuttered in Kurdish and Arabic and looked fine in English: the
           * LTR branch passes `slide` straight through and allocates nothing.
           */
          transform: [{ translateX: slide }],
        }}
      >
        {bars.map((level, i) => (
          <View
            key={i}
            style={{
              width: BAR_WIDTH,
              marginHorizontal: GAP / 2,
              // A floor, so silence is a line of dots rather than a gap.
              height: 3 + Math.min(1, Math.max(0, level)) * (HEIGHT - 7),
              borderRadius: BAR_WIDTH / 2,
              backgroundColor:
                !reviewing || (i + 0.5) / bars.length <= fraction
                  ? color
                  : withAlpha(color, 0.3),
            }}
          />
        ))}
      </Animated.View>
    </View>
  );

  if (onSeek == null) return body;
  return (
    <View
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => onSeek(fractionFor(e.nativeEvent.locationX, width.current, rtl))}
      onResponderMove={(e) => onSeek(fractionFor(e.nativeEvent.locationX, width.current, rtl))}
    >
      {body}
    </View>
  );
}

function fractionFor(x: number, width: number, rtl: boolean): number {
  if (width <= 0) return 0;
  return Math.min(1, Math.max(0, (rtl ? width - x : x) / width));
}

/** Average `levels` down to `target` bars, so a whole take fits the width. */
export function fit(levels: number[], target: number): number[] {
  if (target <= 0) return [];
  if (levels.length <= target) return levels;
  const out: number[] = [];
  for (let i = 0; i < target; i++) {
    const from = Math.floor((levels.length * i) / target);
    const to = Math.floor((levels.length * (i + 1)) / target);
    let sum = 0;
    for (let j = from; j < to; j++) sum += levels[j] ?? 0;
    out.push(to > from ? sum / (to - from) : 0);
  }
  return out;
}
