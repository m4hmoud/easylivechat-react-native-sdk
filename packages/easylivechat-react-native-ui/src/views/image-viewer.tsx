import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { DirectionProvider, insetEnd } from '../direction';
import { BrokenImageIcon, CloseIcon } from '../icons';
import type { Strings } from '../l10n';
import type { EasyLiveChatTheme } from '../theme';
import { RemoteImage } from './remote-image';

export interface ElcImageViewerProps {
  visible: boolean;
  uri: string | null;
  theme: EasyLiveChatTheme;
  strings: Strings;
  onClose: () => void;
}

/** How far a pinch may zoom in. */
export const VIEWER_MAX_SCALE = 6;
/** Where a double-tap zooms to. */
export const VIEWER_DOUBLE_TAP_SCALE = 2.5;
/**
 * Anything above this counts as zoomed — a pinch never lands back on exactly
 * 1.0.
 */
const ZOOMED_ABOVE = 1.05;
/** A second tap within this long, and this close, is a double-tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 40;
/** A touch that travels further than this is a drag, not a tap. */
const TAP_SLOP = 10;
/** A press held longer than this is not a tap either. */
const TAP_MAX_MS = 250;

/**
 * Where the picture is: scale and offset about the CENTRE of the viewport, so
 * a point `p` of the unzoomed picture is drawn at `c + (x, y) + scale·(p − c)`.
 * That is exactly what `transform: [translateX, translateY, scale]` does in
 * React Native, whose transform origin is the view's centre.
 */
export interface ViewerTransform {
  scale: number;
  x: number;
  y: number;
}

export interface ViewerSize {
  width: number;
  height: number;
}

export const IDENTITY: ViewerTransform = { scale: 1, x: 0, y: 0 };

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Keep the picture on screen: scale within [1, max], and no pan past the
 * viewport's own edges. The picture fills the viewport (it letterboxes itself
 * inside it), which is what bounds a pan to what is actually there — sized to
 * the image instead, a portrait photo could be dragged off into empty space.
 */
export function clampTransform(t: ViewerTransform, size: ViewerSize): ViewerTransform {
  const scale = clamp(t.scale, 1, VIEWER_MAX_SCALE);
  const maxX = (size.width * (scale - 1)) / 2;
  const maxY = (size.height * (scale - 1)) / 2;
  return { scale, x: clamp(t.x, -maxX, maxX), y: clamp(t.y, -maxY, maxY) };
}

/**
 * The transform at `scale` that draws the picture point that was under
 * `fromFocal` (in `from`) under `toFocal` instead — a pinch, which zooms about
 * the fingers and follows them as they move. With the two focal points equal
 * it is a zoom toward one point, which is what a double-tap is.
 */
export function zoomAbout(
  from: ViewerTransform,
  fromFocal: { x: number; y: number },
  scale: number,
  toFocal: { x: number; y: number },
  size: ViewerSize,
): ViewerTransform {
  const s = clamp(scale, 1, VIEWER_MAX_SCALE);
  const cx = size.width / 2;
  const cy = size.height / 2;
  // The picture point under the focal now: c + (f − c − t) / scale.
  const qx = cx + (fromFocal.x - cx - from.x) / from.scale;
  const qy = cy + (fromFocal.y - cy - from.y) / from.scale;
  return clampTransform(
    { scale: s, x: toFocal.x - cx - s * (qx - cx), y: toFocal.y - cy - s * (qy - cy) },
    size,
  );
}

/** Double-tap: zoom in toward the tapped point, or all the way back out. */
export function doubleTapTarget(
  current: ViewerTransform,
  at: { x: number; y: number },
  size: ViewerSize,
): ViewerTransform {
  if (current.scale > ZOOMED_ABOVE) return IDENTITY;
  return zoomAbout(current, at, VIEWER_DOUBLE_TAP_SCALE, at, size);
}

export function isZoomed(t: ViewerTransform): boolean {
  return t.scale > ZOOMED_ABOVE;
}

interface Point {
  x: number;
  y: number;
}

function pointsOf(e: GestureResponderEvent): Point[] {
  const touches = e.nativeEvent.touches ?? [];
  return touches.map((t) => ({ x: t.pageX, y: t.pageY }));
}

function centroid(points: Point[]): Point {
  const n = points.length;
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / n,
    y: points.reduce((sum, p) => sum + p.y, 0) / n,
  };
}

