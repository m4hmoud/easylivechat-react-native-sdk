import {
  type ChatMessage,
  type EasyLiveChatError,
  EasyLiveChat,
  isFromCustomer,
  postChatHasFields,
  useEasyLiveChatPhase,
  useIsBooted,
  useOnError,
  useOnMessage,
  useWidgetConfig,
  useWorkspaceAvailability,
} from '@easylivechat/react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { type Direction, DirectionProvider, useDirectionStyles } from './direction';
import { ElcChime } from './chime';
import { EasyLiveChatEndChatButton } from './end-chat-button';
import { BackIcon, OfflineIcon } from './icons';
import { overrideAll, overrideByLocale, setHostLocale, stringsFor } from './l10n';
import type { ElcAttachmentPicker } from './picked-file';
import { type EasyLiveChatTheme, themeFromConfig, withAlpha } from './theme';
import { ClosedNoticeBanner, ClosedNoticeView } from './views/closed-notice-view';
import { ComposerBar } from './views/composer-bar';
import { FeedbackPromptView } from './views/feedback-prompt-view';
import { PostChatFormView } from './views/post-chat-form-view';
import { PreChatFormView } from './views/pre-chat-form-view';
import { ThreadView } from './views/thread-view';
import { PrimaryButton } from './views/form-controls';
import { MAX_FONT_SCALE } from './text-scaling';

export interface EasyLiveChatScreenProps {
  /** Host theme override; every field present wins over the server config. */
  themeOverride?: Partial<EasyLiveChatTheme>;
  /**
   * Force the layout direction (e.g. from the host app's current locale),
   * independent of the server workspace direction.
   */
  directionOverride?: Direction;
  /** Host hook that fully owns attachment picking. */
  onPickAttachments?: ElcAttachmentPicker;
  /**
   * Host overrides for the SDK chrome strings, applied to EVERY locale. Keys
   * not provided fall back to the built-in translations.
   */
  strings?: Record<string, string>;
  /**
   * Per-locale chrome overrides: `{ ckb: { send: 'بنێرە' } }`.
   *
   * Prefer this over `strings` when your own copy is multilingual — `strings`
   * applies to every locale, so it shows a Kurdish and an Arabic visitor the
   * same words. Wins over `strings` key by key.
   */
  stringsByLocale?: Record<string, Record<string, string>>;
  /**
   * Force the chrome locale, overriding the server workspace locale — which
   * returns the workspace default (often `en`) regardless of the visitor's app
   * language.
   */
  locale?: string;
  /**
   * Show the SDK's own app bar: a back button that LEAVES the chat running,
   * and an × that ENDS it.
   *
   * Opt-in and false by default because most hosts render this inside a screen
   * that already has a header, and turning it on unconditionally would give
   * them two stacked bars.
   */
  showAppBar?: boolean;
  /**
   * Title for `showAppBar`. Defaults to the localized `chatTitle` chrome
   * string.
   *
   * Deliberately NOT the workspace's `welcomeTitle`. That is greeting copy —
   * "Hi there 👋" — written for the body of the welcome/pre-chat screen, and
   * it reads wrong as a navigation title ("Hi there 👋" sitting above "We're
   * not available right now"). Worse, `PreChatFormView` renders the same
   * string as its own heading, so any workspace with a pre-chat form showed it
   * TWICE on one screen.
   */
  appBarTitle?: string;
  /** Called by the app bar's back button and by the post-chat "close". */
  onRequestClose?: () => void;
}

/**
 * The full chat surface — a PHASE ROUTER bound to the SDK's `phase` store.
 *
 * | phase                       | view                                     |
 * |-----------------------------|------------------------------------------|
 * | idle / loading / resuming   | centred spinner (and kicks `open()`)     |
 * | offline                     | ClosedNoticeView                         |
 * | prechat                     | PreChatFormView                          |
 * | chat                        | ClosedNoticeBanner? + Thread + Composer  |
 * | feedback                    | PostChatFormView, else FeedbackPromptView|
 *
 * The subtree is wrapped in the resolved direction, and `AppState` is relayed
 * to `setAppLifecycle` to gate the heartbeat and presence socket.
 */
