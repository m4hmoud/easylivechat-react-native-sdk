import {
  type ChatMessage,
  EasyLiveChat,
  isFromCustomer,
  useAgentLastReadAt,
  useAgentTyping,
  useEasyLiveChatMessages,
  useWidgetConfig,
} from '@easylivechat/react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type FlatList as FlatListType,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useDirectionStyles } from '../direction';
import type { Strings } from '../l10n';
import { type EasyLiveChatTheme, withAlpha } from '../theme';
import { ElcImageViewer } from './image-viewer';
import { MessageBubble } from './message-bubble';
import { TypingRow } from './typing-row';

export interface ThreadViewProps {
  theme: EasyLiveChatTheme;
  strings: Strings;
}

/** Start pulling the next page a little before the visitor reaches the top. */
const LOAD_OLDER_TRIGGER_PX = 240;

/** How close to the bottom counts as "following the conversation". */
const NEAR_BOTTOM_PX = 160;

/**
 * The message thread.
 *
 * Auto-scrolls to the newest message on APPEND (never when older history is
 * prepended), and pulls older pages in as the visitor approaches the top.
 */
export function ThreadView({ theme, strings }: ThreadViewProps): React.JSX.Element {
  const messages = useEasyLiveChatMessages();
  const agentLastReadAt = useAgentLastReadAt();
  const typing = useAgentTyping();
  const config = useWidgetConfig();
  const dir = useDirectionStyles();

  const listRef = useRef<FlatListType<ChatMessage>>(null);
  const lastCount = useRef(messages.length);
  const nearBottom = useRef(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  // The server already nulls `senderName` when the workspace turns names off;
  // double-guarded here so a stale row cannot leak one either.
  const showAgentNames = config?.showAgentNames ?? true;
  const showAgentAvatars = config?.showAgentAvatars ?? true;

  /**
   * Read through to the controller rather than mirrored locally: the cursor is
   * what actually knows whether earlier visits exist, and a copy of it here
   * only creates two answers that can disagree.
   */
  const hasMoreOlder = EasyLiveChat.instance.hasOlderHistory;

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !EasyLiveChat.instance.hasOlderHistory) return;
    setLoadingOlder(true);
    try {
      await EasyLiveChat.instance.loadOlderMessages();
    } catch {
      // Swallow — the load-older affordance simply stays available to retry.
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder]);

  useEffect(() => {
    const count = messages.length;
    const appended = count > lastCount.current && !loadingOlder;
    lastCount.current = count;
    if (!appended) return;

    // The visitor's OWN message always follows itself down. Gating this on
    // "near the bottom" alone assumed their send is always FROM the bottom. It
    // is not: they can scroll up to re-read something, type a reply to it, and
    // send from there — the gate then failed and their message landed
    // off-screen, so the thread looked like it had swallowed it. The keyboard
    // opening moves the scroll extent too, which could push them out of the
    // window without their having scrolled at all.
    //
    // An INBOUND message still respects the gate: an agent's reply must not
    // yank the visitor out of history they are in the middle of reading.
    const last = messages[messages.length - 1];
    const own = last != null && isFromCustomer(last);
    if (own || nearBottom.current) {
      // `requestAnimationFrame` so the row is laid out before we scroll to it.
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages, loadingOlder]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      nearBottom.current =
        contentSize.height - (contentOffset.y + layoutMeasurement.height) <= NEAR_BOTTOM_PX;
      // Oldest first, so the top of the list is offset 0.
      if (contentOffset.y <= LOAD_OLDER_TRIGGER_PX) void loadOlder();
    },
    [loadOlder],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <MessageBubble
        message={item}
        theme={theme}
        showAgentName={showAgentNames}
        showAgentAvatar={showAgentAvatars}
        strings={strings}
        agentLastReadAt={agentLastReadAt}
        onOpenImage={setViewerUri}
      />
    ),
    [theme, showAgentNames, showAgentAvatars, strings, agentLastReadAt],
  );

  const header = (
    <LoadOlderHeader
      visible={hasMoreOlder || loadingOlder}
      loading={loadingOlder}
      theme={theme}
      label={strings.t('loadOlder')}
      onPress={() => void loadOlder()}
    />
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <FlatList
        ref={listRef}
        data={messages as ChatMessage[]}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListFooterComponent={typing ? <TypingRow theme={theme} label={strings.t('agentTyping')} /> : null}
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        scrollEventThrottle={64}
        // So the thread can be pulled even when it fits the screen — that drag
        // is how a visitor reaches earlier visits.
        alwaysBounceVertical
        keyboardShouldPersistTaps="handled"
        // A message list is not a data grid: keeping rows mounted avoids the
        // blank-cell flicker RN's virtualization shows on fast scroll-back.
        removeClippedSubviews={false}
        onContentSizeChange={() => {
          if (nearBottom.current && lastCount.current > 0) {
            listRef.current?.scrollToEnd({ animated: false });
          }
        }}
        // `dir` is read so the list re-renders when the workspace direction
        // changes; the bubbles themselves lay out from the context.
        extraData={dir.direction}
      />
      <ElcImageViewer
        visible={viewerUri != null}
        uri={viewerUri}
        theme={theme}
        strings={strings}
        onClose={() => setViewerUri(null)}
      />
    </View>
  );
}

function keyExtractor(m: ChatMessage): string {
  return m.id;
}

/**
 * The "load earlier messages" control.
 *
 * A real control, not just a spinner: scrolling up still loads automatically,
 * but a thread that opens on a short session may not be scrollable at all, and
 * the earlier visits behind it have to stay reachable.
 */
function LoadOlderHeader({
  visible,
  loading,
  theme,
  label,
  onPress,
}: {
  visible: boolean;
  loading: boolean;
  theme: EasyLiveChatTheme;
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  if (!visible) return <View style={{ height: 4 }} />;
  return (
    <View style={styles.loadOlder}>
      {loading ? (
        <ActivityIndicator size="small" color={withAlpha(theme.text, 0.4)} />
      ) : (
        <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}>
          <Text style={{ fontSize: 12, color: withAlpha(theme.text, 0.6) }}>{label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingVertical: 12, flexGrow: 1, justifyContent: 'flex-end' },
  loadOlder: { alignItems: 'center', paddingVertical: 8 },
});
