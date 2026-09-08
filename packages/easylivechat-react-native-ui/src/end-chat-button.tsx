import { EasyLiveChat, useEasyLiveChatPhase, useWidgetConfig } from '@easylivechat/react-native';
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { DirectionProvider } from './direction';
import { CloseIcon } from './icons';
import { stringsFor } from './l10n';
import { type EasyLiveChatTheme, onColor, themeFromConfig, withAlpha } from './theme';
import { MAX_FONT_SCALE } from './text-scaling';

export interface EasyLiveChatEndChatButtonProps {
  /** Chrome locale override — same contract as the screen's `locale` prop. */
  locale?: string;
  /** Icon colour; defaults to the theme's text colour. */
  color?: string;
  /**
   * Colours for the confirmation dialog. Defaults to the workspace config —
   * pass the same override the chat screen uses to keep them identical.
   */
  theme?: EasyLiveChatTheme;
  /** Called after the chat is ended, with whether a post-chat step follows. */
  onEnded?: (willShowPostChat: boolean) => void;
}

/**
 * The explicit "end chat" affordance.
 *
 * LEAVING AND ENDING ARE DIFFERENT ACTIONS. Backing out of the chat screen
 * does NOT end the conversation — the visitor can leave mid-chat and be
 * resumed right where they were the next time the screen opens. Ending is
 * therefore a deliberate act behind a confirmation, after which the tenant's
 * post-chat survey appears IN PLACE on the screen.
 *
 * Collapsing them into one control means a visitor who merely wanted to look
 * at something else ends up ending their chat.
 *
 * Hosts whose app bar takes a callback rather than a node use
 * {@link useConfirmAndEnd} instead.
 */
export function EasyLiveChatEndChatButton({
  locale,
  color,
  theme,
  onEnded,
}: EasyLiveChatEndChatButtonProps): React.JSX.Element | null {
  const phase = useEasyLiveChatPhase();
  const config = useWidgetConfig();
  const [confirming, setConfirming] = useState(false);

  // Only a LIVE conversation can be ended; hidden otherwise (during the
  // survey, the pre-chat form, the offline notice…).
  if (phase !== 'chat') return null;

  const resolved = theme ?? themeFromConfig(config);
  const strings = stringsFor(locale ?? config?.locale);

  return (
    <>
      <Pressable
        onPress={() => setConfirming(true)}
        accessibilityRole="button"
        accessibilityLabel={strings.t('endChat')}
        style={styles.iconButton}
        hitSlop={8}
      >
        {/* A plain ×: "close this" is what people reach for in an app bar, and
            a speaker-notes-off glyph reads as a mute control. */}
        <CloseIcon color={color ?? resolved.text} size={20} />
      </Pressable>
      <EndChatDialog
        visible={confirming}
        theme={resolved}
        locale={locale}
        onCancel={() => setConfirming(false)}
        onConfirmed={(willShowPostChat) => {
          setConfirming(false);
          onEnded?.(willShowPostChat);
        }}
      />
    </>
  );
}

export interface EndChatDialogProps {
  visible: boolean;
  theme: EasyLiveChatTheme;
  locale?: string;
  onCancel: () => void;
  onConfirmed: (willShowPostChat: boolean) => void;
}

/**
 * The confirmation itself, in the chrome locale and the workspace's own
 * colours — so it belongs to the chat rather than inheriting whatever the
 * host's design system happens to be.
 */
export function EndChatDialog({
  visible,
  theme,
  locale,
  onCancel,
  onConfirmed,
}: EndChatDialogProps): React.JSX.Element | null {
  const config = useWidgetConfig();
  const [busy, setBusy] = useState(false);
  if (!visible) return null;

  const strings = stringsFor(locale ?? config?.locale);
  const fg = onColor(theme.primary);

  const confirm = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      // The RETURN VALUE is the answer, not the phase afterwards: the phase is
      // driven by the server's `conversation:closed` echo, which the
      // controller deliberately ignores for a conversation already closed or
      // already rated. So "end" can legitimately change nothing at all, and a
      // caller waiting on a phase change waits forever.
      const willShowPostChat = await EasyLiveChat.instance.endChat();
      onConfirmed(willShowPostChat);
    } catch {
      // The conversation is either closed or it is not; either way the visitor
      // asked to leave, so close the dialog rather than trapping them in it.
      onConfirmed(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <DirectionProvider value={theme.direction}>
        <Pressable style={styles.backdrop} onPress={onCancel}>
          <Pressable
            style={[styles.dialog, { backgroundColor: theme.surface }]}
            onPress={() => undefined}
          >
            <Text style={[styles.title, { color: theme.text }]}>{strings.t('exitChatTitle')}</Text>
            <View style={{ height: 20 }} />
            {/* Ending is the deliberate choice, so it gets the solid button;
                staying is one tap away and needs no emphasis. */}
            <Pressable
              onPress={() => void confirm()}
              disabled={busy}
              accessibilityRole="button"
              style={[styles.confirm, { backgroundColor: theme.primary, opacity: busy ? 0.6 : 1 }]}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.confirmLabel, { color: fg }]}>
                {strings.t('exitChatConfirm')}
              </Text>
            </Pressable>
            <Pressable
              onPress={onCancel}
              disabled={busy}
              accessibilityRole="button"
              style={styles.cancel}
            >
              {/* Same weight as the confirm button: at w700 and w600 the two
                  read as different fonts even when the family matched. */}
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={[styles.confirmLabel, { color: withAlpha(theme.text, 0.7) }]}
              >
                {strings.t('exitChatCancel')}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </DirectionProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  dialog: { width: '100%', borderRadius: 24, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 },
  title: { fontSize: 17, lineHeight: 23, fontWeight: '600', textAlign: 'center' },
  confirm: { height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  confirmLabel: { fontSize: 15, fontWeight: '700' },
  cancel: { height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
});
