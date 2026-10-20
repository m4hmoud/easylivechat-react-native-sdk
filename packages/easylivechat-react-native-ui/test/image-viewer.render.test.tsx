import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stringsFor } from '../src/l10n';
import {
  ElcImageViewer,
  IDENTITY,
  VIEWER_DOUBLE_TAP_SCALE,
  VIEWER_MAX_SCALE,
  clampTransform,
  zoomAbout,
} from '../src/views/image-viewer';
import { RTL_THEME, THEME, styleOf } from './support';

/**
 * Port of `image_viewer_widget_test.dart`, and then some.
 *
 * The thread only ever drew attachments as cropped tiles, so a screenshot —
 * the thing support conversations are usually about — could not be read. What
 * is pinned here is that a tap opens something zoomable ON BOTH PLATFORMS (the
 * old viewer zoomed through a ScrollView's `maximumZoomScale`, which only iOS
 * implements), that pinch, pan and double-tap actually change the transform,
 * and that leaving is possible at any scale but never accidental.
 */
const SIZE = { width: 400, height: 800 };
const CENTRE = { x: 200, y: 400 };

type Pt = [number, number];

const touches = (points: Pt[]) => ({
  nativeEvent: {
    touches: points.map(([x, y], i) => ({ pageX: x, pageY: y, locationX: x, locationY: y, identifier: i })),
    changedTouches: [],
  },
});

function surface(): ReactTestInstance {
  return screen.getByTestId('elc-image-viewer-surface');
}

/** First finger(s) down: the responder is granted, then told of the touch. */
function down(...points: Pt[]): void {
  fireEvent(surface(), 'responderGrant', touches(points));
  fireEvent(surface(), 'responderStart', touches(points));
}

/** Another finger joins a gesture already under way. */
function add(...points: Pt[]): void {
  fireEvent(surface(), 'responderStart', touches(points));
}

function move(...points: Pt[]): void {
  fireEvent(surface(), 'responderMove', touches(points));
}

/** A finger lifts; `remaining` are the ones still down. None left: released. */
function up(...remaining: Pt[]): void {
  fireEvent(surface(), 'responderEnd', touches(remaining));
  if (remaining.length === 0) fireEvent(surface(), 'responderRelease', touches([]));
}

function tapAt(x: number, y: number): void {
  down([x, y]);
  up();
}

function doubleTapAt(x: number, y: number): void {
  tapAt(x, y);
  act(() => {
    vi.advanceTimersByTime(60);
  });
  tapAt(x, y);
}

/** Let a pending single tap fire (or not). */
function waitOutDoubleTap(): void {
  act(() => {
    vi.advanceTimersByTime(350);
  });
}

function transform(): { scale: number; x: number; y: number } {
  const t = styleOf(screen.getByTestId('elc-image-viewer-picture')).transform as Array<
    Record<string, { __getValue(): number }>
  >;
  const read = (key: string) => t.find((entry) => key in entry)![key]!.__getValue();
  return { scale: read('scale'), x: read('translateX'), y: read('translateY') };
}

/** Where a point of the unzoomed picture is drawn now. */
function drawnAt(p: { x: number; y: number }) {
  const t = transform();
  return { x: CENTRE.x + t.x + t.scale * (p.x - CENTRE.x), y: CENTRE.y + t.y + t.scale * (p.y - CENTRE.y) };
}

