import { type QueueStatus, useQueueStatus } from '@easylivechat/react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { textDirectionOf } from '../bidi';
import { directionStyles, isolate, useDirectionStyles } from '../direction';
import type { Strings } from '../l10n';
import { type EasyLiveChatTheme, withAlpha } from '../theme';
import { MAX_FONT_SCALE } from '../text-scaling';

export interface QueueNoticeProps {
  theme: EasyLiveChatTheme;
  strings: Strings;
  /** The queue to show; the live one (`useQueueStatus`) when left out. */
  queue?: QueueStatus | null;
}

/**
 * The notice above the conversation while the visitor waits for a person —
 * the web widget's `QueueView`: a "Queue" kicker, the workspace's own notice
 * (filled in by the server with the visitor's name, place and wait, in their
 * language — drawn verbatim), and their place and the estimated wait.
 *
 * A notice, never a screen of its own: the visitor reads what has been said
 * and writes their question while they wait. It goes the moment anyone from
 * the team is there — the chat assigned, a team message, someone typing.
 */
export function QueueNotice({ theme, strings, queue: given }: QueueNoticeProps): React.JSX.Element | null {
  const live = useQueueStatus();
  const dir = useDirectionStyles();
  const queue = given !== undefined ? given : live;
  if (queue == null) return null;

  const muted = withAlpha(theme.text, 0.6);
  // Isolated, so `#3` keeps its order inside a right-to-left sentence.
  const place = isolate(`#${queue.position}`);
  const meta =
    queue.position <= 0
      ? null
      : queue.minutes > 0
        ? strings
            .t('queueMeta')
            .replace('{place}', place)
            .replace('{minutes}', String(queue.minutes))
        : place;
  // The workspace's words face the way they read, as `dir="auto"` does.
  const textStart = directionStyles(textDirectionOf(queue.text) ?? dir.direction).textStart;

  return (
    <View
      accessibilityRole="summary"
      style={[
        styles.notice,
        { backgroundColor: theme.surface, borderBottomColor: withAlpha(theme.text, 0.12) },
      ]}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.kicker, dir.textStart, { color: muted }]}
      >
        {strings.t('queueKicker')}
      </Text>
      {queue.text.length > 0 ? (
        <Text style={[styles.text, textStart, { color: theme.text }]}>{queue.text}</Text>
      ) : null}
      {meta != null ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.meta, dir.textStart, { color: muted }]}
        >
          {meta}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  kicker: { fontSize: 12, fontWeight: '600' },
  text: { fontSize: 14, lineHeight: 20 },
  meta: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
