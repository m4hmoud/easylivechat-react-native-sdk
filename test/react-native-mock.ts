/**
 * A React Native stand-in that RENDERS, for the Node test runner.
 *
 * The real `react-native` package cannot load under Node: its entry point is
 * Flow source (`import typeof …`) that only Metro's Babel preset can parse,
 * and half of it reaches for native modules. So the tests run against this
 * instead — one object, handed to every importer (see `setup-rn.ts`):
 *
 * - every component is a HOST element with the name React Native gives it
 *   (`View`, `Text`, `TextInput`, …), which is what
 *   `@testing-library/react-native` queries and what `react-test-renderer`
 *   prints, so a test reads the tree the way a screen reader would;
 * - `Pressable` behaves like the real one where tests can see it: `style` and
 *   `children` may be functions of `{ pressed }`, and `disabled` blocks the
 *   press through `onStartShouldSetResponder`, exactly the signal RNTL's
 *   `fireEvent` reads on device builds;
 * - `Animated` keeps real values: `setValue` and every animation land on the
 *   value at once (a test does not wait out a 200ms ease), and
 *   `__getValue()` reads it back as on device. A loop runs its body once.
 *
 * Everything else is the narrowest thing that lets the SDK's modules run. An
 * API that is NOT listed fails loudly on use — which keeps the core honest
 * about not depending on React Native, and tells whoever adds a new call here
 * to add it deliberately.
 */
import React from 'react';
import { vi } from 'vitest';

type Props = Record<string, unknown> & { children?: React.ReactNode };

/** Imperative methods a ref to a host view may be asked for. All no-ops. */
const HOST_METHODS = {
  focus: () => undefined,
  blur: () => undefined,
  clear: () => undefined,
  isFocused: () => false,
  measure: () => undefined,
  measureInWindow: () => undefined,
  measureLayout: () => undefined,
  setNativeProps: () => undefined,
  scrollTo: () => undefined,
  scrollToEnd: () => undefined,
  scrollToOffset: () => undefined,
  scrollToIndex: () => undefined,
  flashScrollIndicators: () => undefined,
};

function host(name: string): React.ForwardRefExoticComponent<Props & React.RefAttributes<unknown>> {
  const C = React.forwardRef<unknown, Props>((props, ref) => {
    React.useImperativeHandle(ref, () => HOST_METHODS, []);
    return React.createElement(name, props, props.children);
  });
  C.displayName = name;
  return C;
}

const View = host('View');
const Text = host('Text');
const TextInput = host('TextInput');
const Image = host('Image');
const ScrollView = host('ScrollView');
const Switch = host('Switch');
const ActivityIndicator = host('ActivityIndicator');
const SafeAreaView = host('SafeAreaView');
const KeyboardAvoidingView = host('KeyboardAvoidingView');

/** Drawn only while visible, as the real one is (its children unmount). */
const Modal = React.forwardRef<unknown, Props>(({ visible = true, children, ...rest }, ref) => {
  React.useImperativeHandle(ref, () => HOST_METHODS, []);
  if (visible === false) return null;
  return React.createElement('Modal', { visible, ...rest }, children);
});
Modal.displayName = 'Modal';

const Pressable = React.forwardRef<unknown, Props>((props, ref) => {
  const { children, style, disabled, accessibilityState, onPress, onLongPress, onPressIn, onPressOut, ...rest } =
    props as Props & {
      style?: unknown;
      disabled?: boolean | null;
      accessibilityState?: Record<string, unknown>;
      onPress?: unknown;
      onLongPress?: unknown;
      onPressIn?: unknown;
      onPressOut?: unknown;
    };
  const state = { pressed: false, hovered: false };
  const isDisabled = disabled === true;
  return React.createElement(
    View,
    {
      accessible: true,
      ...rest,
      ref,
      style: typeof style === 'function' ? (style as (s: typeof state) => unknown)(state) : style,
      accessibilityState:
        disabled != null ? { ...accessibilityState, disabled: isDisabled } : accessibilityState,
      // The real Pressable answers the responder system with `!disabled`;
      // RNTL reads that to decide whether a press may land.
      onStartShouldSetResponder: () => !isDisabled,
      onPress: isDisabled ? undefined : onPress,
      onLongPress: isDisabled ? undefined : onLongPress,
      onPressIn: isDisabled ? undefined : onPressIn,
      onPressOut: isDisabled ? undefined : onPressOut,
    },
    typeof children === 'function'
      ? (children as (s: typeof state) => React.ReactNode)(state)
      : (children as React.ReactNode),
  );
});
Pressable.displayName = 'Pressable';

function renderSlot(slot: unknown): React.ReactNode {
  if (slot == null || slot === false) return null;
  if (React.isValidElement(slot)) return slot;
  return React.createElement(slot as React.ComponentType);
}