export function EasyLiveChatScreen(props: EasyLiveChatScreenProps): React.JSX.Element {
  const {
    themeOverride,
    directionOverride,
    onPickAttachments,
    strings: stringOverrides,
    stringsByLocale,
    locale,
    showAppBar = false,
    appBarTitle,
    onRequestClose,
  } = props;

  const booted = useIsBooted();
  const phase = useEasyLiveChatPhase();
  const config = useWidgetConfig();
  const { workspaceClosed, composerLocked } = useWorkspaceAvailability();

  // Register the host's locale + string overrides BEFORE the views read them.
  // A layout effect would be tidier but these are module-level registries, and
  // running them during render keeps the first paint correct rather than
  // flashing the wrong language for a frame.
  if (locale != null) setHostLocale(locale);
  if (stringOverrides != null) overrideAll(stringOverrides);
  if (stringsByLocale != null) overrideByLocale(stringsByLocale);

  const strings = stringsFor(locale ?? config?.locale);

  const theme = useMemo(() => {
    const base = themeFromConfig(config, themeOverride);
    return directionOverride != null ? { ...base, direction: directionOverride } : base;
  }, [config, themeOverride, directionOverride]);

  /** Latches the (non-idempotent) open() so a phase rebuild cannot re-fire it. */
  const openRequested = useRef(false);
  /**
   * A blocking failure while loading config / starting the session, shown as a
   * full-screen error + retry. Later (send/socket) errors are handled inline
   * by the composer and the thread.
   */
  const [error, setError] = useState<EasyLiveChatError | null>(null);

  const startOpen = useCallback(() => {
    openRequested.current = true;
    // `open()` is fire-and-forget on the happy path (the phase store drives
    // the UI), but a loadConfig failure throws OUT of it rather than onto
    // `onError` — catch it so we show an error+retry instead of an endless
    // spinner.
    EasyLiveChat.instance.open().catch((e: unknown) => {
      setError(e as EasyLiveChatError);
    });
  }, []);

  const maybeOpen = useCallback(() => {
    if (openRequested.current) return;
    if (!EasyLiveChat.instance.isBooted) return;
    const p = EasyLiveChat.instance.phase.get();
    // Open on a fresh mount when idle, OR when a previous session ended at the
    // feedback screen — so reopening after rating starts a FRESH conversation
    // instead of re-showing an already-submitted rating.
    //
    // `offline` re-opens too: it is a snapshot of an availability answer that
    // has since expired, and `open()` re-fetches the config and lands on
    // whichever screen is right NOW — the notice again, or the live chat.
    if (p === 'idle' || p === 'feedback' || p === 'offline') {
      startOpen();
      return;
    }
    // A live session: `open()` would be a no-op, but this is still a fresh
    // VIEW of the chat, and availability is server-decided and can have moved
    // since the last open (an hours boundary, agents going offline).
    void EasyLiveChat.instance.refreshAvailability();
  }, [startOpen]);

  // The thread being on screen IS the read receipt. Reported on mount, on
  // every inbound arrival (the socket may not be up yet at mount), and on
  // returning to the foreground.
  const onArrival = useCallback((message: ChatMessage) => {
    if (isFromCustomer(message)) return;
    EasyLiveChat.instance.markRead();
  }, []);
  useOnMessage(onArrival);

  const onSdkError = useCallback((e: EasyLiveChatError) => {
    // Only surface a FULL-SCREEN error while we are still blocked loading the
    // config. Once config is in, send/socket errors belong to the composer and
    // the thread, not to this screen.
    if (EasyLiveChat.instance.widgetConfig.get() == null) setError(e);
  }, []);
  useOnError(onSdkError);

  useEffect(() => {
    if (!booted) return;
    // Chime here as well as on the launcher, for hosts that push the screen
    // directly. Ref-counted, so having both up rings once.
    ElcChime.attach();
    maybeOpen();
    // Catches everything that arrived before this screen was pushed.
    EasyLiveChat.instance.markRead();
    return () => ElcChime.detach();
  }, [booted, maybeOpen]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (!EasyLiveChat.instance.isBooted) return;
      if (state === 'active') {
        EasyLiveChat.instance.setAppLifecycle('resumed');
        // The workspace may have closed — or reopened — while the app sat in
        // the background. Re-ask rather than trusting stale state; from the
        // notice screen this also lets the chat come back by itself. Only the
        // notice screen is worth re-driving through `open()`; clearing the
        // guard unconditionally could double-open on top of a request still in
        // flight.
        if (EasyLiveChat.instance.phase.get() === 'offline') openRequested.current = false;
        maybeOpen();
        // Back on the thread after a spell in the background — anything that
        // landed meanwhile is being read right now.
        EasyLiveChat.instance.markRead();
        return;
      }
      if (state === 'background') {
        EasyLiveChat.instance.setAppLifecycle('paused');
      }
      // iOS `inactive` (call banner, app switcher, Control Centre) is
      // TRANSIENT — do not churn heartbeat/presence on it.
    });
    return () => subscription.remove();
  }, [maybeOpen]);

  const retry = useCallback(() => {
    setError(null);
    openRequested.current = false;
    startOpen();
  }, [startOpen]);

  if (!booted) return <BootRequired />;

  return (
    <DirectionProvider value={theme.direction}>
      <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
        <KeyboardAvoidingView
          style={styles.root}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {showAppBar ? (
            <ChatAppBar
              theme={theme}
              title={appBarTitle ?? strings.t('chatTitle')}
              locale={locale}
              onBack={onRequestClose}
            />
          ) : null}

          <View style={styles.root}>
            <PhaseView
              phase={phase}
              error={error}
              onRetry={retry}
              theme={theme}
              strings={strings}
              config={config}
              workspaceClosed={workspaceClosed}
              composerLocked={composerLocked}
              onPickAttachments={onPickAttachments}
              onRequestClose={onRequestClose}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </DirectionProvider>
  );
}

