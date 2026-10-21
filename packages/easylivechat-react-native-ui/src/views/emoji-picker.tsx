import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  type LayoutChangeEvent,
  KeyboardAvoidingView,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { textDirectionOf } from '../bidi';
import { DirectionProvider, directionStyles, useDirectionStyles } from '../direction';
import {
  EMOJI_CATEGORIES,
  EMOJI_CATEGORY_ICON,
  type EmojiCategory,
  defaultEmojiCatalog,
  emojiCategoryKey,
  recentEmoji,
  rememberEmoji,
  searchEmoji,
} from '../emoji/emoji';
import { CloseIcon, SearchIcon } from '../icons';
import type { Strings } from '../l10n';
import { MAX_FONT_SCALE } from '../text-scaling';
import { type EasyLiveChatTheme, inkOf, keyboardAppearance, withAlpha } from '../theme';

/**
 * The whole emoji picker — the native analog of the web widget's
 * `components/EmojiPicker.tsx`: a search over the emoji's English names,
 * category tabs, and the grid, the device's recently used first. The same
 * emoji in the same order as the web's, from the same table.
 *
 * Search matches as the web does (`searchEmoji`): every word typed must start
 * one of the emoji's words, best first — an exact word before a prefix, then
 * the table's order — and an emoji typed or pasted finds itself. "Search"
 * on the keyboard picks the first match. The field does not take the focus by
 * itself: on a phone that would raise the keyboard over the emoji.
 */
export interface EmojiPickerProps {
  theme: EasyLiveChatTheme;
  strings: Strings;
  /** An emoji was tapped (or the first match chosen from the keyboard). */
  onPick: (emoji: string) => void;
}

const CELL = 44;
const HEADER = 32;
const PADDING = 8;

type Section = { category: EmojiCategory; emoji: readonly string[] };
type Row =
  | { kind: 'header'; key: string; category: EmojiCategory }
  | { kind: 'cells'; key: string; emoji: readonly string[] };

