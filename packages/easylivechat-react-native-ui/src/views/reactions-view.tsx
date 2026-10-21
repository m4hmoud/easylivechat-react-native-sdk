import {
  type ChatMessage,
  QUICK_REACTIONS,
  groupReactions,
  isFromCustomer,
  myReaction,
  reactionsOf,
  sameEmoji,
} from '@easylivechat/react-native';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DirectionStyles } from '../direction';
import { CloseIcon, PlusIcon } from '../icons';
import { EmojiPickerSheet } from './emoji-picker';
import type { Strings } from '../l10n';
import { type EasyLiveChatTheme, inkOf, withAlpha } from '../theme';
import { MAX_FONT_SCALE } from '../text-scaling';

/**
 * Reactions in the visitor's thread — the native analog of the web widget's
 * `components/Reactions.tsx`.
 *
 * {@link ReactionChips} sit under any bubble that has reactions: the visitor's
 * own (tapping it takes it back) and the team's on the visitor's messages.
 * {@link QuickReactionRow} is what a long press on one of the team's messages
 * opens — the quick six (👍 ❤️ 😂 😮 😢 🙏), the visitor's own marked, revealed
 * in place under the bubble on the page's own ground rather than floated over
 * the thread in a popover.
 */

/** Chips under a bubble — the visitor's view of its reactions. */
export function ReactionChips({
  message,
  theme,
  strings,
  dir,
  onTakeBack,
}: {
  message: ChatMessage;
  theme: EasyLiveChatTheme;
  strings: Strings;
  dir: DirectionStyles;
  /**
   * Set on the team's messages while the visitor can react: their own chip
   * then takes it back. Null draws every chip as a label only.
   */
  onTakeBack?: (() => void) | null;
}): React.JSX.Element | null {
  const list = reactionsOf(message);
  if (list.length === 0) return null;
  const groups = groupReactions(list);
  const ink = inkOf(theme);
  return (
    <View
      style={[
        styles.chips,
        {
          flexDirection: dir.row,
          // From the sender's own side, in the chat's direction: `dir.row`
          // runs leading→trailing, so the main axis's end IS the trailing edge.
          justifyContent: isFromCustomer(message) ? 'flex-end' : 'flex-start',
        },
      ]}
    >
      {groups.map((g) => {
        const label = (g.mine ? strings.t('yourReaction') : strings.t('teamReaction')).replace(
          '{emoji}',
          g.emoji,
        );
        const chipStyle = [
          styles.chip,
          { flexDirection: dir.row },
          g.mine
            ? { borderColor: withAlpha(ink, 0.55), backgroundColor: withAlpha(ink, 0.12) }
            : { borderColor: withAlpha(theme.text, 0.12), backgroundColor: theme.surface },
        ];
        const content = (
          <>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.chipEmoji}>
              {g.emoji}
            </Text>
            {g.count > 1 ? (
              <>
                {/* A spacer, not a margin: a logical margin follows the HOST's
                    direction, not this chat's. */}
                <View style={{ width: 4 }} />
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={[styles.chipCount, { color: withAlpha(theme.text, 0.7) }]}
                >
                  {String(g.count)}
                </Text>
              </>
            ) : null}
          </>
        );
        return g.mine && onTakeBack != null ? (
          <Pressable
            key={g.emoji}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: true }}
            hitSlop={6}
            onPress={onTakeBack}
            style={chipStyle}
          >
            {content}
          </Pressable>
        ) : (
          <View key={g.emoji} accessible accessibilityLabel={label} style={chipStyle}>
            {content}
          </View>
        );
      })}
    </View>
  );
}

/**
 * The quick row a long press opens under one of the team's messages: six
 * emoji, the visitor's own marked (tapping it again takes it back), a + for
 * the whole picker — search and every emoji, {@link EmojiPickerSheet} — and a
 * close. Picking one, from either, closes the row.
 */
export function QuickReactionRow({
  message,
  theme,
  strings,
  dir,
  onPick,
  onClose,
}: {
  message: ChatMessage;
  theme: EasyLiveChatTheme;
  strings: Strings;
  dir: DirectionStyles;
  /** The emoji tapped — `toggledReaction` turns it into a set or a take-back. */
  onPick: (emoji: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const mine = myReaction(message);
  const ink = inkOf(theme);
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <View
      accessibilityLabel={strings.t('react')}
      style={[
        styles.quickRow,
        {
          flexDirection: dir.row,
          // The page's own ground, not a raised popover tier.
          backgroundColor: theme.background,
          borderColor: withAlpha(theme.text, 0.12),
        },
      ]}
    >
      {QUICK_REACTIONS.map((emoji) => {
        const selected = sameEmoji(mine, emoji);
        return (
          <Pressable
            key={emoji}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onPick(emoji)}
            style={({ pressed }) => [
              styles.quick,
              {
                backgroundColor: selected
                  ? withAlpha(ink, 0.16)
                  : pressed
                    ? withAlpha(theme.text, 0.07)
                    : 'transparent',
              },
            ]}
          >
            <Text allowFontScaling={false} style={styles.quickEmoji}>
              {emoji}
            </Text>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.t('moreReactions')}
        onPress={() => setPickerOpen(true)}
        style={({ pressed }) => [
          styles.quick,
          pressed ? { backgroundColor: withAlpha(theme.text, 0.07) } : null,
        ]}
      >
        <PlusIcon color={withAlpha(theme.text, 0.7)} size={18} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.t('close')}
        onPress={onClose}
        hitSlop={4}
        style={styles.quick}
      >
        <CloseIcon color={withAlpha(theme.text, 0.6)} size={16} />
      </Pressable>
      <EmojiPickerSheet
        visible={pickerOpen}
        theme={theme}
        strings={strings}
        onPick={(emoji) => {
          setPickerOpen(false);
          onPick(emoji);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexWrap: 'wrap', gap: 4, marginTop: 4, paddingHorizontal: 4 },
  chip: {
    alignItems: 'center',
    height: 24,
    paddingHorizontal: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipEmoji: { fontSize: 14, lineHeight: 18 },
  chipCount: { fontSize: 12, fontVariant: ['tabular-nums'] },
  // Placed by the bubble's column, which hugs the team's side in the chat's
  // direction — never a physical `alignSelf` here.
  quickRow: {
    alignItems: 'center',
    gap: 2,
    marginTop: 6,
    padding: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    // Eight round buttons are wider than the column beside an avatar on the
    // narrowest phones: they give a little rather than spill out of it.
    maxWidth: '100%',
  },
  quick: {
    width: 34,
    height: 34,
    minWidth: 28,
    flexShrink: 1,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickEmoji: { fontSize: 22, lineHeight: 28 },
});
