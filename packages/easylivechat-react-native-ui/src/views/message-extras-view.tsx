import { EasyLiveChat, type MessageCard, isSafeCardUrl } from '@easylivechat/react-native';
import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { textDirectionOf } from '../bidi';
import { type DirectionStyles, bubbleRadii, directionStyles, useDirectionStyles } from '../direction';
import { type EasyLiveChatTheme, inkOf, onColor, withAlpha } from '../theme';
import { RemoteImage } from './remote-image';

/**
 * Tappable answers under a message from the team: its quick replies, or its
 * reply buttons (a bot's, or an agent's). The native analog of
 * `.quick-replies` in the web widget — outlined in the workspace accent, the
 * chosen one filled, wrapping from the team's side of the thread.
 *
 * `onSelect` null draws every chip disabled: the question has moved on, or a
 * reply is already on its way.
 */
export function ReplyChips({
  labels,
  chosen,
  onSelect,
  theme,
  label,
  dir,
}: {
  labels: string[];
  chosen?: string | null;
  onSelect: ((label: string, index: number) => void) | null;
  theme: EasyLiveChatTheme;
  /** What a screen reader calls the group. */
  label: string;
  dir: DirectionStyles;
}): React.JSX.Element {
  // The brand FILLS a chosen chip; outlines and words are its ink, which in
  // dark is nudged lighter until it reads on the dark ground.
  const accent = theme.primary;
  const ink = inkOf(theme);
  return (
    <View accessibilityLabel={label} style={[styles.chips, { flexDirection: dir.row }]}>
      {labels.map((text, i) => {
        const isChosen = chosen != null && chosen === text;
        const disabled = onSelect == null;
        return (
          <Pressable
            key={`${i}-${text}`}
            accessibilityRole="button"
            accessibilityState={{ disabled, selected: isChosen }}
            disabled={disabled}
            onPress={() => onSelect?.(text, i)}
            style={({ pressed }) => [
              styles.chip,
              {
                borderColor:
                  isChosen || (pressed && !disabled) ? accent : disabled ? withAlpha(ink, 0.5) : ink,
                backgroundColor: isChosen || (pressed && !disabled) ? accent : theme.background,
              },
            ]}
          >
            {({ pressed }) => (
              <Text
                style={[
                  styles.chipText,
                  {
                    color: isChosen || (pressed && !disabled) ? onColor(accent) : disabled ? withAlpha(ink, 0.5) : ink,
                    writingDirection: textDirectionOf(text) ?? dir.direction,
                  },
                ]}
              >
                {text}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * An agent's card: image, title, text and buttons — the native analog of the
 * web widget's `MessageCardView`. A link button opens in the visitor's
 * browser (http/https only, checked again here); a reply button answers in
 * the chat while `onReply` is set, and stays filled once chosen.
 */
export function CardView({
  card,
  theme,
  chosenReplyId,
  onReply,
  width = 280,
  maxWidth,
}: {
  card: MessageCard;
  theme: EasyLiveChatTheme;
  chosenReplyId?: string | null;
  onReply: ((id: string, label: string) => void) | null;
  /** The card's own width; a carousel's are a little narrower. */
  width?: number;
  /** The most the row leaves for it — the web's `min(280px, 100%)`. */
  maxWidth?: number;
}): React.JSX.Element {
  const dir = useDirectionStyles();
  const accent = theme.primary;
  const ink = inkOf(theme);
  const hairline = withAlpha(theme.text, 0.1);
  // Each run faces the way its own text reads — `dir="auto"` on the web — so
  // an English card in an Arabic workspace still starts at the left.
  const own = (text: string) => directionStyles(textDirectionOf(text) ?? dir.direction);
  return (
    <View
      style={[
        styles.card,
        // The team's bubble: its surface, its hairline, its tail on the team's
        // side in the chat's direction.
        bubbleRadii(dir.direction, false),
        {
          width: Math.min(width, maxWidth ?? width),
          backgroundColor: theme.surface,
          borderColor: withAlpha(theme.text, 0.08),
        },
      ]}
    >
      {card.imageUrl ? (
        <RemoteImage
          uri={EasyLiveChat.instance.resolveUrl(card.imageUrl)}
          style={{ width: '100%', aspectRatio: 16 / 9 }}
          contentFit="cover"
          theme={theme}
        />
      ) : null}
      <View style={styles.cardBody}>
        <Text style={[styles.cardTitle, own(card.title).textStart, { color: theme.text }]}>
          {card.title}
        </Text>
        {card.text ? (
          <Text style={[styles.cardText, own(card.text).textStart, { color: withAlpha(theme.text, 0.8) }]}>
            {card.text}
          </Text>
        ) : null}
      </View>
      {card.buttons.map((b, i) => {
        if (b.reply !== undefined) {
          const chosen = chosenReplyId != null && chosenReplyId === b.reply;
          const dimmed = (chosenReplyId != null && !chosen) || onReply == null;
          const replyId = b.reply;
          return (
            <Pressable
              key={`${i}-${b.reply}`}
              accessibilityRole="button"
              accessibilityState={{ disabled: onReply == null, selected: chosen }}
              disabled={onReply == null}
              onPress={() => onReply?.(replyId, b.label)}
              style={[styles.cardButton, { borderTopColor: hairline, backgroundColor: chosen ? accent : 'transparent' }]}
            >
              <Text
                style={[
                  styles.cardButtonText,
                  {
                    color: chosen ? onColor(accent) : withAlpha(ink, dimmed ? 0.5 : 1),
                    writingDirection: textDirectionOf(b.label) ?? dir.direction,
                  },
                ]}
              >
                {b.label}
              </Text>
            </Pressable>
          );
        }
        const url = b.url;
        return (
          <Pressable
            key={`${i}-${url}`}
            accessibilityRole="link"
            onPress={() => {
              if (isSafeCardUrl(url)) void Linking.openURL(url.trim()).catch(() => undefined);
            }}
            style={[styles.cardButton, { borderTopColor: hairline }]}
          >
            <Text
              style={[
                styles.cardButtonText,
                { color: ink, writingDirection: textDirectionOf(b.label) ?? dir.direction },
              ]}
            >
              {b.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Two or more cards side by side, swiped through — the web widget's carousel. */
export function CardCarousel({
  cards,
  theme,
  label,
  chosenReplyId,
  onReply,
}: {
  cards: MessageCard[];
  theme: EasyLiveChatTheme;
  /** What a screen reader calls the row. */
  label: string;
  chosenReplyId?: string | null;
  onReply: ((id: string, label: string) => void) | null;
}): React.JSX.Element {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={label}
      contentContainerStyle={{ gap: 8 }}
      style={{ flexGrow: 0, maxWidth: '100%' }}
    >
      {cards.map((card, i) => (
        <CardView key={i} card={card} theme={theme} chosenReplyId={chosenReplyId} onReply={onReply} width={240} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chips: { flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minHeight: 40, justifyContent: 'center' },
  chipText: { fontSize: 14, fontWeight: '600', lineHeight: 18 },
  card: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  cardBody: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10, gap: 4 },
  cardTitle: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  cardText: { fontSize: 14, lineHeight: 20 },
  cardButton: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 11 },
  cardButtonText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