function chunk(list: readonly string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function EmojiPicker({ theme, strings, onPick }: EmojiPickerProps): React.JSX.Element {
  const dir = useDirectionStyles();
  const catalog = defaultEmojiCatalog();
  const [query, setQuery] = useState('');
  // The recent row as it was when the picker opened: picking closes it.
  const [recent] = useState(() => [...recentEmoji()]);
  const [columns, setColumns] = useState(8);

  const sections = useMemo<Section[]>(() => {
    const list: Section[] = [];
    if (recent.length > 0) list.push({ category: 'recent', emoji: recent });
    for (const g of catalog) list.push({ category: g.category, emoji: g.emoji.map((e) => e.emoji) });
    return list;
  }, [recent, catalog]);

  const [active, setActive] = useState<EmojiCategory>(() => sections[0]?.category ?? 'smileys');

  // One header and its rows per section; every row is a fixed height, so the
  // offsets are arithmetic and a tab can jump to a section never drawn yet.
  const { rows, offsets } = useMemo(() => {
    const rows: Row[] = [];
    const offsets: number[] = [];
    let y = 0;
    for (const s of sections) {
      rows.push({ kind: 'header', key: `h:${s.category}`, category: s.category });
      offsets.push(y);
      y += HEADER;
      chunk(s.emoji, columns).forEach((cells, i) => {
        rows.push({ kind: 'cells', key: `${s.category}:${i}`, emoji: cells });
        offsets.push(y);
        y += CELL;
      });
    }
    return { rows, offsets };
  }, [sections, columns]);

  const results = useMemo(
    () => (query.trim().length > 0 ? searchEmoji(catalog, query).map((e) => e.emoji) : null),
    [query, catalog],
  );

  const list = useRef<FlatList<Row>>(null);

  const pick = useCallback(
    (emoji: string) => {
      rememberEmoji(emoji);
      onPick(emoji);
    },
    [onPick],
  );

  const jumpTo = useCallback(
    (category: EmojiCategory) => {
      setQuery('');
      setActive(category);
      const at = rows.findIndex((r) => r.kind === 'header' && r.category === category);
      if (at === -1) return;
      // The section list stays mounted under the results, so it can scroll now.
      (list.current as { scrollToOffset?: (p: { offset: number; animated: boolean }) => void } | null)
        ?.scrollToOffset?.({ offset: offsets[at] ?? 0, animated: false });
    },
    [rows, offsets],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      let current: EmojiCategory | null = null;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r?.kind === 'header' && (offsets[i] ?? 0) <= y + 8) current = r.category;
      }
      if (current != null && current !== active) setActive(current);
    },
    [rows, offsets, active],
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    const next = Math.max(1, Math.min(12, Math.floor((width - 2 * PADDING) / CELL)));
    setColumns((c) => (c === next ? c : next));
  }, []);

  const muted = withAlpha(theme.text, 0.6);
  const ink = inkOf(theme);
  // The field faces the way what is typed in it reads — the chat's way while empty.
  const inputDir = directionStyles(textDirectionOf(query) ?? dir.direction);

  const cell = (emoji: string, key: string): React.JSX.Element => (
    <Pressable
      key={key}
      accessibilityRole="button"
      onPress={() => pick(emoji)}
      style={({ pressed }) => [
        styles.cell,
        pressed ? { backgroundColor: withAlpha(theme.text, 0.08) } : null,
      ]}
    >
      <Text allowFontScaling={false} style={styles.cellEmoji}>
        {emoji}
      </Text>
    </Pressable>
  );

  const cellsRow = (emoji: readonly string[], key: string): React.JSX.Element => (
    // In the chat's direction: a right-to-left chat fills each row from the right.
    <View key={key} style={[styles.cells, { flexDirection: dir.row }]}>
      {emoji.map((e) => cell(e, `${key}:${e}`))}
    </View>
  );

  const renderRow = ({ item }: { item: Row }): React.JSX.Element =>
    item.kind === 'header' ? (
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          numberOfLines={1}
          style={[styles.headerText, dir.textStart, { color: muted }]}
        >
          {strings.t(emojiCategoryKey(item.category))}
        </Text>
      </View>
    ) : (
      cellsRow(item.emoji, item.key)
    );

  return (
    <View style={styles.root} onLayout={onLayout}>
      <View
        style={[
          styles.searchBox,
          {
            flexDirection: dir.row,
            backgroundColor: theme.surface,
            borderColor: withAlpha(theme.text, 0.12),
          },
        ]}
      >
        <SearchIcon color={muted} size={16} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => {
            const first = results?.[0];
            if (first != null) pick(first);
          }}
          placeholder={strings.t('emojiSearch')}
          placeholderTextColor={withAlpha(theme.text, 0.4)}
          keyboardAppearance={keyboardAppearance(theme)}
          accessibilityLabel={strings.t('emojiSearch')}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          style={[styles.searchInput, inputDir.textStart, { color: theme.text }]}
        />
        {query.length > 0 ? (
          <Pressable
            onPress={() => setQuery('')}
            accessibilityRole="button"
            accessibilityLabel={strings.t('helpSearchClear')}
            hitSlop={10}
            style={styles.clearButton}
          >
            <CloseIcon color={muted} size={14} />
          </Pressable>
        ) : null}
      </View>

      <View
        accessibilityLabel={strings.t('emojiCategories')}
        style={[styles.tabs, { flexDirection: dir.row, borderBottomColor: withAlpha(theme.text, 0.08) }]}
      >
        {EMOJI_CATEGORIES.filter((c) => sections.some((s) => s.category === c)).map((category) => {
          const selected = results == null && active === category;
          return (
            <Pressable
              key={category}
              accessibilityRole="button"
              accessibilityLabel={strings.t(emojiCategoryKey(category))}
              accessibilityState={{ selected }}
              onPress={() => jumpTo(category)}
              style={[styles.tab, selected ? { backgroundColor: withAlpha(ink, 0.14) } : null]}
            >
              <Text allowFontScaling={false} style={styles.tabIcon}>
                {EMOJI_CATEGORY_ICON[category]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {results != null ? (
        results.length === 0 ? (
          <View style={styles.status}>
            <Text
              accessibilityLiveRegion="polite"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.statusText, { color: muted }]}
            >
              {strings.t('emojiNoResults')}
            </Text>
          </View>
        ) : (
          <ScrollView
            accessibilityLabel={strings.t('emojiResults')}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.gridContent}
          >
            {chunk(results, columns).map((row, i) => cellsRow(row, `s:${i}`))}
          </ScrollView>
        )
      ) : null}

      {/* Mounted under the results, so a tab tapped while searching can
          scroll it the moment the results go. */}
      <FlatList
        ref={list}
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderRow}
        getItemLayout={(_, index) => ({
          length: rows[index]?.kind === 'header' ? HEADER : CELL,
          offset: offsets[index] ?? 0,
          index,
        })}
        onScroll={onScroll}
        scrollEventThrottle={32}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={14}
        windowSize={7}
        contentContainerStyle={styles.gridContent}
        style={results != null ? styles.hidden : styles.grid}
      />
    </View>
  );
}

export interface EmojiPickerSheetProps extends EmojiPickerProps {
  visible: boolean;
  /** The visitor put it away — a tap above it, or the system back gesture. */
  onClose: () => void;
}

/**
 * {@link EmojiPicker} as a sheet over the chat, on the page's own ground — what
 * the quick reaction row's + opens. Picking one closes it through `onPick`;
 * the caller decides whether it sets or takes back (`toggledReaction`).
 */
export function EmojiPickerSheet({
  visible,
  theme,
  strings,
  onPick,
  onClose,
}: EmojiPickerSheetProps): React.JSX.Element | null {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <DirectionProvider value={theme.direction}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetRoot}
        >
          {/* The sheet's way out for a screen reader too: the Modal is its
              own window, so this is the one other thing in it. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.t('close')}
            onPress={onClose}
            style={styles.backdrop}
          />
          <SafeAreaView
            accessibilityLabel={strings.t('moreReactions')}
            style={[styles.sheet, { backgroundColor: theme.background }]}
          >
            <EmojiPicker theme={theme} strings={strings} onPick={onPick} />
          </SafeAreaView>
        </KeyboardAvoidingView>
      </DirectionProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  searchBox: {
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 40,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 8 },
  clearButton: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  tabs: {
    paddingHorizontal: PADDING,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: { flex: 1, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tabIcon: { fontSize: 18, lineHeight: 22 },
  grid: { flex: 1 },
  hidden: { display: 'none' },
  gridContent: { paddingBottom: 12 },
  header: { height: HEADER, justifyContent: 'flex-end', paddingHorizontal: PADDING + 4, paddingBottom: 4 },
  headerText: { fontSize: 12, fontWeight: '600' },
  cells: { paddingHorizontal: PADDING },
  cell: { width: CELL, height: CELL, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cellEmoji: { fontSize: 26, lineHeight: 32 },
  status: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  statusText: { fontSize: 14, textAlign: 'center' },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    height: 400,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
});
