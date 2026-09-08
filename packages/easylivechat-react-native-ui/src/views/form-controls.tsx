import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { useDirectionStyles } from '../direction';
import { CaretDownIcon, CheckboxIcon, RadioIcon, StarIcon } from '../icons';
import type { Strings } from '../l10n';
import { ERROR_COLOR, type EasyLiveChatTheme, onColor, withAlpha } from '../theme';
import { MAX_FONT_SCALE } from '../text-scaling';

/**
 * The shared form controls for the pre-chat form and the post-chat survey.
 *
 * Field LABELS and PLACEHOLDERS passed in here are TENANT-AUTHORED and are
 * rendered VERBATIM — they are written per language in the dashboard and must
 * never be localized by the SDK. Only the chrome (the required marker, the
 * validation messages, the submit button) comes from the string table.
 */

export function FieldLabel({
  label,
  required,
  theme,
}: {
  label: string;
  required: boolean;
  theme: EasyLiveChatTheme;
}): React.JSX.Element {
  const dir = useDirectionStyles();
  return (
    <Text style={[styles.label, dir.textStart, { color: theme.text }]}>
      {required ? `${label} *` : label}
    </Text>
  );
}

export function FieldError({ message }: { message: string }): React.JSX.Element {
  const dir = useDirectionStyles();
  return <Text style={[styles.error, dir.textStart]}>{message}</Text>;
}

export function TextField({
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  hasError,
  editable = true,
  theme,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  hasError: boolean;
  editable?: boolean;
  theme: EasyLiveChatTheme;
}): React.JSX.Element {
  const dir = useDirectionStyles();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={withAlpha(theme.text, 0.4)}
      editable={editable}
      multiline={multiline}
      keyboardType={keyboardType}
      style={[
        styles.input,
        dir.textStart,
        {
          color: theme.text,
          backgroundColor: theme.surface,
          borderColor: hasError ? ERROR_COLOR : withAlpha(theme.text, 0.15),
          minHeight: multiline === true ? 92 : 44,
          textAlignVertical: multiline === true ? 'top' : 'center',
        },
      ]}
    />
  );
}

/**
 * A compact select: a trigger showing the current value, and a modal sheet of
 * options.
 *
 * Used by the PRE-CHAT form, where a field can legitimately carry twenty
 * options (a country, a product line) and laying them all out flat would push
 * the "Start chat" button off the bottom of a form the visitor has not filled
 * in yet. The post-chat survey uses flat radio rows instead — see
 * {@link RadioGroup}.
 */
export function SelectField({
  value,
  options,
  placeholder,
  hasError,
  theme,
  strings,
  onChange,
}: {
  value: string;
  options: string[];
  placeholder?: string;
  hasError: boolean;
  theme: EasyLiveChatTheme;
  strings: Strings;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const dir = useDirectionStyles();
  const [open, setOpen] = useState(false);
  const shown = value.length > 0 ? value : (placeholder ?? strings.t('selectAnOption'));

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        style={[
          styles.input,
          styles.selectTrigger,
          {
            flexDirection: dir.row,
            backgroundColor: theme.surface,
            borderColor: hasError ? ERROR_COLOR : withAlpha(theme.text, 0.15),
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            dir.textStart,
            { flex: 1, fontSize: 15, color: value.length > 0 ? theme.text : withAlpha(theme.text, 0.5) },
          ]}
        >
          {shown}
        </Text>
        <CaretDownIcon color={withAlpha(theme.text, 0.5)} size={12} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.background }]}
            onPress={() => undefined}
          >
            <ScrollView>
              {options.map((option) => (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  onPress={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  style={[styles.sheetRow, { flexDirection: dir.row }]}
                >
                  <RadioIcon
                    color={option === value ? theme.primary : withAlpha(theme.text, 0.35)}
                    selected={option === value}
                    size={20}
                  />
                  <Text style={[{ color: theme.text, fontSize: 16, marginHorizontal: 12, flex: 1 }, dir.textStart]}>
                    {option}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * Flat option rows.
 *
 * A post-chat survey asks two or three short questions with two or three short
 * answers; a dropdown hides every option behind a tap, opens a sheet over the
 * thread, and turns a one-tap answer into three. Laying the options out flat
 * means the visitor can see and answer the whole survey without a menu.
 */
export function RadioGroup({
  value,
  options,
  enabled,
  theme,
  onChange,
}: {
  value: string;
  options: string[];
  enabled: boolean;
  theme: EasyLiveChatTheme;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const dir = useDirectionStyles();
  return (
    <View>
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            disabled={!enabled}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={[
              styles.radioRow,
              {
                flexDirection: dir.row,
                backgroundColor: selected ? withAlpha(theme.primary, 0.08) : 'transparent',
                borderColor: selected ? theme.primary : withAlpha(theme.text, 0.15),
              },
            ]}
          >
            <RadioIcon
              color={selected ? theme.primary : withAlpha(theme.text, 0.35)}
              selected={selected}
              size={20}
            />
            <Text style={[{ color: theme.text, fontSize: 15, marginHorizontal: 10, flex: 1 }, dir.textStart]}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function CheckboxRow({
  label,
  checked,
  enabled,
  theme,
  onChange,
}: {
  label: string;
  checked: boolean;
  enabled: boolean;
  theme: EasyLiveChatTheme;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  const dir = useDirectionStyles();
  return (
    <Pressable
      disabled={!enabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: dir.row, alignItems: 'flex-start', paddingVertical: 4 }}
    >
      <CheckboxIcon
        color={theme.primary}
        borderColor={withAlpha(theme.text, 0.35)}
        checked={checked}
        size={20}
      />
      <Text
        style={[
          { color: theme.text, fontSize: 14, fontWeight: '600', marginHorizontal: 10, flex: 1 },
          dir.textStart,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function RatingRow({
  value,
  enabled,
  theme,
  size = 34,
  onChange,
}: {
  value: number;
  enabled: boolean;
  theme: EasyLiveChatTheme;
  size?: number;
  onChange: (rating: number) => void;
}): React.JSX.Element {
  const dir = useDirectionStyles();
  return (
    <View style={{ flexDirection: dir.row, justifyContent: 'center' }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable
          key={star}
          disabled={!enabled}
          accessibilityRole="button"
          accessibilityLabel={`${star} / 5`}
          onPress={() => onChange(star)}
          style={{ paddingHorizontal: 4 }}
          hitSlop={6}
        >
          <StarIcon
            size={size}
            filled={star <= value}
            color={star <= value ? theme.primary : withAlpha(theme.text, 0.3)}
          />
        </Pressable>
      ))}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  busy,
  disabled,
  theme,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  theme: EasyLiveChatTheme;
}): React.JSX.Element {
  const inactive = disabled === true || busy === true;
  const fg = onColor(theme.primary);
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive }}
      style={[
        styles.primaryButton,
        { backgroundColor: inactive ? withAlpha(theme.primary, 0.5) : theme.primary },
      ]}
    >
      {busy === true ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.primaryLabel, { color: fg }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  error: { color: ERROR_COLOR, fontSize: 12, marginTop: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  selectTrigger: { alignItems: 'center' },
  radioRow: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  primaryButton: {
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: { fontSize: 16, fontWeight: '600' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingVertical: 8,
    paddingBottom: 28,
  },
  sheetRow: { paddingHorizontal: 20, paddingVertical: 14, alignItems: 'center' },
});
