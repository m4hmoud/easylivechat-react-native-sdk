import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  type ImageStyle,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import type { EasyLiveChatTheme } from '../theme';
import { withAlpha } from '../theme';

/**
 * A network image with disk caching when the host has `expo-image`, and a
 * graceful fall back to RN's own `Image` when it does not.
 *
 * `expo-image` is an OPTIONAL peer: it brings real disk caching, which matters
 * for agent avatars (re-fetched on every thread render otherwise) and for
 * image attachments a visitor scrolls past repeatedly. But a host that only
 * ever sends text should not be made to install a native image module, so the
 * component degrades instead of demanding it.
 *
 * A broken or blocked image MUST NEVER throw — it degrades to `fallback` (or
 * to nothing), because an unloadable avatar is not a reason to lose the
 * message next to it.
 */
export interface RemoteImageProps {
  uri: string;
  style: StyleProp<ImageStyle>;
  contentFit?: 'cover' | 'contain';
  theme: EasyLiveChatTheme;
  /** Rendered instead of the image when it fails to load. */
  fallback?: React.ReactNode;
  /** Rendered while the image loads. Defaults to a muted spinner. */
  placeholder?: React.ReactNode;
}

type ExpoImageComponent = React.ComponentType<{
  source: { uri: string };
  style: StyleProp<ImageStyle>;
  contentFit?: string;
  cachePolicy?: string;
  transition?: number;
  onError?: () => void;
  onLoadEnd?: () => void;
}>;

let expoImage: ExpoImageComponent | null | undefined;
let expoImageLoad: Promise<void> | null = null;

function loadExpoImage(): Promise<void> {
  expoImageLoad ??= import('expo-image')
    .then((m) => {
      expoImage = (m as unknown as { Image?: ExpoImageComponent }).Image ?? null;
    })
    .catch(() => {
      // Optional peer not installed — RN's own Image is the fallback.
      expoImage = null;
    });
  return expoImageLoad;
}

export function RemoteImage({
  uri,
  style,
  contentFit = 'cover',
  theme,
  fallback,
  placeholder,
}: RemoteImageProps): React.JSX.Element {
  const [, forceRender] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setFailed(false);
    setLoading(true);
  }, [uri]);

  useEffect(() => {
    if (expoImage !== undefined) return;
    let alive = true;
    void loadExpoImage().then(() => {
      if (alive) forceRender((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, []);

  // The overlay borrows the image's own box so it covers it exactly. RN types
  // `ImageStyle` and `ViewStyle` as siblings rather than one extending the
  // other (they disagree on `transformOrigin`'s shape alone), so the layout
  // properties that actually matter here need the cast.
  const boxStyle = style as unknown as StyleProp<ViewStyle>;

  if (failed) {
    return <>{fallback ?? <View style={boxStyle} />}</>;
  }

  // The loading state OVERLAYS the image rather than sitting beside it. A
  // host-supplied placeholder (the avatar's initial-on-a-circle, say) is a
  // plain node, so wrapping it here is what keeps it inside the image's box
  // instead of stacking under it and doubling the row height.
  const overlay = (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { alignItems: 'center', justifyContent: 'center' },
        placeholder == null ? { backgroundColor: withAlpha(theme.text, 0.06) } : null,
      ]}
    >
      {placeholder ?? <ActivityIndicator size="small" color={withAlpha(theme.text, 0.4)} />}
    </View>
  );

  const ExpoImage = expoImage;
  if (ExpoImage != null) {
    return (
      <View>
        <ExpoImage
          source={{ uri }}
          style={style}
          contentFit={contentFit}
          // Disk + memory, which is the whole reason to prefer this component.
          cachePolicy="memory-disk"
          transition={120}
          onError={() => setFailed(true)}
          onLoadEnd={() => setLoading(false)}
        />
        {loading ? overlay : null}
      </View>
    );
  }

  return (
    <View>
      <Image
        source={{ uri }}
        style={style}
        resizeMode={contentFit}
        onError={() => setFailed(true)}
        onLoadEnd={() => setLoading(false)}
      />
      {loading ? overlay : null}
    </View>
  );
}
