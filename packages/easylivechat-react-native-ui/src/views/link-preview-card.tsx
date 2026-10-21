import { EasyLiveChat, type LinkPreview } from '@easylivechat/react-native';
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { textDirectionOf } from '../bidi';
import { type DirectionStyles, directionStyles } from '../direction';
import { type EasyLiveChatTheme, withAlpha } from '../theme';
import { MAX_FONT_SCALE } from '../text-scaling';
import { RemoteImage } from './remote-image';

/** The thumbnail's side, in points. */
const THUMB = 64;

/**
 * The card under a message with a link in it — the native analog of the web
 * widget's `components/LinkPreview.tsx`: the site, the page's title, a line of
 * its description, and its picture when the server could re-host one.
 *
 * Made by the server and read through the core's `linkPreviewOf`, so nothing
 * in it is trusted as stored: text is text, the link is http(s) only (checked
 * again here before it opens), the picture the server's own upload or https.
 * On the card surface whichever side sent it, so a preview of someone else's
 * page never reads as part of the brand-coloured bubble. The thumbnail sits at
 * the chat's leading edge; each line faces the way its own text reads, as
 * `dir="auto"` does on the web. A picture that will not load simply goes, and
 * takes its gap with it.
 */
export function LinkPreviewCard({
  preview,
  theme,
  dir,
  maxWidth,
}: {
  preview: LinkPreview;
  theme: EasyLiveChatTheme;
  dir: DirectionStyles;
  /** What the row leaves for it — the web's `min(300px, 100%)`. */
  maxWidth?: number;
}): React.JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [preview.imageUrl]);

  const image =
    preview.imageUrl != null && !imageFailed
      ? EasyLiveChat.instance.resolveUrl(preview.imageUrl)
      : null;
  const muted = withAlpha(theme.text, 0.6);
  const own = (text: string) => directionStyles(textDirectionOf(text) ?? dir.direction).textStart;

  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => {
        // Validated when the preview was read; checked once more at the door.
        if (/^https?:\/\//i.test(preview.url)) {
          void Linking.openURL(preview.url).catch(() => undefined);
        }
      }}
      style={({ pressed }) => [
        styles.card,
        {
          flexDirection: dir.row,
          width: Math.min(300, maxWidth ?? 300),
          backgroundColor: theme.surface,
          borderColor: withAlpha(theme.text, pressed ? 0.24 : 0.12),
        },
      ]}
    >
      {image != null ? (
        <>
          <RemoteImage
            uri={image}
            style={styles.thumb}
            contentFit="cover"
            theme={theme}
            onFailed={() => setImageFailed(true)}
          />
          {/* A spacer, not a margin: a logical margin follows the HOST's
              direction, not this chat's. */}
          <View style={{ width: 10 }} />
        </>
      ) : null}
      <View style={styles.text}>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.site, own(preview.siteName), { color: muted }]}
        >
          {preview.siteName}
        </Text>
        <Text
          numberOfLines={2}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.title, own(preview.title), { color: theme.text }]}
        >
          {preview.title}
        </Text>
        {preview.description != null ? (
          <Text
            numberOfLines={2}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.desc, own(preview.description), { color: muted }]}
          >
            {preview.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'stretch',
    marginTop: 6,
    padding: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: THUMB, height: THUMB, borderRadius: 6 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  site: { fontSize: 12, lineHeight: 16 },
  title: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  desc: { fontSize: 13, lineHeight: 18 },
});
