import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { useDirectionStyles } from '../direction';
import { type EasyLiveChatTheme, withAlpha } from '../theme';

/**
 * The animated three-dot "agent is typing" bubble, on the leading edge like an
 * agent message.
 *
 * Each dot takes its turn to hop and brighten, resting between turns — the
 * familiar messenger cadence rather than a flat synchronized fade.
 */
export function TypingRow({
  theme,
  label,
}: {
  theme: EasyLiveChatTheme;
  label: string;
}): React.JSX.Element {
  const dir = useDirectionStyles();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      style={[styles.wrap, { alignItems: dir.alignStart }]}
    >
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: theme.surface,
            borderColor: withAlpha(theme.text, 0.08),
            // Logical corners so the tail hugs the leading edge in RTL too.
            borderTopStartRadius: 16,
            borderTopEndRadius: 16,
            borderBottomEndRadius: 16,
            borderBottomStartRadius: 4,
          },
        ]}
      >
        <View style={{ flexDirection: dir.row, alignItems: 'center' }}>
          {[0, 1, 2].map((i) => (
            <Dot key={i} index={i} progress={progress} theme={theme} />
          ))}
        </View>
      </View>
    </View>
  );
}

function Dot({
  index,
  progress,
  theme,
}: {
  index: number;
  progress: Animated.Value;
  theme: EasyLiveChatTheme;
}): React.JSX.Element {
  // Each dot is offset a fifth of a beat behind the last, so the wave reads
  // left-to-right rather than as three dots blinking together. The hop stays
  // inside the bubble's vertical padding.
  const phase = index * 0.15;
  const inputRange = [0, 0.225, 0.45, 1].map((p) => (p + phase) % 1);
  const sorted = [...inputRange].sort((a, b) => a - b);
  const translateY = progress.interpolate({
    inputRange: sorted,
    outputRange: sorted.map((p) => {
      const local = (p - phase + 1) % 1;
      return local < 0.45 ? -3.5 * Math.sin((local / 0.45) * Math.PI) : 0;
    }),
  });

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          marginStart: index > 0 ? 5 : 0,
          backgroundColor: withAlpha(theme.text, 0.45),
          transform: [{ translateY }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingVertical: 6 },
  bubble: { paddingHorizontal: 14, paddingVertical: 12, borderWidth: StyleSheet.hairlineWidth },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
});
