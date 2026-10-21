import { EasyLiveChat, useIsBooted, useWidgetConfig } from '@easylivechat/react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';

import { BootRequired, EasyLiveChatScreen } from './chat-screen';
import { type Direction, DirectionProvider } from './direction';
import { overrideAll, overrideByLocale, setHostLocale, stringsFor } from './l10n';
import type { EasyLiveChatTheme } from './theme';
import { useEasyLiveChatTheme } from './use-theme';
import type { ElcOpenLink } from './views/help-markdown-view';
import { type ElcHelpApi, HelpView } from './views/help-view';

export interface EasyLiveChatHelpScreenProps {
  /** Host theme override; every field present wins over the server config. */
  themeOverride?: Partial<EasyLiveChatTheme>;
  /** Force the layout direction, independent of the workspace's. */
  directionOverride?: Direction;
  /** Chrome string overrides for every locale — as on `EasyLiveChatScreen`. */
  strings?: Record<string, string>;
  /** Per-locale chrome overrides — as on `EasyLiveChatScreen`. */
  stringsByLocale?: Record<string, Record<string, string>>;
  /** Force the chrome locale. */
  locale?: string;
  /**
   * Leave help: the header's back button on the list, and the back button of
   * the chat it opens when `onStartChat` is omitted. Omitted: no back button on
   * the list.
   */
  onClose?: () => void;
  /**
   * "Still need help? Start a chat" was tapped. Route to your own chat screen
   * here. Omitted: the help screen turns into an `EasyLiveChatScreen` in place
   * (with its own app bar, since it then owns the screen).
   */
  onStartChat?: () => void;
  /**
   * A link inside an article was tapped. Omitted: the platform opens it
   * (browser, mail app, dialer).
   */
  onOpenLink?: ElcOpenLink;
  /**
   * Draw the screen's own header — back and the title. On by default. Off
   * (your navigator draws one), an article gets a "Back" of its own above it.
   */
  showAppBar?: boolean;
  /** Open straight onto one article (e.g. from a deep link). Back returns to the list. */
  initialArticleId?: string;
  /** Article source; defaults to the booted SDK. For tests. */
  api?: ElcHelpApi;
}

/**
 * The workspace's help articles as a screen of its own — for a host with a
 * "Help" tab or menu entry rather than the entry inside the chat.
 *
 * Needs `boot()` only, no session. Show it only while
 * `widgetConfig.helpArticlesEnabled` is true (`useWidgetConfig()`); with the
 * workspace switch off the list comes back empty. If nothing has loaded the
 * config yet this screen fetches it, for the theme and the language — without
 * starting a chat.
 *
 * Layout follows the workspace direction (or `directionOverride`), and each
 * article reads in its own language's direction.
 *
 * ```tsx
 * const config = useWidgetConfig();
 * {config?.helpArticlesEnabled ? (
 *   <EasyLiveChatHelpScreen onStartChat={() => navigation.navigate('Chat')} />
 * ) : null}
 * ```
 */
export function EasyLiveChatHelpScreen({
  themeOverride,
  directionOverride,
  strings: stringOverrides,
  stringsByLocale,
  locale,
  onClose,
  onStartChat,
  onOpenLink,
  showAppBar = true,
  initialArticleId,
  api,
}: EasyLiveChatHelpScreenProps): React.JSX.Element {
  const booted = useIsBooted();
  const config = useWidgetConfig();
  /** "Start a chat" with no `onStartChat`: the chat has taken this screen. */
  const [chatting, setChatting] = useState(false);

  // Same registries, same reason, as `EasyLiveChatScreen`.
  if (locale != null) setHostLocale(locale);
  if (stringOverrides != null) overrideAll(stringOverrides);
  if (stringsByLocale != null) overrideByLocale(stringsByLocale);
  const strings = stringsFor(locale ?? config?.locale);

  const theme = useEasyLiveChatTheme(config, themeOverride, directionOverride);

  useEffect(() => {
    if (!booted || EasyLiveChat.instance.widgetConfig.get() != null) return;
    // `refreshAvailability`, not `loadConfig`: it fetches the config without
    // moving the chat's phase, so opening help first cannot strand the chat.
    void EasyLiveChat.instance.refreshAvailability().catch(() => undefined);
  }, [booted]);

  const startChat = useCallback(() => {
    if (onStartChat != null) {
      onStartChat();
      return;
    }
    setChatting(true);
  }, [onStartChat]);

  // A test can drive the screen through `api` without booting anything.
  if (!booted && api == null) return <BootRequired />;

  if (chatting) {
    return (
      <EasyLiveChatScreen
        themeOverride={themeOverride}
        directionOverride={directionOverride}
        locale={locale}
        showAppBar
        onRequestClose={onClose}
      />
    );
  }

  return (
    <DirectionProvider value={theme.direction}>
      <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
        <HelpView
          theme={theme}
          strings={strings}
          onClose={onClose}
          onStartChat={startChat}
          onOpenLink={onOpenLink}
          showAppBar={showAppBar}
          initialArticleId={initialArticleId}
          api={api}
        />
      </SafeAreaView>
    </DirectionProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
