import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { textDirectionOf } from '../bidi';
import { directionStyles, isolate, useDirectionStyles } from '../direction';
import { CloseIcon } from '../icons';
import type { Strings } from '../l10n';
import { MAX_FONT_SCALE } from '../text-scaling';
import {
  type EasyLiveChatTheme,
  errorColorOf,
  inkOf,
  keyboardAppearance,
  onColor,
  withAlpha,
} from '../theme';

/** What a submit came back with: the address it went to (masked), or why not. */
export type EmailCardResult = { ok: true; hint: string } | { ok: false; message: string };

export interface EmailCardProps {
  /**
   * `transcript` — "Email me this chat", from the app bar's envelope (or the
   * host's `EasyLiveChatEmailTranscriptButton`) or the screen after a chat.
   * `notify` — "Get the reply by email", offered while nobody can answer.
   */
  mode: 'transcript' | 'notify';
  /** The address on file, masked (`d•••@example.com`), or null when there is none. */
  emailHint: string | null;
  theme: EasyLiveChatTheme;
  strings: Strings;
  /** `email` is what the visitor typed, or null to use the address on file. */
  onSubmit: (email: string | null) => Promise<EmailCardResult>;
  onClose: () => void;
}

/** The web widget's check (EmailCard.tsx), so both refuse the same addresses. */
export const EMAIL_CARD_PATTERN =
  /^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[^\s@<>()[\],;:"\\.]{2,}$/;

/** How long a sent transcript says so before the card gets out of the way. */
export const EMAIL_SENT_DISMISS_MS = 4000;

/**
 * The web widget's `EmailCard`: an inline card in the chat — never a modal, so
 * the conversation stays where it was — that says what happened in its own
 * place rather than in a toast.
 *
 * With an address on file the transcript card is a one-tap confirmation that
 * names it; "Use another address" (or no address at all) shows the field. The
 * reply card always asks for one: it is only offered to a visitor with none.
 */
export function EmailCard({
  mode,
  emailHint,
  theme,
  strings,
  onSubmit,
  onClose,
}: EmailCardProps): React.JSX.Element {
  const dir = useDirectionStyles();
  const [typing, setTyping] = useState(emailHint == null || mode === 'notify');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneHint, setDoneHint] = useState<string | null>(null);

  // A sent transcript says so for a moment, then gets out of the way.
  useEffect(() => {
    if (doneHint == null || mode !== 'transcript') return;
    const timer = setTimeout(onClose, EMAIL_SENT_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [doneHint, mode, onClose]);

  const submit = useCallback(async () => {
    if (busy) return;
    let email: string | null = null;
    if (typing) {
      const v = value.trim();
      if (!EMAIL_CARD_PATTERN.test(v)) {
        setError(strings.t('invalidEmail'));
        return;
      }
      email = v;
    }
    setBusy(true);
    setError(null);
    const result = await onSubmit(email);
    setBusy(false);
    if (result.ok) setDoneHint(result.hint);
    else setError(result.message);
  }, [busy, typing, value, strings, onSubmit]);

  const muted = withAlpha(theme.text, 0.7);
  const cardStyle = [
    styles.card,
    { backgroundColor: theme.surface, borderColor: withAlpha(theme.text, 0.12) },
  ];

  if (doneHint != null) {
    const done = strings
      .t(mode === 'transcript' ? 'emailSentTo' : 'notifySaved')
      // Isolated: an address is left-to-right inside any sentence.
      .replace('{email}', isolate(doneHint));
    return (
      <View testID={`email-card-${mode}-done`} style={[cardStyle, styles.doneRow, { flexDirection: dir.row }]}>
        <Text
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.text, styles.doneText, dir.textStart, { color: theme.text }]}
        >
          {done}
        </Text>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={strings.t('close')}
          hitSlop={10}
          style={styles.closeButton}
        >
          <CloseIcon color={muted} size={14} />
        </Pressable>
      </View>
    );
  }

  // The field faces the way what is typed in it reads — the chat's way while empty.
  const inputDir = directionStyles(textDirectionOf(value) ?? dir.direction);
  const fg = onColor(theme.primary);

  return (
    <View testID={`email-card-${mode}`} style={cardStyle}>
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.title, dir.textStart, { color: theme.text }]}
      >
        {strings.t(mode === 'transcript' ? 'emailTranscript' : 'notifyTitle')}
      </Text>
      {mode === 'notify' ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, dir.textStart, { color: muted }]}>
          {strings.t('notifyBody')}
        </Text>
      ) : null}

      {!typing && emailHint != null ? (
        <View style={{ alignItems: dir.alignStart }}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, dir.textStart, { color: theme.text }]}>
            {strings.t('emailSendTo').replace('{email}', isolate(emailHint))}
          </Text>
          <Pressable
            onPress={() => setTyping(true)}
            accessibilityRole="button"
            hitSlop={6}
            style={styles.link}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.linkText, { color: inkOf(theme) }]}>
              {strings.t('emailOther')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <TextInput
          value={value}
          onChangeText={(v) => {
            setValue(v);
            if (error != null) setError(null);
          }}
          onSubmitEditing={() => void submit()}
          placeholder={strings.t('yourEmail')}
          placeholderTextColor={withAlpha(theme.text, 0.4)}
          accessibilityLabel={strings.t('yourEmail')}
          keyboardAppearance={keyboardAppearance(theme)}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="send"
          // Asked for: the visitor opened this card to type into it.
          autoFocus={mode === 'transcript'}
          editable={!busy}
          style={[
            styles.input,
            inputDir.textStart,
            {
              color: theme.text,
              backgroundColor: theme.background,
              borderColor: error != null ? errorColorOf(theme) : withAlpha(theme.text, 0.15),
            },
          ]}
        />
      )}

      {error != null ? (
        <Text
          accessibilityLiveRegion="assertive"
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.error, dir.textStart, { color: errorColorOf(theme) }]}
        >
          {error}
        </Text>
      ) : null}

      {/* At the trailing edge, in reading order: the way out, then the action. */}
      <View style={[styles.actions, { flexDirection: dir.row }]}>
        <Pressable
          onPress={onClose}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          style={({ pressed }) => [
            styles.button,
            pressed ? { backgroundColor: withAlpha(theme.text, 0.07) } : null,
          ]}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.buttonLabel, { color: muted }]}>
            {strings.t(mode === 'notify' ? 'notifyDismiss' : 'cancel')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => void submit()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, busy }}
          accessibilityLabel={busy ? strings.t('sending') : undefined}
          style={[
            styles.button,
            { backgroundColor: busy ? withAlpha(theme.primary, 0.6) : theme.primary },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={fg} />
          ) : (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.buttonLabel, { color: fg }]}>
              {strings.t(mode === 'notify' ? 'notifyButton' : 'send')}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 2,
    padding: 14,
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  doneRow: { alignItems: 'center', gap: 10 },
  doneText: { flex: 1 },
  title: { fontSize: 15, fontWeight: '600' },
  text: { fontSize: 14, lineHeight: 20 },
  link: { paddingVertical: 2 },
  linkText: { fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    minHeight: 44,
  },
  error: { fontSize: 13 },
  actions: { justifyContent: 'flex-end', gap: 8, marginTop: 2 },
  button: {
    minWidth: 72,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { fontSize: 14, fontWeight: '600' },
  closeButton: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
});
