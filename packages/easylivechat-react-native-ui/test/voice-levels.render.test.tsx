import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import type { ReactTestInstance } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { directionStyles } from '../src/direction';
import { withAlpha } from '../src/theme';
import { VoiceLevels } from '../src/views/voice-levels';
import { isHost, styleOf } from './support';

/**
 * Port of `voice_levels_widget_test.dart`: the recording waveform must fit the
 * bar it is drawn in.
 *
 * Flutter's version of this bug painted overflow stripes across the composer;
 * the React Native one is quieter and as real — a five-minute take is ~5000
 * levels, and drawing a View per level is five thousand Views in a 180pt
 * window. What is pinned is that only the bars that fit are drawn, in every
 * state the waveform has, in either direction.
 */
const COLOR = '#111827';
const PITCH = 3 + 1.6;

const levels = (n: number) => Array.from({ length: n }, (_, i) => (i % 10) / 10 + 0.05);

function pump({
  take,
  width,
  reviewing = false,
  fraction = 1,
  rtl = false,
}: {
  take: number[];
  width: number;
  reviewing?: boolean;
  fraction?: number;
  rtl?: boolean;
}) {
  const ui = (t: number[]) => (
    <VoiceLevels
      levels={t}
      fraction={fraction}
      color={COLOR}
      dir={directionStyles(rtl ? 'rtl' : 'ltr')}
      reviewing={reviewing}
      intervalMs={60}
      onSeek={reviewing ? () => undefined : undefined}
    />
  );
  render(ui(take));
  // The window is measured, then the next sample draws against it.
  const windowView = screen.UNSAFE_root.findAll(
    (n: ReactTestInstance) => typeof n.type === 'string' && typeof n.props.onLayout === 'function',
  )[0]!;
  fireEvent(windowView, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height: 28 } } });
  screen.rerender(ui([...take]));
  return windowView;
}

/** The bars: the run's children. */
function bars(): ReactTestInstance[] {
  const run = screen.UNSAFE_root.findAll(
    (n: ReactTestInstance) => isHost(n, 'Animated.View'),
  )[0]!;
  return run.children as ReactTestInstance[];
}

describe('the recording waveform', () => {
  afterEach(cleanup);

  it('a long take draws only the bars that fit its window', () => {
    // Five minutes at 60ms is ~5000 levels; the window is a phone composer.
    pump({ take: levels(5000), width: 180 });
    const fit = Math.floor(180 / PITCH);
    // One spare, to slide in from.
    expect(bars()).toHaveLength(fit + 1);
  });

  it('…and at the narrowest width a composer can get', () => {
    pump({ take: levels(5000), width: 48 });
    expect(bars()).toHaveLength(Math.floor(48 / PITCH) + 1);
  });

  it('…and in RTL, anchored to the trailing edge where the newest bar lives', () => {
    pump({ take: levels(5000), width: 180, rtl: true });
    expect(bars()).toHaveLength(Math.floor(180 / PITCH) + 1);
    const run = screen.UNSAFE_root.findAll((n: ReactTestInstance) => isHost(n, 'Animated.View'))[0]!;
    expect(styleOf(run)).toMatchObject({ flexDirection: 'row-reverse', justifyContent: 'flex-end' });
  });

  it('paused, the whole take is fitted to the width, played bars full and the rest dimmed', () => {
    pump({ take: levels(5000), width: 180, reviewing: true, fraction: 0.5 });
    const drawn = bars();
    expect(drawn).toHaveLength(Math.floor(180 / PITCH));
    const colours = drawn.map((b) => styleOf(b).backgroundColor);
    expect(colours[0]).toBe(COLOR);
    expect(colours[colours.length - 1]).toBe(withAlpha(COLOR, 0.3));
  });

  it('an empty take draws a single dot and survives it', () => {
    pump({ take: [], width: 180 });
    expect(bars()).toHaveLength(1);
  });
});
