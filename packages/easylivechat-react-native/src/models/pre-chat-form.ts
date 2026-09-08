import { EasyLiveChatErrorCode } from '../errors';
import { type PreChatFieldType, parsePreChatFieldType } from './enums';

/** Matches the server's own check — one `@`, one dot in the domain, no spaces. */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * A single pre-chat form field, as defined by the tenant in WidgetConfig.
 *
 * The submission key is {@link id}, NEVER `label`. Labels are tenant-authored
 * and are NOT localized — render them verbatim.
 */
export interface PreChatField {
  id: string;
  label: string;
  type: PreChatFieldType;
  required: boolean;
  placeholder?: string;
  /** Only meaningful for `type: 'select'`. */
  options: string[];
}

export function parsePreChatField(raw: Record<string, unknown>): PreChatField {
  return {
    id: String(raw.id ?? ''),
    label: String(raw.label ?? ''),
    type: parsePreChatFieldType(raw.type),
    required: raw.required === true,
    placeholder: typeof raw.placeholder === 'string' ? raw.placeholder : undefined,
    options: Array.isArray(raw.options) ? raw.options.map((o) => String(o)) : [],
  };
}

/**
 * Client-side validation mirroring the server (`validatePreChatSubmission`).
 *
 * Returns an error code (`REQUIRED` | `INVALID_EMAIL` | `INVALID_NUMBER` |
 * `INVALID_OPTION`) or null when valid. The server remains the authority.
 */
export function validatePreChatField(field: PreChatField, value: string | undefined): string | null {
  const v = (value ?? '').trim();
  if (field.required && v.length === 0) return EasyLiveChatErrorCode.REQUIRED;
  if (v.length === 0) return null;
  switch (field.type) {
    case 'email':
      return EMAIL_PATTERN.test(v) ? null : EasyLiveChatErrorCode.INVALID_EMAIL;
    case 'number':
      return Number.isNaN(Number(v)) ? EasyLiveChatErrorCode.INVALID_NUMBER : null;
    case 'select':
      return field.options.includes(v) ? null : EasyLiveChatErrorCode.INVALID_OPTION;
    default:
      return null;
  }
}

/**
 * The resolved pre-chat form. `enabled: false` means skip straight to
 * anonymous chat. The server always materializes this on `GET /:slug/config`.
 */
export interface PreChatForm {
  enabled: boolean;
  fields: PreChatField[];
}

export const DISABLED_PRE_CHAT_FORM: PreChatForm = { enabled: false, fields: [] };

export function parsePreChatForm(raw: Record<string, unknown>): PreChatForm {
  return {
    enabled: raw.enabled === true,
    fields: Array.isArray(raw.fields)
      ? raw.fields
          .filter((f): f is Record<string, unknown> => f != null && typeof f === 'object')
          .map(parsePreChatField)
      : [],
  };
}
