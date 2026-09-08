/**
 * Stub `react-native` for the Node test runner.
 *
 * The tests here cover PURE logic — the protocol client, the state machine,
 * bidi, linkify, the string table, theming. None of them render a component,
 * but the modules those helpers live in do import React Native, so it has to
 * exist. Rendering is verified by the example app on real devices.
 *
 * Keeping the stub here (rather than mocking per file) also acts as a
 * guardrail: an import of something not listed below fails loudly, which is
 * how the "the core must not depend on react-native" rule stays honest.
 */
import { vi } from 'vitest';

vi.mock('react-native', () => {
  const identity = <T,>(styles: T): T => styles;
  const Component = (name: string): unknown => {
    const C = (): null => null;
    Object.defineProperty(C, 'name', { value: name });
    return C;
  };

  return {
    // ── APIs the SDK actually calls ──
    AppState: {
      currentState: 'active' as const,
      addEventListener: () => ({ remove: () => {} }),
    },
    Platform: {
      OS: 'ios' as const,
      select: (o: Record<string, unknown>) => o.ios ?? o.default,
    },
    NativeModules: {
      SettingsManager: { settings: { AppleLocale: 'en_US', AppleLanguages: ['en-US'] } },
      I18nManager: { localeIdentifier: 'en_US' },
    },
    I18nManager: { isRTL: false },
    Linking: { openURL: vi.fn(async () => undefined) },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    StyleSheet: {
      create: identity,
      flatten: identity,
      hairlineWidth: 1,
      absoluteFill: {},
      absoluteFillObject: {},
    },
    Animated: {
      Value: class {
        constructor(public value: number) {}
        interpolate(): unknown {
          return this;
        }
      },
      View: Component('Animated.View'),
      timing: () => ({ start: () => {}, stop: () => {} }),
      loop: () => ({ start: () => {}, stop: () => {} }),
    },
    Easing: { linear: (t: number) => t },

    // ── components, present so the modules import ──
    View: Component('View'),
    Text: Component('Text'),
    TextInput: Component('TextInput'),
    Pressable: Component('Pressable'),
    Image: Component('Image'),
    Modal: Component('Modal'),
    ScrollView: Component('ScrollView'),
    FlatList: Component('FlatList'),
    SafeAreaView: Component('SafeAreaView'),
    ActivityIndicator: Component('ActivityIndicator'),
    KeyboardAvoidingView: Component('KeyboardAvoidingView'),
  };
});