function PhaseView({
  phase,
  error,
  onRetry,
  theme,
  strings,
  config,
  workspaceClosed,
  composerLocked,
  onPickAttachments,
  onRequestClose,
}: {
  phase: ReturnType<typeof useEasyLiveChatPhase>;
  error: EasyLiveChatError | null;
  onRetry: () => void;
  theme: EasyLiveChatTheme;
  strings: ReturnType<typeof stringsFor>;
  config: ReturnType<typeof useWidgetConfig>;
  workspaceClosed: boolean;
  composerLocked: boolean;
  onPickAttachments?: ElcAttachmentPicker;
  onRequestClose?: () => void;
}): React.JSX.Element {
  const spinner = (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color={theme.primary} />
    </View>
  );

  switch (phase) {
    case 'idle':
    case 'loading':
    case 'resuming':
      return error != null ? (
        <ErrorRetry theme={theme} strings={strings} onRetry={onRetry} />
      ) : (
        spinner
      );

    case 'offline':
      if (config == null) {
        return error != null ? (
          <ErrorRetry theme={theme} strings={strings} onRetry={onRetry} />
        ) : (
          spinner
        );
      }
      return <ClosedNoticeView config={config} theme={theme} strings={strings} />;

    case 'prechat':
      if (config == null) {
        return error != null ? (
          <ErrorRetry theme={theme} strings={strings} onRetry={onRetry} />
        ) : (
          spinner
        );
      }
      return <PreChatFormView config={config} theme={theme} strings={strings} />;

    case 'chat':
      return (
        <View style={styles.root}>
          {/* Closed, but the composer stays live: the message becomes a
              PENDING conversation the team picks up when they are back. Also
              shown when only the composer is locked — an input that refuses to
              type with nothing explaining why reads as a broken app. */}
          {workspaceClosed || composerLocked ? (
            <ClosedNoticeBanner config={config} theme={theme} strings={strings} />
          ) : null}
          <ThreadView theme={theme} strings={strings} />
          <ComposerBar
            theme={theme}
            strings={strings}
            onPickAttachments={onPickAttachments}
          />
        </View>
      );

    case 'feedback':
      // A tenant that built a survey in the dashboard gets exactly that;
      // everyone else keeps the built-in CSAT. Same rule as the web widget, so
      // a visitor's questions do not depend on which client they opened.
      return config != null && postChatHasFields(config.postChatForm) ? (
        <PostChatFormView
          config={config}
          theme={theme}
          strings={strings}
          onDone={onRequestClose}
        />
      ) : (
        <FeedbackPromptView theme={theme} strings={strings} onDone={onRequestClose} />
      );
  }
}

