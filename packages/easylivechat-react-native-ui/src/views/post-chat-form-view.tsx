import {
  type PostChatField,
  type WidgetConfig,
  EasyLiveChat,
  EasyLiveChatError,
  validatePostChatField,
} from '@easylivechat/react-native';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDirectionStyles } from '../direction';
import { CheckCircleIcon } from '../icons';
import type { Strings } from '../l10n';
import { ERROR_COLOR, type EasyLiveChatTheme, withAlpha } from '../theme';
import {
  CheckboxRow,
  FieldError,
  FieldLabel,
  PrimaryButton,
  RadioGroup,
  RatingRow,
  TextField,
} from './form-controls';

export interface PostChatFormViewProps {
  config: WidgetConfig;
  theme: EasyLiveChatTheme;
  strings: Strings;
  /** Dismisses the survey — the visitor may decline to answer. */
  onDone?: () => void;
}

/**
 * The tenant's post-chat survey.
 *
 * Renders `config.postChatForm.fields` — the questions the tenant built in the
 * dashboard, not a fixed CSAT — and submits `{ [fieldId]: value }` through
 * `submitPostChat`.
 *
 * The wire format matches the web widget EXACTLY, because both write to the
 * same column and the dashboard reads one shape: a checkbox is sent as
 * `'true'` only when ticked and omitted otherwise, a rating as `'1'`–`'5'`,
 * everything else trimmed. A required checkbox means "must be TICKED", not
 * "must be answered".
 *
 * Tenant-authored copy (every `label` / `placeholder`) is rendered VERBATIM.
 */
export function PostChatFormView({
  config,
  theme,
  strings,
  onDone,
}: PostChatFormViewProps): React.JSX.Element {
  const dir = useDirectionStyles();
  const fields = config.postChatForm.fields;

  const [texts, setTexts] = useState<Record<string, string>>({});
  const [selects, setSelects] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  /** The value a field currently holds, in the shape the server expects. */
  const valueOf = useCallback(
    (f: PostChatField): string => {
      switch (f.type) {
        case 'select':
          return selects[f.id] ?? '';
        case 'checkbox':
          return checks[f.id] === true ? 'true' : '';
        case 'rating': {
          const r = ratings[f.id] ?? 0;
          return r === 0 ? '' : String(r);
        }
        default:
          return texts[f.id] ?? '';
      }
    },
    [selects, checks, ratings, texts],
  );

  const clearError = useCallback((id: string) => {
    setErrors((prev) => {
      if (prev[id] == null) return prev;
      const { [id]: _dropped, ...rest } = prev;
      return rest;
    });
  }, []);

  const submit = useCallback(async () => {
    setFormError(null);
    const nextErrors: Record<string, string> = {};
    for (const f of fields) {
      const code = validatePostChatField(f, valueOf(f));
      if (code != null) nextErrors[f.id] = code;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const payload: Record<string, string> = {};
    for (const f of fields) {
      const v = valueOf(f).trim();
      // Empty stays OUT of the payload entirely — an unanswered optional
      // question is absent, not blank, which is how the dashboard reads it.
      if (v.length > 0) payload[f.id] = v;
    }

    setSubmitting(true);
    try {
      await EasyLiveChat.instance.submitPostChat(payload);
      setSubmitting(false);
      setDone(true);
    } catch (e) {
      setSubmitting(false);
      setFormError(
        e instanceof EasyLiveChatError && e.fieldId != null
          ? strings.forErrorCode(e.code)
          : strings.t('somethingWentWrong'),
      );
    }
  }, [fields, valueOf, strings]);

  if (done) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <CheckCircleIcon color={theme.primary} size={44} />
        <Text style={[styles.thanks, { color: theme.text }]}>{strings.t('thanksForFeedback')}</Text>
        {/* Somewhere to go once they are done. Previously the thanks screen
            was terminal: the survey submitted and then simply sat there. */}
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
      <Text style={[styles.title, dir.textStart, { color: theme.text }]}>
        {strings.t('rateYourChat')}
      </Text>
      <View style={{ height: 20 }} />

      {fields.map((f) => {
        const code = errors[f.id];
        const error = code != null ? strings.forErrorCode(code) : null;
        return (
          <View key={f.id} style={styles.field}>
            {f.type === 'checkbox' ? (
              <CheckboxRow
                label={f.required ? `${f.label} *` : f.label}
                checked={checks[f.id] === true}
                enabled={!submitting}
                theme={theme}
                onChange={(v) => {
                  setChecks((prev) => ({ ...prev, [f.id]: v }));
                  clearError(f.id);
                }}
              />
            ) : (
              <>
                <FieldLabel label={f.label} required={f.required} theme={theme} />
                {f.type === 'rating' ? (
                  <RatingRow
                    value={ratings[f.id] ?? 0}
                    enabled={!submitting}
                    theme={theme}
                    onChange={(v) => {
                      setRatings((prev) => ({ ...prev, [f.id]: v }));
                      clearError(f.id);
                    }}
                  />
                ) : f.type === 'select' ? (
                  <RadioGroup
                    value={selects[f.id] ?? ''}
                    options={f.options}
                    enabled={!submitting}
                    theme={theme}
                    onChange={(v) => {
                      setSelects((prev) => ({ ...prev, [f.id]: v }));
                      clearError(f.id);
                    }}
                  />
                ) : (
                  <TextField
                    value={texts[f.id] ?? ''}
                    onChangeText={(v) => {
                      setTexts((prev) => ({ ...prev, [f.id]: v }));
                      clearError(f.id);
                    }}
                    placeholder={f.placeholder}
                    multiline={f.type === 'textarea'}
                    keyboardType={
                      f.type === 'email'
                        ? 'email-address'
                        : f.type === 'phone'
                          ? 'phone-pad'
                          : f.type === 'number'
                            ? 'decimal-pad'
                            : 'default'
                    }
                    hasError={error != null}
                    editable={!submitting}
                    theme={theme}
                  />
                )}
              </>
            )}
            {error != null ? <FieldError message={error} /> : null}
          </View>
        );
      })}

      {formError != null ? (
        <Text style={[styles.formError, dir.textStart]}>{formError}</Text>
      ) : null}

      <PrimaryButton
        label={strings.t('submit')}
        onPress={() => void submit()}
        busy={submitting}
        theme={theme}
      />

      {/* Leaving the survey. The conversation is already over by the time this
          view exists, so there is nothing to confirm and nothing to lose — the
          visitor owes nobody an answer to get their own app back. Without this
          the only control on the screen was Submit, which made an optional
          survey behave like a required one. */}
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
  content: { padding: 20, paddingTop: 24, paddingBottom: 32 },
  title: { fontSize: 20, fontWeight: '700' },
  field: { marginBottom: 18 },
  formError: { color: ERROR_COLOR, fontSize: 13, marginBottom: 12 },
  skip: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  thanks: { fontSize: 16, lineHeight: 22, textAlign: 'center', marginTop: 14, marginBottom: 12 },
});
