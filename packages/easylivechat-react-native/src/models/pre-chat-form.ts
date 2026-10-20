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
  /**
   * What the visitor reads beside the input. For a `consent` field this is
   * the whole sentence they agree to — up to 500 characters, so let it wrap.
   */
  label: string;
  type: PreChatFieldType;
  required: boolean;
  placeholder?: string;
  /** Only meaningful for `type: 'select'`. */
  options: string[];
  /**
   * Only meaningful for `type: 'consent'`: the privacy policy the sentence
   * refers to, to be linked beside the checkbox and opened outside the app.
   * Always an `http:`/`https:` URL — anything else is dropped when the field
   * is parsed (see {@link cleanPolicyUrl}).
   */
  policyUrl?: string;
}

export function parsePreChatField(raw: Record<string, unknown>): PreChatField {
  const type = parsePreChatFieldType(raw.type);
  const field: PreChatField = {
    id: String(raw.id ?? ''),
    label: String(raw.label ?? ''),
    type,
    required: raw.required === true,
    placeholder:
      type !== 'consent' && typeof raw.placeholder === 'string' ? raw.placeholder : undefined,
    options: Array.isArray(raw.options) ? raw.options.map((o) => String(o)) : [],
  };
  if (type === 'consent') {
    const url = cleanPolicyUrl(raw.policyUrl);
    if (url != null) field.policyUrl = url;
  }
  return field;
}

/** A checkbox the visitor ticks, not a value they type. */
export function isConsentField(field: Pick<PreChatField, 'type'>): boolean {
  return field.type === 'consent';
}

/**
 * Client-side validation mirroring the server (`validatePreChatSubmission`).
 *
 * Returns an error code (`REQUIRED` | `INVALID_EMAIL` | `INVALID_NUMBER` |
 * `INVALID_OPTION`) or null when valid. The server remains the authority.
 *
 * Always null for a consent field: consent is not a value. Check it with
 * {@link validatePreChatConsent}.
 */
export function validatePreChatField(field: PreChatField, value: string | undefined): string | null {
  if (isConsentField(field)) return null;
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
 * A consent field's check: `CONSENT_REQUIRED` when it is required and not
 * `accepted`, else null. Null for any other kind of field.
 */
export function validatePreChatConsent(field: PreChatField, accepted: boolean): string | null {
  if (!isConsentField(field)) return null;
  return field.required && !accepted ? EasyLiveChatErrorCode.CONSENT_REQUIRED : null;
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

/**
 * The form's consent checkboxes, in form order — what a form of your own draws
 * as checkboxes rather than inputs. Empty from a server that has none, or that
 * was not asked for them (`supportsConsent` off).
 */
export function consentFieldsOf(form: PreChatForm): PreChatField[] {
  return form.fields.filter(isConsentField);
}

/**
 * Check the consents a visitor ticked against the form — the server's own
 * `validateConsents` (`packages/shared/src/pre-chat-form.ts`), so a
 * `CONSENT_REQUIRED` can be shown before the round trip.
 *
 * `accepted` is the list of consent field ids the visitor ticked. Returns the
 * accepted consent fields (in form order) or the first required one left
 * unticked. A disabled form asks for nothing.
 */
export function validateConsents(
  form: PreChatForm,
  accepted: readonly string[] | null | undefined,
):
  | { ok: true; accepted: PreChatField[] }
  | { ok: false; error: typeof EasyLiveChatErrorCode.CONSENT_REQUIRED; fieldId: string } {
  const ticked = new Set(accepted ?? []);
  const out: PreChatField[] = [];
  if (!form.enabled) return { ok: true, accepted: out };
  for (const field of form.fields) {
    if (!isConsentField(field)) continue;
    if (ticked.has(field.id)) out.push(field);
    else if (field.required) {
      return { ok: false, error: EasyLiveChatErrorCode.CONSENT_REQUIRED, fieldId: field.id };
    }
  }
  return { ok: true, accepted: out };
}

const POLICY_URL_MAX = 500;
const POLICY_URL_PATTERN = /^https?:\/\/[^\s/?#@]+\.[^\s/?#@]+(?:[/?#][^\s]*)?$/i;

/**
 * `raw` as an `http:`/`https:` URL, or null.
 *
 * The server's `cleanPolicyUrl`, ported so the SDK never opens a link the
 * server would not have stored — a `javascript:` link beside a checkbox is an
 * attack, not a policy. A pattern rather than `new URL()`: React Native's
 * `URL` has no working `protocol`.
 */
export function cleanPolicyUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (v.length === 0 || v.length > POLICY_URL_MAX) return null;
  return POLICY_URL_PATTERN.test(v) ? v : null;
}