function spread(points: Point[]): number {
  const a = points[0];
  const b = points[1];
  if (a == null || b == null) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Full-screen image viewer: pinch to zoom, drag to pan, double-tap to zoom in
 * toward the point tapped (and again to come back out), tap the backdrop or
 * the × to leave. The same on iOS and Android.
 *
 * Thread thumbnails are cropped and capped, so tapping one has to open the
 * picture somewhere it can actually be read: without this, a screenshot of the
 * very error the visitor is writing in about was unreadable in the thread and
 * there was nothing to do about it.
 *
 * The gestures are read straight off the responder system — the touches every
 * `View` already receives on both platforms — rather than a `ScrollView`'s
 * `maximumZoomScale`, which only iOS implements (an Android visitor could not
 * zoom at all), and rather than `react-native-gesture-handler`, which is not
 * worth making a required native peer of a chat SDK. Transforms run through
 * `Animated` values, so a pinch moves the picture without re-rendering it.
 *
 * A tap on the backdrop leaves — but not while zoomed in, where a tap is how a
 * pan ends and leaving would throw away the very thing the visitor zoomed in
 * to read. The × and the system back gesture close it at any scale. Matches
 * `ElcImageViewer` in `easylivechat_ui`.
 */
export function ElcImageViewer({
  visible,
  uri,
  theme,
  strings,
  onClose,
}: ElcImageViewerProps): React.JSX.Element | null {
  if (!visible || uri == null) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <DirectionProvider value={theme.direction}>
        <ZoomableImage uri={uri} theme={theme} strings={strings} onClose={onClose} />
      </DirectionProvider>
    </Modal>
  );
}

