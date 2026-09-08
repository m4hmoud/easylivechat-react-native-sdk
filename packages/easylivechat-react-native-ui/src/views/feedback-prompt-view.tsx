import {
  EasyLiveChat,
  EasyLiveChatError,
  EasyLiveChatErrorCode,
} from '@easylivechat/react-native';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDirectionStyles } from '../direction';
import { CheckCircleIcon } from '../icons';
import type { Strings } from '../l10n';
import { ERROR_COLOR, type EasyLiveChatTheme, withAlpha } from '../theme';
import { PrimaryButton, RatingRow, TextField } from './form-controls';

export interface FeedbackPromptViewProps {
  theme: EasyLiveChatTheme;
  strings: Strings;
  /** Dismisses the prompt — the visitor may decline to rate. */
  onDone?: () => void;
}

/**
 * The built-in CSAT prompt, shown once the conversation closes.
 *
 * This is the FALLBACK for a tenant who configured no post-chat survey —
 * `enabled: false` or an empty `fields` means fall back HERE, not to nothing,
 * which is the same rule the web widget follows so a visitor's experience does
 * not depend on which client they opened.
 *
 * Collects a 1–5 rating plus an optional comment. `ALREADY_RATED` (HTTP 409)
 * is treated as DONE, not as an error: the one-shot rule is enforced
 * server-side, and a visitor who already rated should see the thank-you.
 */
export function FeedbackPromptView({
  theme,
  strings,
  onDone,
}: FeedbackPromptViewProps): React.JSX.Element {
  const dir = useDirectionStyles();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (rating < 1 || submitting) return;
    setSubmitting(true);
    setError(null);
    const trimmed = comment.trim();
    try {
      await EasyLiveChat.instance.submitFeedback({
        rating,
        comment: trimmed.length === 0 ? undefined : trimmed,
      });
      setDone(true);
    } catch (e) {
      if (e instanceof EasyLiveChatError && e.code === EasyLiveChatErrorCode.ALREADY_RATED) {
        setDone(true);
        return;
      }
      setSubmitting(false);
      setError(strings.t('somethingWentWrong'));
    }
  }, [rating, comment, submitting, strings]);

  if (done) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <CheckCircleIcon color={theme.primary} size={56} />
        <Text style={[styles.thanks, { color: theme.text }]}>{strings.t('thanksForFeedback')}</Text>
        <Pressable onPress={onDone} accessibilityRole="button" style={{ padding: 12 }}>
          <Text style={{ color: theme.primary, fontSize: 15 }}>{strings.t('closeChat')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: theme.text }]}>{strings.t('rateYourChat')}</Text>
      <Text style={[styles.hint, { color: withAlpha(theme.text, 0.7) }]}>
        {strings.t('rateHint')}
      </Text>

      <View style={{ height: 20 }} />
      <RatingRow
        value={rating}
        enabled={!submitting}
        theme={theme}
        size={40}
        onChange={(v) => {
          setRating(v);
          setError(null);
        }}
      />

      <View style={{ height: 16 }} />
      <TextField
        value={comment}
        onChangeText={setComment}
        placeholder={strings.t('addAComment')}
        multiline
        hasError={false}
        editable={!submitting}
        theme={theme}
      />

      {error != null ? <Text style={[styles.error, dir.textStart]}>{error}</Text> : null}

      <View style={{ height: 20 }} />
      <PrimaryButton
        label={strings.t('submit')}
        onPress={() => void submit()}
        busy={submitting}
        disabled={rating < 1}
        theme={theme}
      />

      <Pressable
        onPress={onDone}
        accessibilityRole="button"
        style={styles.skip}
        disabled={submitting}
      >
        <Text style={{ color: withAlpha(theme.text, 0.7), fontSize: 15 }}>
          {strings.t('skipSurvey')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, flexGrow: 1, justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  hint: { fontSize: 14, textAlign: 'center', marginTop: 6 },
  error: { color: ERROR_COLOR, fontSize: 13, marginTop: 12 },
  skip: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  thanks: { fontSize: 18, fontWeight: '600', textAlign: 'center', marginTop: 16, marginBottom: 12 },
});
