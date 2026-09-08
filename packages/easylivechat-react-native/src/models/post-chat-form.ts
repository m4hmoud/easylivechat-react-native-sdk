import { EasyLiveChatErrorCode } from '../errors';
import { type PostChatFieldType, parsePostChatFieldType } from './enums';
import { EMAIL_PATTERN } from './pre-chat-form';

/**
 * A single post-chat survey field, as defined by the tenant in the dashboard.
 *
 * Mirrors `PreChatField` — same submission contract (the key is {@link id},
 * never the label; labels are tenant-authored and rendered verbatim, not
 * localized) — with the two extra types a post-chat survey needs: `rating` for
 * CSAT and `checkbox` for a yes/no.
 */
export interface PostChatField {
  id: string;
  label: string;
  type: PostChatFieldType;
  required: boolean;
  placeholder?: string;
  /** Only meaningful for `type: 'select'`. */
  options: string[];
}

export function parsePostChatField(raw: Record<string, unknown>): PostChatField {
  return {
    id: String(raw.id ?? ''),
    label: String(raw.label ?? ''),
    type: parsePostChatFieldType(raw.type),
    required: raw.required === true,
    placeholder: typeof raw.placeholder === 'string' ? raw.placeholder : undefined,
    options: Array.isArray(raw.options) ? raw.options.map((o) => String(o)) : [],
  };
}

/**
 * Client-side validation mirroring the server.
 *
 * Returns an error code (`REQUIRED` | `INVALID_EMAIL` | `INVALID_NUMBER` |
 * `INVALID_OPTION` | `INVALID_RATING`) or null when valid. The server stays
 * the authority.
 */
export function validatePostChatField(
  field: PostChatField,
  value: string | undefined,
): string | null {
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
    case 'rating': {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 5
        ? null
        : EasyLiveChatErrorCode.INVALID_RATING;
    }
    default:
      return null;
  }
}

/**
 * The resolved post-chat survey, materialized by the server on
 * `GET /:slug/config` (widget defaults, with per-channel overrides applied).
 *
 * `enabled: false`, or an empty `fields`, means the host should fall back to
 * the built-in CSAT prompt rather than showing nothing — the same rule the web
 * widget follows, so a visitor's experience does not depend on which client
 * they happened to open.
 */
export interface PostChatForm {
  enabled: boolean;
  fields: PostChatField[];
}

export const DISABLED_POST_CHAT_FORM: PostChatForm = { enabled: false, fields: [] };

/** True when the tenant has actually configured something to ask. */
export function postChatHasFields(form: PostChatForm | null | undefined): boolean {
  return form != null && form.enabled && form.fields.length > 0;
}

export function parsePostChatForm(raw: Record<string, unknown>): PostChatForm {
  return {
    enabled: raw.enabled === true,
    fields: Array.isArray(raw.fields)
      ? raw.fields
          .filter((f): f is Record<string, unknown> => f != null && typeof f === 'object')
          .map(parsePostChatField)
      : [],
  };
}
