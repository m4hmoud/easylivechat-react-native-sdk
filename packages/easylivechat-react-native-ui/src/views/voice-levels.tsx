import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, type LayoutChangeEvent, View, useAnimatedValue } from 'react-native';

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
  const rtl = dir.row === 'row-reverse';

  // One pitch of travel per level, animated down to zero over the interval it
  // takes for the next one to arrive.
  useEffect(() => {
    if (reviewing || levels.length === seen.current) {
      seen.current = levels.length;
      return;
    }
    seen.current = levels.length;
    slide.setValue(PITCH);
    const animation = Animated.timing(slide, {
      toValue: 0,
      duration: intervalMs,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [levels.length, reviewing, intervalMs, slide]);

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
          // Physical, because it mirrors a row that already mirrored itself.
          transform: [{ translateX: rtl ? Animated.multiply(slide, -1) : slide }],
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