function ZoomableImage({
  uri,
  theme,
  strings,
  onClose,
}: {
  uri: string;
  theme: EasyLiveChatTheme;
  strings: Strings;
  onClose: () => void;
}): React.JSX.Element {
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  /** The truth; the Animated values only draw it. */
  const current = useRef<ViewerTransform>(IDENTITY);
  const size = useRef<ViewerSize>(Dimensions.get('window'));

  /** Where the fingers were, and the picture with them, when the move began. */
  const gesture = useRef<{
    start: ViewerTransform;
    focal: Point;
    spread: number;
    pointers: number;
  } | null>(null);
  /** For telling a tap from a drag or a press. */
  const press = useRef<{ at: Point; time: number; moved: boolean; multi: boolean } | null>(null);
  const lastTap = useRef<{ at: Point; time: number } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (tapTimer.current != null) clearTimeout(tapTimer.current);
    },
    [],
  );

  const draw = useCallback(
    (t: ViewerTransform) => {
      current.current = t;
      scale.setValue(t.scale);
      translateX.setValue(t.x);
      translateY.setValue(t.y);
    },
    [scale, translateX, translateY],
  );

  const animateTo = useCallback(
    (t: ViewerTransform) => {
      current.current = t;
      const ease = { duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false };
      Animated.parallel([
        Animated.timing(scale, { toValue: t.scale, ...ease }),
        Animated.timing(translateX, { toValue: t.x, ...ease }),
        Animated.timing(translateY, { toValue: t.y, ...ease }),
      ]).start();
    },
    [scale, translateX, translateY],
  );

  /** A finger landed mid-animation: carry on from where the picture IS. */
  const settle = useCallback(() => {
    const at = { ...current.current };
    scale.stopAnimation((v) => (at.scale = v));
    translateX.stopAnimation((v) => (at.x = v));
    translateY.stopAnimation((v) => (at.y = v));
    current.current = at;
  }, [scale, translateX, translateY]);

  /** (Re)start the move from the fingers down right now. */
  const rebase = useCallback((points: Point[]) => {
    if (points.length === 0) {
      gesture.current = null;
      return;
    }
    gesture.current = {
      start: current.current,
      focal: centroid(points),
      spread: spread(points),
      pointers: points.length,
    };
  }, []);

  const onGrant = useCallback(
    (e: GestureResponderEvent) => {
      settle();
      const points = pointsOf(e);
      rebase(points);
      const first = points[0];
      press.current =
        first != null ? { at: first, time: Date.now(), moved: false, multi: points.length > 1 } : null;
    },
    [rebase, settle],
  );

  const onPointersChanged = useCallback(
    (e: GestureResponderEvent) => {
      const points = pointsOf(e);
      if (press.current != null && points.length > 1) press.current.multi = true;
      rebase(points);
    },
    [rebase],
  );

  const onMove = useCallback(
    (e: GestureResponderEvent) => {
      const points = pointsOf(e);
      const g = gesture.current;
      if (g == null || points.length === 0) return;
      // A finger came or went without a start/end of its own reaching us.
      if (points.length !== g.pointers) {
        rebase(points);
        return;
      }
      const focal = centroid(points);
      const p = press.current;
      if (p != null && !p.moved && Math.hypot(focal.x - p.at.x, focal.y - p.at.y) > TAP_SLOP) {
        p.moved = true;
      }
      if (points.length >= 2 && g.spread > 0) {
        const nextScale = g.start.scale * (spread(points) / g.spread);
        draw(zoomAbout(g.start, g.focal, nextScale, focal, size.current));
      } else if (isZoomed(g.start)) {
        // One finger pans — only while zoomed; at 1x there is nowhere to go.
        draw(
          clampTransform(
            { ...g.start, x: g.start.x + focal.x - g.focal.x, y: g.start.y + focal.y - g.focal.y },
            size.current,
          ),
        );
      }
    },
    [draw, rebase],
  );

  const onTap = useCallback(() => {
    // While zoomed a tap is how a pan ends, not how the visitor leaves. The ×
    // stays live at every scale.
    if (isZoomed(current.current)) return;
    onClose();
  }, [onClose]);

  const onRelease = useCallback(() => {
    gesture.current = null;
    const p = press.current;
    press.current = null;
    if (p == null || p.moved || p.multi || Date.now() - p.time > TAP_MAX_MS) {
      lastTap.current = null;
      return;
    }
    const previous = lastTap.current;
    const now = Date.now();
    if (
      previous != null &&
      now - previous.time <= DOUBLE_TAP_MS &&
      Math.hypot(p.at.x - previous.at.x, p.at.y - previous.at.y) <= DOUBLE_TAP_SLOP
    ) {
      lastTap.current = null;
      if (tapTimer.current != null) clearTimeout(tapTimer.current);
      tapTimer.current = null;
      animateTo(doubleTapTarget(current.current, p.at, size.current));
      return;
    }
    lastTap.current = { at: p.at, time: now };
    // A single tap only counts once it is clear no second one is coming.
    if (tapTimer.current != null) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      lastTap.current = null;
      onTap();
    }, DOUBLE_TAP_MS);
  }, [animateTo, onTap]);

  const onTerminate = useCallback(() => {
    gesture.current = null;
    press.current = null;
  }, []);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) size.current = { width, height };
  }, []);

  return (
    <View style={styles.backdrop} accessibilityViewIsModal>
      <View
        testID="elc-image-viewer-surface"
        style={StyleSheet.absoluteFill}
        onLayout={onLayout}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        // Hold on to the gesture: an ancestor taking it mid-pinch would freeze
        // the picture half-zoomed.
        onResponderTerminationRequest={() => false}
        onResponderGrant={onGrant}
        onResponderStart={onPointersChanged}
        onResponderMove={onMove}
        onResponderEnd={onPointersChanged}
        onResponderRelease={onRelease}
        onResponderTerminate={onTerminate}
      >
        <Animated.View
          testID="elc-image-viewer-picture"
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ translateX }, { translateY }, { scale }] },
          ]}
        >
          <View accessible accessibilityRole="image" accessibilityLabel={strings.t('image')} style={styles.fill}>
            <RemoteImage
              uri={uri}
              style={styles.fill}
              contentFit="contain"
              theme={theme}
              // A blocked or expired URL must not leave a black void with no
              // way to tell what happened.
              fallback={
                <View style={styles.failed}>
                  <BrokenImageIcon color="rgba(255, 255, 255, 0.55)" size={40} />
                  <Text style={styles.failedText}>{strings.t('mediaUnavailable')}</Text>
                </View>
              }
            />
          </View>
        </Animated.View>
      </View>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={strings.t('close')}
        style={[styles.close, insetEnd(theme.direction, 16)]}
        hitSlop={12}
      >
        <CloseIcon color="#FFFFFF" size={22} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000' },
  fill: { width: '100%', height: '100%' },
  failed: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  failedText: { color: 'rgba(255, 255, 255, 0.7)', fontSize: 14, marginTop: 10, textAlign: 'center' },
  close: {
    position: 'absolute',
    top: 48,
    // The side is set per-render from the resolved direction. An earlier
    // version pinned it right on the reasoning that a full-bleed overlay has
    // no content flow to mirror — but a dismiss affordance is exactly the kind
    // of control RTL users expect on the other side, and every RTL-aware photo
    // viewer mirrors it.
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
});
