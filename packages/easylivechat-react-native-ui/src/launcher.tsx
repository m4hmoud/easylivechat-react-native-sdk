import {
  EasyLiveChat,
  LAUNCHER_PX,
  useUnreadCount,
  useWidgetConfig,
} from '@easylivechat/react-native';
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
import { textDirectionOf } from './bidi';
import { type Direction, directionStyles, insetEnd } from './direction';
import { ChatBubbleIcon } from './icons';
import { MAX_FONT_SCALE } from './text-scaling';
import { stringsFor } from './l10n';
import type { ElcAttachmentPicker } from './picked-file';
import { FALLBACK_THEME, type EasyLiveChatTheme, onColor } from './theme';
import { useEasyLiveChatTheme } from './use-theme';
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
  /** Passed to the chat screen — see `EasyLiveChatScreenProps.showHelpArticles`. */
  showHelpArticles?: boolean;
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
 *
 * Its size and its words come from Widget settings, as the web launcher's do:
 * `launcherSize` (48, 56 or 64 points) and `launcherLabel` — "Chat with us"
 * beside the icon, a pill instead of a circle, in the visitor's language. The
 * brand colour fills it in light and dark alike.
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
  showHelpArticles,
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

  const theme = useEasyLiveChatTheme(config, themeOverride);
  // Named `chrome` because `strings` is already this component's prop — the
  // host's string-override map.
  const chrome = stringsFor(locale ?? config?.locale);
  const resolvedAlignment: LauncherAlignment =
    alignment ?? (config?.position.includes('left') === true ? 'bottom-left' : 'bottom-right');

  const onTap = useCallback(async () => {
    if (opening || presented) return;
    setOpening(true);
    // The pre-chat form here draws consent checkboxes, so ask the server for
    // them before this open() fetches the config. See the chat screen.
    EasyLiveChat.instance.supportsConsent = true;
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
  const diameter = LAUNCHER_PX[config?.launcherSize ?? 'medium'];
  const iconSize = Math.round((diameter * 26) / 56);
  // The tenant's own words, drawn verbatim — the server picked the language.
  const label = config?.launcherLabel;
  const row = directionStyles(theme.direction).row;

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
          accessibilityLabel={label ?? config?.welcomeTitle ?? chrome.t('chatTitle')}
          style={[
            styles.bubble,
            {
              backgroundColor: theme.primary,
              height: diameter,
              minWidth: diameter,
              borderRadius: diameter / 2,
              flexDirection: row,
            },
          ]}
        >
          {/* The icon in a box the launcher's own size, so it stays a circle
              on its own and the start of the pill with words beside it — a
              little narrower there, which pulls the words in toward it. */}
          <View
            style={[styles.iconBox, { width: label != null ? diameter - 6 : diameter, height: diameter }]}
          >
            {opening ? (
              <ActivityIndicator size="small" color={fg} />
            ) : bubbleIcon != null && bubbleIcon.trim().length > 0 ? (
              <RemoteImage
                uri={EasyLiveChat.instance.resolveUrl(bubbleIcon)}
                style={{
                  width: Math.round((diameter * 32) / 56),
                  height: Math.round((diameter * 32) / 56),
                  borderRadius: Math.round((diameter * 16) / 56),
                }}
                theme={theme}
                fallback={<ChatBubbleIcon color={fg} size={iconSize} />}
                placeholder={<ChatBubbleIcon color={fg} size={iconSize} />}
              />
            ) : (
              // The bubble's tail points at the speaker, so it mirrors.
              <View style={theme.direction === 'rtl' ? { transform: [{ scaleX: -1 }] } : null}>
                <ChatBubbleIcon color={fg} size={iconSize} />
              </View>
            )}
          </View>
          {label != null ? (
            <>
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={[
                  styles.label,
                  {
                    color: fg,
                    fontSize: diameter >= 64 ? 16 : 15,
                    writingDirection: textDirectionOf(label) ?? theme.direction,
                  },
                ]}
              >
                {label}
              </Text>
              {/* The pill's trailing padding, as a spacer: a logical padding
                  would follow the host's direction, not the chat's. */}
              <View style={{ width: 18 }} />
            </>
          ) : null}
        </Pressable>

        {unread > 0 ? (
          <View
            style={[
              styles.badge,
              { borderColor: theme.background },
              // Mirrors with the workspace. Neither `start`/`end` nor a bare
              // `left`/`right` is right here — see `insetEnd`.
              insetEnd(theme.direction, -2),
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
            showHelpArticles={showHelpArticles}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute' },
  bubble: {
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
  iconBox: { alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: '600', flexShrink: 1 },
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