/**
 * The SDK's own app bar: back on the leading edge, end-chat on the trailing.
 *
 * Two separate affordances on purpose — backing out leaves the conversation
 * OPEN (the visitor can come back to it and the agent still sees it live),
 * whereas the × is the explicit end, which confirms first and then shows the
 * post-chat survey.
 */
function ChatAppBar({
  theme,
  title,
  locale,
  onBack,
}: {
  theme: EasyLiveChatTheme;
  title: string;
  locale?: string;
  onBack?: () => void;
}): React.JSX.Element {
  const dir = useDirectionStyles();
  return (
    <View
      style={[
        styles.appBar,
        {
          flexDirection: dir.row,
          backgroundColor: theme.background,
          borderBottomColor: withAlpha(theme.text, 0.08),
        },
      ]}
    >
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        style={styles.appBarButton}
        hitSlop={8}
      >
        {/* Directional: mirrored so ar/ku/ur get the back arrow pointing the
            right way without a second layout. */}
        <View style={dir.mirror}>
          <BackIcon color={theme.text} size={22} />
        </View>
      </Pressable>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.appBarTitle, dir.textStart, { color: theme.text }]}
      >
        {title}
      </Text>
      {/* Renders only while there is something to end; otherwise it keeps the
          title centred by occupying the same width. */}
      <View style={styles.appBarButton}>
        <EasyLiveChatEndChatButton locale={locale} color={theme.text} theme={theme} />
      </View>
    </View>
  );
}

function ErrorRetry({
  theme,
  strings,
  onRetry,
}: {
  theme: EasyLiveChatTheme;
  strings: ReturnType<typeof stringsFor>;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <View style={[styles.centered, { paddingHorizontal: 24 }]}>
      <OfflineIcon color={withAlpha(theme.text, 0.4)} size={40} />
      <Text style={[styles.errorText, { color: withAlpha(theme.text, 0.8) }]}>
        {strings.t('couldNotConnect')}
      </Text>
      <View style={{ height: 20, width: '100%' }} />
      <View style={{ alignSelf: 'stretch' }}>
        <PrimaryButton label={strings.t('retry')} onPress={onRetry} theme={theme} />
      </View>
    </View>
  );
}

/** Shown if the screen is presented before `EasyLiveChat.boot()` was called. */
function BootRequired(): React.JSX.Element {
  return (
    <View style={styles.centered}>
      <Text style={styles.bootText}>
        {'EasyLiveChat is not initialized.\nCall EasyLiveChat.instance.boot(...) before opening the chat.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 15, textAlign: 'center', marginTop: 16 },
  bootText: { fontSize: 14, textAlign: 'center' },
  appBar: {
    height: 52,
    alignItems: 'center',
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  appBarButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  appBarTitle: { flex: 1, fontSize: 16, fontWeight: '600', marginHorizontal: 4 },
});