/** Every row, in order — no virtualisation, so a test sees the whole list. */
const FlatList = React.forwardRef<unknown, Props>((props, ref) => {
  const {
    data,
    renderItem,
    keyExtractor,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
    ...rest
  } = props as Props & {
    data?: readonly unknown[] | null;
    renderItem: (info: { item: unknown; index: number; separators: unknown }) => React.ReactNode;
    keyExtractor?: (item: unknown, index: number) => string;
    ListHeaderComponent?: unknown;
    ListFooterComponent?: unknown;
    ListEmptyComponent?: unknown;
  };
  React.useImperativeHandle(ref, () => HOST_METHODS, []);
  const items = data ?? [];
  const separators = { highlight: () => undefined, unhighlight: () => undefined, updateProps: () => undefined };
  return React.createElement(
    ScrollView,
    rest,
    renderSlot(ListHeaderComponent),
    items.length === 0
      ? renderSlot(ListEmptyComponent)
      : items.map((item, index) =>
          React.createElement(
            View,
            { key: keyExtractor ? keyExtractor(item, index) : String(index) },
            renderItem({ item, index, separators }),
          ),
        ),
    renderSlot(ListFooterComponent),
  );
});
FlatList.displayName = 'FlatList';

// ── StyleSheet ──────────────────────────────────────────────────────────────

function flatten(style: unknown): Record<string, unknown> | undefined {
  if (style == null || style === false) return undefined;
  if (Array.isArray(style)) {
    const out: Record<string, unknown> = {};
    for (const s of style) Object.assign(out, flatten(s) ?? {});
    return out;
  }
  return style as Record<string, unknown>;
}

const absoluteFill = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } as const;

const StyleSheet = {
  create: <T,>(styles: T): T => styles,
  flatten,
  compose: (a: unknown, b: unknown) => [a, b],
  hairlineWidth: 0.5,
  absoluteFill,
  absoluteFillObject: absoluteFill,
};

// ── Animated ────────────────────────────────────────────────────────────────

let listenerSeq = 0;

interface Readable {
  __getValue(): number;
}

class AnimatedValue implements Readable {
  private value: number;
  private offset = 0;
  private readonly listeners = new Map<string, (state: { value: number }) => void>();

  constructor(value = 0) {
    this.value = value;
  }

  __getValue(): number {
    return this.value + this.offset;
  }

  setValue(value: number): void {
    this.value = value;
    this.notify();
  }

  setOffset(offset: number): void {
    this.offset = offset;
  }

  flattenOffset(): void {
    this.value += this.offset;
    this.offset = 0;
  }

  extractOffset(): void {
    this.offset += this.value;
    this.value = 0;
  }

  addListener(cb: (state: { value: number }) => void): string {
    const id = String(++listenerSeq);
    this.listeners.set(id, cb);
    return id;
  }

