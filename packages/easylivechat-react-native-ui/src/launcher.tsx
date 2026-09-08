import { EasyLiveChat, useUnreadCount, useWidgetConfig } from '@easylivechat/react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ElcChime } from './chime';
import { EasyLiveChatScreen } from './chat-screen';
import type { Direction } from './direction';
import { ChatBubbleIcon } from './icons';
import { stringsFor } from './l10n';
import type { ElcAttachmentPicker } from './picked-file';
import { FALLBACK_THEME, type EasyLiveChatTheme, onColor, themeFromConfig } from './theme';
import { RemoteImage } from './views/remote-image';

export type LauncherAlignment = 'bottom-left' | 'bottom-right';

export interface EasyLiveChatLauncherProps {
  themeOverride?: Partial<EasyLiveChatTheme>;
  /** Explicit alignment. When absent, derived from `WidgetConfig.position`. */
  alignment?: LauncherAlignment;
  /** Present the chat as a sheet-style modal rather than a full-screen one. */
  useBottomSheet?: boolean;
  directionOverride?: Direction;
  onPickAttachments?: ElcAttachmentPicker;
  strings?: Record<string, string>;
  stringsByLocale?: Record<string, Record<string, string>>;
  locale?: string;
  /** Distance from the screen edges. Defaults to 16. */
  offset?: number;
}

/**
 * The floating launcher bubble — the native replacement for the web widget's
 * loader.
 *
 * Drop it over your app:
 *
 * ```tsx
 * <View style={{ flex: 1 }}>
 *   <MyApp />
 *   <EasyLiveChatLauncher />
 * </View>
 * ```
 *
 * On tap it lazily `open()`s the session and presents an
 * {@link EasyLiveChatScreen}. It carries an unread badge bound to
 * `unreadCount`, capped at `99+`.
 */
export function EasyLiveChatLauncher({
  themeOverride,
  alignment,
  useBottomSheet = false,
  directionOverride,
  onPickAttachments,
  strings,
  stringsByLocale,
  locale,
  offset = 16,
}: EasyLiveChatLauncherProps): React.JSX.Element {
  const config = useWidgetConfig();
  const unread = useUnreadCount();

  /**
   * Re-entrancy guard, in TWO parts. `opening` covers the boot window;
   * `presented` covers the whole time the screen is up. The bubble stays
   * mounted behind a non-fullscreen modal, and a second tap would otherwise
   * boot again and stack a duplicate chat surface.
   */
  const [opening, setOpening] = useState(false);
  const [presented, setPresented] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // The bubble is the surface that is up when the visitor ISN'T reading the
    // thread — exactly when a reply most needs to make a sound.
    ElcChime.attach();
    return () => {
      mounted.current = false;
      ElcChime.detach();
    };
  }, []);

  const theme = themeFromConfig(config, themeOverride);
  // Named `chrome` because `strings` is already this component's prop — the
  // host's string-override map.
  const chrome = stringsFor(locale ?? config?.locale);
  const resolvedAlignment: LauncherAlignment =
    alignment ?? (config?.position.includes('left') === true ? 'bottom-left' : 'bottom-right');

  const onTap = useCallback(async () => {
    if (opening || presented) return;
    setOpening(true);
    try {
      await EasyLiveChat.instance.open();
    } catch {
      // Surfaced through `onError` and the screen's phase router; still
      // present the screen so the error/offline state is visible.
    }
    if (!mounted.current) return;
    setOpening(false);
    setPresented(true);
  }, [opening, presented]);

  const close = useCallback(() => {
    setPresented(false);
    // Returning from the screen clears local unread and re-arms the bubble.
    EasyLiveChat.instance.markRead();
  }, []);

  const bubbleIcon = themeOverride?.bubbleIconUrl ?? config?.bubbleIconUrl;
  const fg = onColor(theme.primary);

  return (
    <>
      <View
        pointerEvents="box-none"
        style={[
          styles.anchor,
          resolvedAlignment === 'bottom-left'
            ? { left: offset, bottom: offset }
            : { right: offset, bottom: offset },
        ]}
      >
        <Pressable
          onPress={() => void onTap()}
          accessibilityRole="button"
          // Localized, not a hardcoded English fallback — this is the only
          // label a screen-reader user gets for the launcher.
          accessibilityLabel={config?.welcomeTitle ?? chrome.t('chatTitle')}
          style={[styles.bubble, { backgroundColor: theme.primary }]}
        >
          {opening ? (
            <ActivityIndicator size="small" color={fg} />
          ) : bubbleIcon != null && bubbleIcon.trim().length > 0 ? (
            <RemoteImage
              uri={EasyLiveChat.instance.resolveUrl(bubbleIcon)}
              style={styles.bubbleIcon}
              theme={theme}
              fallback={<ChatBubbleIcon color={fg} size={26} />}
              placeholder={<ChatBubbleIcon color={fg} size={26} />}
            />
          ) : (
            // The bubble's tail points at the speaker, so it mirrors.
            <View style={theme.direction === 'rtl' ? { transform: [{ scaleX: -1 }] } : null}>
              <ChatBubbleIcon color={fg} size={26} />
            </View>
          )}
        </Pressable>

        {unread > 0 ? (
          <View
            style={[
              styles.badge,
              { borderColor: theme.background },
              // Mirrors with the workspace. `start`/`end` cannot be used here:
              // they resolve through `I18nManager.isRTL`, which the SDK
              // deliberately never sets (it is process-global and would flip
              // the host app), so the side is chosen explicitly.
              theme.direction === 'rtl' ? { left: -2 } : { right: -2 },
            ]}
            pointerEvents="none"
            accessible
            accessibilityLabel={String(unread)}
          >
            <Text allowFontScaling={false} style={styles.badgeText}>
              {unread > 99 ? '99+' : String(unread)}
            </Text>
          </View>
        ) : null}
      </View>

      <Modal
        visible={presented}
        animationType="slide"
        presentationStyle={useBottomSheet ? 'pageSheet' : 'fullScreen'}
        onRequestClose={close}
      >
        <SafeAreaView style={[styles.modalRoot, { backgroundColor: theme.background }]}>
          <EasyLiveChatScreen
            themeOverride={themeOverride}
            directionOverride={directionOverride}
            onPickAttachments={onPickAttachments}
            strings={strings}
            stringsByLocale={stringsByLocale}
            locale={locale}
            showAppBar
            onRequestClose={close}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute' },
  bubble: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    // A real shadow on both platforms: iOS reads the shadow* props, Android
    // only `elevation`.
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  bubbleIcon: { width: 32, height: 32, borderRadius: 16 },
  badge: {
    position: 'absolute',
    top: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EF4444',
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  modalRoot: { flex: 1 },
});

/** Re-exported so a host can paint its own bubble in the SDK's fallback colours. */
export { FALLBACK_THEME };
