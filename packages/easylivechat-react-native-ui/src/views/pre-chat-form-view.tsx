import {
  type PreChatField,
  type WidgetConfig,
  EasyLiveChat,
  EasyLiveChatError,
  substituteVisitorVariables,
  useOnError,
  validatePreChatField,
} from '@easylivechat/react-native';
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDirectionStyles } from '../direction';
import type { Strings } from '../l10n';
import { ERROR_COLOR, type EasyLiveChatTheme, withAlpha } from '../theme';
import {
  FieldError,
  FieldLabel,
  PrimaryButton,
  SelectField,
  TextField,
} from './form-controls';

export interface PreChatFormViewProps {
  config: WidgetConfig;
  theme: EasyLiveChatTheme;
  strings: Strings;
}

/**
 * The tenant's pre-chat form.
 *
 * Renders `config.preChatForm.fields` in order, enforcing `required` and
 * per-type validation locally (the server stays the authority), then submits a
 * `{ [fieldId]: value }` map through `startSession`.
 *
 * TENANT-AUTHORED COPY — `welcomeTitle`, `welcomeSubtitle` and every field
 * `label`/`placeholder` — is rendered VERBATIM, never localized. Only SDK
 * chrome (the button, validation messages) comes from the string table.
 *
 * A server `400 { fieldId }` arrives on `onError` and highlights that field
 * inline; it is the authority over the local check.
 */
export function PreChatFormView({
  config,
  theme,
  strings,
}: PreChatFormViewProps): React.JSX.Element {
  const dir = useDirectionStyles();
  const fields = config.preChatForm.fields;

  const [values, setValues] = useState<Record<string, string>>({});
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  /** Server-supplied per-field error codes, shown inline. */
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleError = useCallback(
    (err: EasyLiveChatError) => {
      setSubmitting(false);
      if (err.fieldId != null && err.fieldId.length > 0) {
        setServerErrors((prev) => ({ ...prev, [err.fieldId as string]: err.code }));
      } else {
        setFormError(err.message.length > 0 ? err.message : strings.t('somethingWentWrong'));
      }
    },
    [strings],
  );
  useOnError(handleError);

  const setValue = useCallback((id: string, value: string) => {
    setValues((prev) => ({ ...prev, [id]: value }));
    // A server error for this field stands until the visitor edits it.
    setServerErrors((prev) => {
      if (prev[id] == null) return prev;
      const { [id]: _dropped, ...rest } = prev;
      return rest;
    });
    setLocalErrors((prev) => {
      if (prev[id] == null) return prev;
      const { [id]: _dropped, ...rest } = prev;
      return rest;
    });
  }, []);

  const errorFor = useCallback(
    (field: PreChatField): string | null => {
      const serverCode = serverErrors[field.id];
      if (serverCode != null) return strings.forErrorCode(serverCode);
      const localCode = localErrors[field.id];
      return localCode != null ? strings.forErrorCode(localCode) : null;
    },
    [serverErrors, localErrors, strings],
  );

  const submit = useCallback(async () => {
    setFormError(null);
    const nextErrors: Record<string, string> = {};
    for (const field of fields) {
      const code = validatePreChatField(field, values[field.id]);
      if (code != null) nextErrors[field.id] = code;
    }
    setLocalErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const payload: Record<string, string> = {};
    for (const field of fields) {
      const trimmed = (values[field.id] ?? '').trim();
      if (trimmed.length > 0) payload[field.id] = trimmed;
    }

    setSubmitting(true);
    try {
      await EasyLiveChat.instance.startSession({ fields: payload });
      // On success the controller advances `phase`; the screen swaps this view.
    } catch (e) {
      if (e instanceof EasyLiveChatError) {
        handleError(e);
      } else {
        setSubmitting(false);
        setFormError(strings.t('somethingWentWrong'));
      }
    }
  }, [fields, values, handleError, strings]);

  // Tenant copy can address the visitor by name. The server cannot fill this
  // in: `GET /config` is answered before anyone has identified.
  const title = useMemo(
    () =>
      substituteVisitorVariables(config.welcomeTitle, {
        name: EasyLiveChat.instance.visitorName,
        defaultName: config.defaultCustomerName,
      }),
    [config.welcomeTitle, config.defaultCustomerName],
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, dir.textStart, { color: theme.text }]}>{title}</Text>
      {config.welcomeSubtitle.trim().length > 0 ? (
        <Text style={[styles.subtitle, dir.textStart, { color: withAlpha(theme.text, 0.7) }]}>
          {config.welcomeSubtitle}
        </Text>
      ) : null}

      <View style={{ height: 24 }} />

      {fields.map((field) => {
        const error = errorFor(field);
        return (
          <View key={field.id} style={styles.field}>
            <FieldLabel label={field.label} required={field.required} theme={theme} />
            {field.type === 'select' ? (
              <SelectField
                value={values[field.id] ?? ''}
                options={field.options}
                placeholder={field.placeholder}
                hasError={error != null}
                theme={theme}
                strings={strings}
                onChange={(v) => setValue(field.id, v)}
              />
            ) : (
              <TextField
                value={values[field.id] ?? ''}
                onChangeText={(v) => setValue(field.id, v)}
                placeholder={field.placeholder}
                multiline={field.type === 'textarea'}
                keyboardType={keyboardTypeFor(field.type)}
                hasError={error != null}
                editable={!submitting}
                theme={theme}
              />
            )}
            {error != null ? <FieldError message={error} /> : null}
          </View>
        );
      })}

      {formError != null ? (
        <Text style={[styles.formError, dir.textStart]}>{formError}</Text>
      ) : null}

      <View style={{ height: 8 }} />
      <PrimaryButton
        label={strings.t('startChat')}
        onPress={() => void submit()}
        busy={submitting}
        theme={theme}
      />
    </ScrollView>
  );
}

function keyboardTypeFor(type: PreChatField['type']): 'default' | 'email-address' | 'phone-pad' | 'decimal-pad' {
  switch (type) {
    case 'email':
      return 'email-address';
    case 'phone':
      return 'phone-pad';
    case 'number':
      return 'decimal-pad';
    default:
      return 'default';
  }
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 24, paddingBottom: 32 },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 15, lineHeight: 21, marginTop: 6 },
  field: { marginBottom: 16 },
  formError: { color: ERROR_COLOR, fontSize: 13, marginBottom: 12 },
});