  removeListener(id: string): void {
    this.listeners.delete(id);
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  stopAnimation(cb?: (value: number) => void): void {
    cb?.(this.__getValue());
  }

  resetAnimation(cb?: (value: number) => void): void {
    cb?.(this.__getValue());
  }

  interpolate(config: { inputRange: number[]; outputRange: Array<number | string> }): Readable {
    return interpolation(this, config);
  }

  private notify(): void {
    for (const cb of this.listeners.values()) cb({ value: this.__getValue() });
  }
}

class AnimatedValueXY {
  x: AnimatedValue;
  y: AnimatedValue;
  constructor(value: { x: number; y: number } = { x: 0, y: 0 }) {
    this.x = new AnimatedValue(value.x);
    this.y = new AnimatedValue(value.y);
  }
  setValue(value: { x: number; y: number }): void {
    this.x.setValue(value.x);
    this.y.setValue(value.y);
  }
  getTranslateTransform(): Array<Record<string, AnimatedValue>> {
    return [{ translateX: this.x }, { translateY: this.y }];
  }
  stopAnimation(cb?: (value: { x: number; y: number }) => void): void {
    cb?.({ x: this.x.__getValue(), y: this.y.__getValue() });
  }
}

function read(v: unknown): number {
  if (typeof v === 'number') return v;
  return (v as Readable).__getValue();
}

function interpolation(
  source: unknown,
  { inputRange, outputRange }: { inputRange: number[]; outputRange: Array<number | string> },
): Readable & { interpolate: AnimatedValue['interpolate'] } {
  const node = {
    __getValue(): number {
      const x = read(source);
      const first = outputRange[0];
      if (typeof first !== 'number') return 0;
      for (let i = 1; i < inputRange.length; i++) {
        const lo = inputRange[i - 1]!;
        const hi = inputRange[i]!;
        if (x <= hi || i === inputRange.length - 1) {
          const a = outputRange[i - 1] as number;
          const b = outputRange[i] as number;
          const t = hi === lo ? 0 : Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
          return a + (b - a) * t;
        }
      }
      return first;
    },
    interpolate(config: { inputRange: number[]; outputRange: Array<number | string> }): Readable {
      return interpolation(node, config);
    },
  };
  return node;
}

function derived(fn: () => number): Readable & { interpolate: AnimatedValue['interpolate'] } {
  const node = {
    __getValue: fn,
    interpolate(config: { inputRange: number[]; outputRange: Array<number | string> }): Readable {
      return interpolation(node, config);
    },
  };
  return node;
}

interface CompositeAnimation {
  start(cb?: (result: { finished: boolean }) => void): void;
  stop(): void;
  reset(): void;
}

function settle(
  value: AnimatedValue | AnimatedValueXY,
  config: { toValue?: unknown },
): CompositeAnimation {
  return {
    start(cb) {
      const to = config.toValue;
      if (value instanceof AnimatedValueXY) {
        const xy = to as { x: number; y: number };
        value.setValue({ x: xy.x, y: xy.y });
      } else if (to != null) {
        value.setValue(read(to));
      }
      cb?.({ finished: true });
    },
    stop() {},
    reset() {},
  };
}

function group(animations: CompositeAnimation[]): CompositeAnimation {
  return {
    start(cb) {
      for (const a of animations) a.start();
      cb?.({ finished: true });
    },
    stop() {
      for (const a of animations) a.stop();
    },
    reset() {
      for (const a of animations) a.reset();
    },
  };
}

const Animated = {
  Value: AnimatedValue,
  ValueXY: AnimatedValueXY,
  View: host('Animated.View'),
  Text: host('Animated.Text'),
  Image: host('Animated.Image'),
  ScrollView: host('Animated.ScrollView'),
  FlatList,
  createAnimatedComponent: <T,>(component: T): T => component,
  timing: settle,
  spring: settle,
  decay: (): CompositeAnimation => group([]),
  // Once: a loop that re-started itself synchronously would never return.
  loop: (animation: CompositeAnimation): CompositeAnimation => group([animation]),
  sequence: group,
  parallel: group,
  stagger: (_ms: number, animations: CompositeAnimation[]) => group(animations),
  delay: (): CompositeAnimation => group([]),
  event: (_mapping: unknown, config?: { listener?: (e: unknown) => void }) => (e: unknown) =>
    config?.listener?.(e),
  add: (a: unknown, b: unknown) => derived(() => read(a) + read(b)),
  subtract: (a: unknown, b: unknown) => derived(() => read(a) - read(b)),
  multiply: (a: unknown, b: unknown) => derived(() => read(a) * read(b)),
  divide: (a: unknown, b: unknown) => derived(() => read(a) / read(b)),
  modulo: (a: unknown, m: number) => derived(() => read(a) % m),
  diffClamp: (a: unknown, min: number, max: number) =>
    derived(() => Math.min(max, Math.max(min, read(a)))),
};

function useAnimatedValue(initial: number): AnimatedValue {
  return React.useRef(new AnimatedValue(initial)).current;
}

const linear = (t: number): number => t;
const Easing = {
  linear,
  ease: linear,
  quad: (t: number) => t * t,
  cubic: (t: number) => t * t * t,
  poly: () => linear,
  sin: linear,
  circle: linear,
  exp: linear,
  elastic: () => linear,
  back: () => linear,
  bounce: linear,
  bezier: () => linear,
  in: (f: (t: number) => number) => f,
  out: (f: (t: number) => number) => f,
  inOut: (f: (t: number) => number) => f,
  step0: linear,
  step1: linear,
};

// ── platform APIs ───────────────────────────────────────────────────────────

const subscription = (): { remove: () => void } => ({ remove: () => undefined });

const WINDOW = { width: 390, height: 844, scale: 3, fontScale: 1 };

export const reactNativeMock = {
  // ── APIs the SDK calls ──
  AppState: {
    currentState: 'active' as const,
    addEventListener: subscription,
  },
  Platform: {
    OS: 'ios' as const,
    Version: '18.0',
    select: (o: Record<string, unknown>) => o.ios ?? o.default,
  },
  NativeModules: {
    SettingsManager: { settings: { AppleLocale: 'en_US', AppleLanguages: ['en-US'] } },
    I18nManager: { localeIdentifier: 'en_US' },
  },
  I18nManager: {
    isRTL: false,
    doLeftAndRightSwapInRTL: true,
    allowRTL: () => undefined,
    forceRTL: () => undefined,
    swapLeftAndRightInRTL: () => undefined,
    getConstants: () => ({ isRTL: false, doLeftAndRightSwapInRTL: true }),
  },
  Linking: {
    openURL: vi.fn(async (_url: string) => undefined),
    canOpenURL: vi.fn(async () => true),
    getInitialURL: async () => null,
    addEventListener: subscription,
  },
  AccessibilityInfo: {
    announceForAccessibility: vi.fn(),
    isScreenReaderEnabled: async () => false,
    isReduceMotionEnabled: async () => false,
    addEventListener: subscription,
  },
  Keyboard: {
    addListener: subscription,
    removeAllListeners: () => undefined,
    dismiss: vi.fn(),
    isVisible: () => false,
    metrics: () => undefined,
  },
  Dimensions: {
    get: () => WINDOW,
    addEventListener: subscription,
  },
  useWindowDimensions: () => WINDOW,
  PixelRatio: {
    get: () => WINDOW.scale,
    getFontScale: () => WINDOW.fontScale,
    roundToNearestPixel: (n: number) => n,
  },
  StyleSheet,
  Animated,
  useAnimatedValue,
  Easing,

  // ── components ──
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  Modal,
  ScrollView,
  FlatList,
  Switch,
  SafeAreaView,
  ActivityIndicator,
  KeyboardAvoidingView,
};
