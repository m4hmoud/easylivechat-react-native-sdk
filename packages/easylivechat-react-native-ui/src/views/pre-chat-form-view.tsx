import {
  type PreChatField,
  type WidgetConfig,
  EasyLiveChat,
  EasyLiveChatError,
  isConsentField,
  isIdentityNotVerified,
  substituteVisitorVariables,
  useOnError,
  validatePreChatConsent,
  validatePreChatField,
} from '@easylivechat/react-native';
import React, { useCallback, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDirectionStyles } from '../direction';
import type { Strings } from '../l10n';
import { type EasyLiveChatTheme, errorColorOf, withAlpha } from '../theme';
import {
  ConsentField,
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
 * `{ [fieldId]: value }` map and the ticked consent ids through
 * `startSession({ fields, consents })`.
 *
 * A consent field is a checkbox beside the tenant's sentence, with a "Privacy
 * policy" link under it when the field has a `policyUrl`; the link opens in
 * the visitor's browser, never inside the host app. Consent is never a value.
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
  /**
   * Consent checkboxes by field id. Absent means unticked, so a consent field
   * that arrives with a refreshed config starts unticked too.
   */
  const [consents, setConsents] = useState<Record<string, boolean>>({});
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  /** Server-supplied per-field error codes, shown inline. */
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleError = useCallback(
    (err: EasyLiveChatError) => {
      setSubmitting(false);
      const fieldId = err.fieldId;
      if (fieldId != null && fields.some((f) => f.id === fieldId)) {
        setServerErrors((prev) => ({ ...prev, [fieldId]: err.code }));
      } else if (fieldId != null && fieldId.length > 0) {
        // A field this form does not show — the tenant changed the form while
        // the visitor was filling it in. Nothing inline can be highlighted, so
        // say so at the form level and fetch the form as it is now.
        setFormError(strings.t('somethingWentWrong'));
        void EasyLiveChat.instance.refreshAvailability();
      } else if (isIdentityNotVerified(err)) {
        // The host's identity claim was refused. Its message is written for
        // the developer (in English); the visitor can do nothing about it.
        setFormError(strings.t('somethingWentWrong'));
      } else {
        setFormError(err.message.length > 0 ? err.message : strings.t('somethingWentWrong'));
      }
    },
    [fields, strings],
  );
  useOnError(handleError);

  /** Drop the shown error for one field — it stands until the visitor acts on it. */
  const clearErrors = useCallback((id: string) => {
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

  const setValue = useCallback(
    (id: string, value: string) => {
      setValues((prev) => ({ ...prev, [id]: value }));
      clearErrors(id);
    },
    [clearErrors],
  );

  const setConsent = useCallback(
    (id: string, ticked: boolean) => {
      setConsents((prev) => ({ ...prev, [id]: ticked }));
      // Clear the moment the box is ticked, rather than leave "please tick
      // this box" under a ticked box until the next submit.
      clearErrors(id);
    },
    [clearErrors],
  );

  /**
   * Out to the visitor's browser. The URL was checked when the config was
   * parsed — only `http:`/`https:` ever reaches here — and a platform that
   * cannot open it is a no-op, not a crash in the middle of a form.
   */
  const openPolicy = useCallback((url: string) => {
    Linking.openURL(url).catch(() => undefined);
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
      const code = isConsentField(field)
        ? validatePreChatConsent(field, consents[field.id] === true)
        : validatePreChatField(field, values[field.id]);
      if (code != null) nextErrors[field.id] = code;
    }
    setLocalErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const payload: Record<string, string> = {};
    const ticked: string[] = [];
    for (const field of fields) {
      if (isConsentField(field)) {
        // Consent is not a value: it travels as the list of ticked ids.
        if (consents[field.id] === true) ticked.push(field.id);
        continue;
      }
      const trimmed = (values[field.id] ?? '').trim();
      if (trimmed.length > 0) payload[field.id] = trimmed;
    }

    setSubmitting(true);
    try {
      await EasyLiveChat.instance.startSession({ fields: payload, consents: ticked });
      // On success the controller advances `phase`; the screen swaps this view.
    } catch (e) {
      if (e instanceof EasyLiveChatError) {
        handleError(e);
      } else {
        setSubmitting(false);
        setFormError(strings.t('somethingWentWrong'));
      }
    }
  }, [fields, values, consents, handleError, strings]);

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
        if (isConsentField(field)) {
          const policyUrl = field.policyUrl;
          return (
            <View key={field.id} style={styles.field}>
              <ConsentField
                sentence={field.label}
                required={field.required}
                checked={consents[field.id] === true}
                enabled={!submitting}
                hasError={error != null}
                policyLabel={policyUrl != null ? strings.t('privacyPolicy') : undefined}
                onOpenPolicy={policyUrl != null ? () => openPolicy(policyUrl) : undefined}
                theme={theme}
                onChange={(v) => setConsent(field.id, v)}
              />
              {error != null ? <FieldError message={error} theme={theme} /> : null}
            </View>
          );
        }
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
            {error != null ? <FieldError message={error} theme={theme} /> : null}
          </View>
        );
      })}

      {formError != null ? (
        <Text style={[styles.formError, dir.textStart, { color: errorColorOf(theme) }]}>{formError}</Text>
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
  formError: { fontSize: 13, marginBottom: 12 },
});