describe('ElcImageViewer', () => {
  let onClose: ReturnType<typeof vi.fn>;

  function open(theme = THEME): void {
    onClose = vi.fn();
    render(
      <ElcImageViewer
        visible
        uri="https://api.example.com/uploads/t1/shot.png"
        theme={theme}
        strings={stringsFor('en')}
        onClose={onClose}
      />,
    );
    fireEvent(surface(), 'layout', { nativeEvent: { layout: { x: 0, y: 0, ...SIZE } } });
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('opens on the whole picture, and draws nothing while closed', () => {
    open();
    expect(transform()).toEqual({ scale: 1, x: 0, y: 0 });
    expect(screen.getByLabelText('Image')).toBeTruthy();
    cleanup();

    render(
      <ElcImageViewer visible={false} uri="x" theme={THEME} strings={stringsFor('en')} onClose={() => undefined} />,
    );
    expect(screen.queryByTestId('elc-image-viewer-surface')).toBeNull();
  });

  it('double-tap zooms in, and again zooms back out', () => {
    open();
    doubleTapAt(300, 300);
    expect(transform().scale).toBeCloseTo(VIEWER_DOUBLE_TAP_SCALE);

    doubleTapAt(300, 300);
    expect(transform()).toEqual(IDENTITY);
  });

  it('double-tap zooms toward the point that was tapped', () => {
    open();
    doubleTapAt(200, 150);
    // The tapped point stays put. Anything else means it zoomed to the middle
    // and the detail the visitor aimed at slid off screen.
    const p = drawnAt({ x: 200, y: 150 });
    expect(p.x).toBeCloseTo(200, 5);
    expect(p.y).toBeCloseTo(150, 5);
  });

  it('a pinch zooms about the fingers and follows them', () => {
    open();
    down([150, 400]);
    add([150, 400], [250, 400]);
    move([100, 400], [300, 400]);
    expect(transform().scale).toBeCloseTo(2);
    // The point between the fingers is still between them.
    expect(drawnAt({ x: 200, y: 400 })).toEqual({ x: 200, y: 400 });

    // Both fingers drift: the picture goes with them.
    move([150, 450], [350, 450]);
    expect(transform().scale).toBeCloseTo(2);
    const p = drawnAt({ x: 200, y: 400 });
    expect(p.x).toBeCloseTo(250);
    expect(p.y).toBeCloseTo(450);
  });

  it('pans with one finger while zoomed — but never off the edge of the picture', () => {
    open();
    doubleTapAt(200, 400);
    waitOutDoubleTap();
    const before = transform();

    down([200, 400]);
    move([230, 380]);
    expect(transform().x).toBeCloseTo(before.x + 30);
    expect(transform().y).toBeCloseTo(before.y - 20);

    // A long drag stops at the edge: the picture's own edge, not empty space.
    move([2000, 400]);
    const maxX = (SIZE.width * (VIEWER_DOUBLE_TAP_SCALE - 1)) / 2;
    expect(transform().x).toBeCloseTo(maxX);
    up();
    waitOutDoubleTap();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a one-finger drag at 1x moves nothing', () => {
    open();
    down([200, 400]);
    move([260, 470]);
    up();
    expect(transform()).toEqual(IDENTITY);
  });

  it('a pinch cannot zoom out past the whole picture, nor in without limit', () => {
    open();
    down([100, 400]);
    add([100, 400], [300, 400]);
    move([190, 400], [210, 400]);
    expect(transform()).toEqual(IDENTITY);
    move([-4000, 400], [4400, 400]);
    expect(transform().scale).toBe(VIEWER_MAX_SCALE);
  });

  it('a tap leaves — but not while zoomed in', () => {
    open();
    doubleTapAt(300, 300);
    waitOutDoubleTap();

    // A tap while zoomed is how a pan ends. Closing there would throw away the
    // very thing the visitor zoomed in to read.
    tapAt(300, 300);
    waitOutDoubleTap();
    expect(onClose).not.toHaveBeenCalled();

    doubleTapAt(300, 300);
    waitOutDoubleTap();
    tapAt(300, 300);
    // Not at once: it may yet be the first half of a double-tap.
    expect(onClose).not.toHaveBeenCalled();
    waitOutDoubleTap();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a drag that ends where it began is not a tap', () => {
    open();
    down([200, 400]);
    move([260, 400]);
    move([200, 400]);
    up();
    waitOutDoubleTap();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the close button works at any zoom', () => {
    open();
    doubleTapAt(300, 300);
    fireEvent.press(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the close button follows the layout direction', () => {
    open();
    expect(styleOf(screen.getByLabelText('Close'))).toMatchObject({ right: 16 });
    cleanup();
    open(RTL_THEME);
    expect(styleOf(screen.getByLabelText('Close'))).toMatchObject({ left: 16 });
  });

  it('zooms on Android exactly as on iOS', () => {
    const platform = Platform as { OS: string };
    const was = platform.OS;
    platform.OS = 'android';
    try {
      open();
      doubleTapAt(100, 100);
      expect(transform().scale).toBeCloseTo(VIEWER_DOUBLE_TAP_SCALE);
      // No ScrollView zoom anywhere: that is the iOS-only path this replaced.
      expect(screen.UNSAFE_queryAllByProps({ maximumZoomScale: 4 })).toHaveLength(0);
    } finally {
      platform.OS = was;
    }
  });

  it('a picture that will not load says so instead of a black void', () => {
    open();
    fireEvent(screen.UNSAFE_getByType('Image' as unknown as React.ComponentType), 'error');
    expect(screen.getByText(stringsFor('en').t('mediaUnavailable'))).toBeTruthy();
  });
});

describe('the viewer’s geometry', () => {
  it('keeps the picture covering the viewport', () => {
    expect(clampTransform({ scale: 2, x: 500, y: -900 }, SIZE)).toEqual({ scale: 2, x: 200, y: -400 });
    expect(clampTransform({ scale: 0.5, x: 10, y: 10 }, SIZE)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('zooming about a point keeps that point where it is', () => {
    const from = { scale: 1.5, x: 20, y: -30 };
    const focal = { x: 120, y: 650 };
    const to = zoomAbout(from, focal, 3, focal, SIZE);
    const at = (t: typeof from, q: { x: number; y: number }) => ({
      x: CENTRE.x + t.x + t.scale * (q.x - CENTRE.x),
      y: CENTRE.y + t.y + t.scale * (q.y - CENTRE.y),
    });
    // The picture point under the focal before…
    const q = { x: CENTRE.x + (focal.x - CENTRE.x - from.x) / from.scale, y: CENTRE.y + (focal.y - CENTRE.y - from.y) / from.scale };
    // …is under it after.
    expect(at(to, q).x).toBeCloseTo(focal.x);
    expect(at(to, q).y).toBeCloseTo(focal.y);
  });
});
