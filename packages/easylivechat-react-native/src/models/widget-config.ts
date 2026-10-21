import { EasyLiveChatError, EasyLiveChatErrorCode } from '../errors';
import { type LocaleDirection, parseLocaleDirection } from './enums';
import {
  type PostChatForm,
  DISABLED_POST_CHAT_FORM,
  parsePostChatForm,
} from './post-chat-form';
import { type PreChatForm, DISABLED_PRE_CHAT_FORM, parsePreChatForm } from './pre-chat-form';

/**
 * Light, dark, or following the visitor's own setting (`auto`) — the
 * workspace's choice in Widget settings.
 */
export type WidgetColorScheme = 'auto' | 'light' | 'dark';

/**
 * The scheme a config asks for. A server older than the setting sends nothing,
 * which reads as `light` — what every widget was before it — so a missing
 * field never changes anyone's look. (New workspaces default to `auto`;
 * existing ones were kept on `light` until their admin chooses.)
 */
export function parseColorScheme(v: unknown): WidgetColorScheme {
  return v === 'auto' || v === 'light' || v === 'dark' ? v : 'light';
}

/** The scheme to paint, given the workspace's choice and the device's appearance. */
export function resolveColorScheme(
  choice: WidgetColorScheme,
  deviceDark: boolean,
): 'light' | 'dark' {
  if (choice === 'auto') return deviceDark ? 'dark' : 'light';
  return choice;
}

/** The launcher's size: `small` 48, `medium` 56 (the size it always was), `large` 64. */
export type LauncherSize = 'small' | 'medium' | 'large';

/** The launcher's diameter — and the pill's height — in points, per size. */
export const LAUNCHER_PX: Readonly<Record<LauncherSize, number>> = { small: 48, medium: 56, large: 64 };

/** "Chat with us" — a few words beside the launcher's icon, never a sentence. */
export const LAUNCHER_LABEL_MAX = 40;

function parseLauncherSize(v: unknown): LauncherSize {
  return v === 'small' || v === 'large' ? v : 'medium';
}

/** Collapsed to one line and capped, as the server and the web loader do; undefined when empty. */
function cleanLauncherLabel(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const one = v.replace(/\s+/g, ' ').trim();
  if (one.length === 0) return undefined;
  const capped = Array.from(one).slice(0, LAUNCHER_LABEL_MAX).join('').trim();
  return capped.length > 0 ? capped : undefined;
}

/** What the visitor may do, decided server-side. */
export type VisitorMode = 'CHAT' | 'LEAVE_MESSAGE' | 'NOTICE_ONLY';

/** Why the workspace is in its current state. */
export type AvailabilityReason = 'OPEN' | 'AFTER_HOURS' | 'NO_AGENTS' | 'HOLIDAY';

/**
 * The full `WidgetConfig` row returned by `GET /:slug/config`, plus the
 * resolved forms. Drives all theming/locale/RTL and feature toggles.
 *
 * Unknown/extra server fields are ignored; everything is null-tolerant.
 */
export interface WidgetConfig {
  id: string;
  tenantId: string;

  // ── Theme ──
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  bubbleIconUrl?: string;
  logoUrl?: string;
  soundUrl?: string;

  /**
   * Raw CSS — parsed off the wire but IGNORED by native (it cannot map to
   * React Native styles). Hosts override via the UI theme instead.
   */
  customCss?: string;

  // ── Copy (tenant-authored: render VERBATIM, never localize) ──
  welcomeTitle: string;
  welcomeSubtitle: string;
  offlineMessage: string;

  /**
   * The business's own closed notice (Settings → Availability), in the
   * visitor's language — or undefined when the workspace has written none.
   *
   * Not the same thing as {@link offlineMessage}: that one is the
   * leave-a-message prompt from the widget's copy, and carries a schema
   * default nobody typed. The closed/busy notice shows THIS when it is set —
   * the business's words always win — and the SDK's own localized notice when
   * it is not.
   */
  offlineInfoText?: string;

  /**
   * Stands in for `%name%` when the visitor has not identified. Set by the
   * tenant as "Default customer name".
   */
  defaultCustomerName?: string;

  // ── Layout / behaviour ──
  /** `bottom-right` | `bottom-left`. */
  position: string;
  locale: string;
  direction: LocaleDirection;
  soundEnabled: boolean;

  /**
   * Whether visitors may record and send voice messages.
   *
   * Off unless the workspace turned it on: a microphone prompt is a large
   * thing to spring on someone who only opened a chat, and plenty of hosts
   * should never ask. Defaults to false when the server omits it, so an older
   * server keeps the SDK quiet rather than guessing.
   */
  voiceNotesEnabled: boolean;
  showAgentAvatars: boolean;
  showAgentNames: boolean;
  /** Legacy fallback flag. */
  collectEmailPreChat: boolean;

  preChatForm: PreChatForm;

  /**
   * The survey shown once the conversation is closed. Built by the tenant in
   * the dashboard; empty/disabled means fall back to the built-in CSAT.
   */
  postChatForm: PostChatForm;
  allowedOrigins: string[];

  /**
   * The workspace's "Show help articles" switch. When true the visitor may
   * search and read the workspace's published help articles
   * (`EasyLiveChat.searchHelp` / `getHelpArticle`). Absent on an older server,
   * which reads as false — nothing is offered that cannot be served.
   */
  helpArticlesEnabled: boolean;

  /**
   * Light, dark, or following the device (`auto`). Absent on an older server,
   * which reads as `light`. Resolve it with {@link resolveColorScheme}.
   */
  colorScheme: WidgetColorScheme;

  /**
   * Draw the preview card under a message with a link in it
   * (`linkPreviewOf`). On by default; absent on an older server, which reads
   * as on — a preview only exists where the server made one.
   */
  linkPreviews: boolean;

  /**
   * Words beside the launcher's icon ("Chat with us"), in the visitor's
   * language — tenant-authored, so drawn VERBATIM. Undefined for the plain
   * round launcher.
   */
  launcherLabel?: string;

  /** The launcher's size; `medium` when the server does not say. */
  launcherSize: LauncherSize;
}

function nonEmpty(raw: Record<string, unknown>, key: string, fallback: string): string {
  const v = raw[key];
  return typeof v === 'string' && v.trim().length > 0 ? v : fallback;
}

function optionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function trimmedOrUndefined(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t;
}

export function parseWidgetConfig(raw: Record<string, unknown>): WidgetConfig {
  return {
    id: String(raw.id ?? ''),
    tenantId: String(raw.tenantId ?? ''),
    primaryColor: nonEmpty(raw, 'primaryColor', '#2563EB'),
    backgroundColor: nonEmpty(raw, 'backgroundColor', '#FFFFFF'),
    textColor: nonEmpty(raw, 'textColor', '#0F172A'),
    bubbleIconUrl: optionalString(raw.bubbleIconUrl),
    logoUrl: optionalString(raw.logoUrl),
    soundUrl: optionalString(raw.soundUrl),
    customCss: optionalString(raw.customCss),
    welcomeTitle: nonEmpty(raw, 'welcomeTitle', 'Chat with us'),
    welcomeSubtitle: nonEmpty(raw, 'welcomeSubtitle', "We're here to help"),
    offlineMessage: nonEmpty(raw, 'offlineMessage', "We're offline — leave a message"),
    offlineInfoText: trimmedOrUndefined(raw.offlineInfoText),
    defaultCustomerName: trimmedOrUndefined(raw.defaultCustomerName),
    position: nonEmpty(raw, 'position', 'bottom-right'),
    locale: nonEmpty(raw, 'locale', 'en'),
    direction: parseLocaleDirection(raw.direction),
    soundEnabled: raw.soundEnabled !== false,
    voiceNotesEnabled: raw.voiceNotesEnabled === true,
    showAgentAvatars: raw.showAgentAvatars !== false,
    showAgentNames: raw.showAgentNames !== false,
    collectEmailPreChat: raw.collectEmailPreChat === true,
    preChatForm:
      raw.preChatForm != null && typeof raw.preChatForm === 'object'
        ? parsePreChatForm(raw.preChatForm as Record<string, unknown>)
        : DISABLED_PRE_CHAT_FORM,
    postChatForm:
      raw.postChatForm != null && typeof raw.postChatForm === 'object'
        ? parsePostChatForm(raw.postChatForm as Record<string, unknown>)
        : DISABLED_POST_CHAT_FORM,
    allowedOrigins: Array.isArray(raw.allowedOrigins)
      ? raw.allowedOrigins.map((o) => String(o))
      : [],
    helpArticlesEnabled: raw.helpArticlesEnabled === true,
    colorScheme: parseColorScheme(raw.colorScheme),
    linkPreviews: raw.linkPreviews !== false,
    launcherLabel: cleanLauncherLabel(raw.launcherLabel),
    launcherSize: parseLauncherSize(raw.launcherSize),
  };
}

/**
 * The server's availability verdict for a workspace.
 *
 * Arrives two ways — in `GET /:slug/config` at open time, and on the
 * `workspace:availability` socket event when it changes — so it lives in one
 * place rather than being re-parsed (or, as it was, quietly dropped) in each.
 */
export interface WorkspaceAvailability {
  /** Inside working hours. */
  isOpen: boolean;
  /** Any agent currently accepting chats. */
  agentsAccepting: boolean;
  visitorMode: VisitorMode;
  reason: AvailabilityReason;
  /** When we next open, so the UI can say "back at 09:00". Null when open. */
  nextOpenAt: Date | null;
  /** The closure's name when `reason` is `HOLIDAY`, e.g. "Eid al-Adha". */
  closureLabel?: string;
  /**
   * `nextOpenAt` as `HH:mm` on the BUSINESS's clock, formatted by the server.
   *
   * Do NOT compute this on the device. The device can only render its own
   * timezone, which is the wrong answer for a visitor who is travelling or
   * abroad — and Hermes ships without full ICU by default, so
   * `Intl.DateTimeFormat` with a `timeZone` option is not reliably available
   * here anyway. The server knows the tenant's IANA zone and sends the string.
   */
  nextOpenLocal?: string;
  /** The tenant's configured IANA timezone, e.g. `Asia/Baghdad`. */
  timezone?: string;
  /**
   * Whether the workspace's AI assistant answers a message sent right now.
   *
   * When it does, "we're offline, leave a message" is untrue — someone replies
   * in seconds — so the closed and busy notices should say the assistant can
   * help in the meantime instead. Absent on older servers, which read as false.
   */
  assistantCovers: boolean;
}

function parseIsoDate(v: unknown): Date | null {
  if (typeof v !== 'string' || v.trim().length === 0) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms);
}

const VISITOR_MODES: readonly VisitorMode[] = ['CHAT', 'LEAVE_MESSAGE', 'NOTICE_ONLY'];
const AVAILABILITY_REASONS: readonly AvailabilityReason[] = [
  'OPEN',
  'AFTER_HOURS',
  'NO_AGENTS',
  'HOLIDAY',
];

/**
 * An unknown mode is treated as `CHAT` — the permissive default. A future
 * server value must never be read as closing the widget.
 */
function parseVisitorMode(v: unknown): VisitorMode {
  const s = String(v ?? 'CHAT').toUpperCase().trim();
  return (VISITOR_MODES as readonly string[]).includes(s) ? (s as VisitorMode) : 'CHAT';
}

function parseAvailabilityReason(v: unknown): AvailabilityReason {
  const s = String(v ?? 'OPEN').toUpperCase().trim();
  return (AVAILABILITY_REASONS as readonly string[]).includes(s)
    ? (s as AvailabilityReason)
    : 'OPEN';
}

/**
 * Every field is optional: a server that predates them must not be read as
 * closing the widget, so each absent value falls back to the permissive one —
 * hence `agentsAccepting !== false` rather than `=== true`.
 */
export function parseWorkspaceAvailability(raw: Record<string, unknown>): WorkspaceAvailability {
  return {
    isOpen: raw.isOpen === true,
    agentsAccepting: raw.agentsAccepting !== false,
    visitorMode: parseVisitorMode(raw.visitorMode),
    reason: parseAvailabilityReason(raw.reason),
    nextOpenAt: parseIsoDate(raw.nextOpenAt),
    closureLabel: trimmedOrUndefined(raw.closureLabel),
    nextOpenLocal: trimmedOrUndefined(raw.nextOpenLocal),
    timezone: trimmedOrUndefined(raw.timezone),
    assistantCovers: raw.assistantCovers === true,
  };
}

/** Envelope of `GET /:slug/config`. */
export interface ConfigResponse {
  tenantId: string;
  config: WidgetConfig;
  /** Working-hours availability at fetch time. */
  isOpen: boolean;
  /**
   * Whether any agent is currently accepting chats. Only gates the widget for
   * tenants running `chatAvailabilityMode = WHEN_ACCEPTING`.
   */
  agentsAccepting: boolean;
  /**
   * `ALWAYS` (default) or `WHEN_ACCEPTING` — whether `agentsAccepting` is
   * allowed to close the widget at all.
   */
  chatAvailabilityMode: string;
  /** Whether the offline/async form is offered when closed. */
  asyncEnabled: boolean;
  /**
   * What the visitor may do, decided server-side. Clients render this rather
   * than re-deriving the policy — three copies of that logic is how the
   * widget, this SDK and the server's own session gate came to disagree.
   */
  visitorMode: VisitorMode;
  reason: AvailabilityReason;
  nextOpenAt: Date | null;
  /**
   * The holiday/closure name when `reason` is `HOLIDAY`. Naming it reads far
   * better than a bare "we're closed".
   */
  closureLabel?: string;
  nextOpenLocal?: string;
  timezone?: string;
  /**
   * Whether the AI assistant answers a message sent right now. See
   * {@link WorkspaceAvailability.assistantCovers}.
   */
  assistantCovers: boolean;
  /**
   * The workspace offers "Email me this chat" — see
   * `EasyLiveChat.emailTranscript`. Absent on an older server: not offered.
   */
  transcriptEmailEnabled: boolean;
  /**
   * The workspace offers "Get the reply by email" — see
   * `EasyLiveChat.setVisitorEmail`: ask for an address while nobody can
   * answer. Absent on an older server: not offered.
   */
  replyEmailEnabled: boolean;
}

/** True when the tenant chose to show a notice and take nothing. */
export function isNoticeOnly(res: Pick<ConfigResponse, 'visitorMode'>): boolean {
  return res.visitorMode === 'NOTICE_ONLY';
}

/**
 * True when either availability gate says the workspace is unavailable.
 * Mirrors the web widget's rule so both clients agree.
 */
export function isWorkspaceClosed(args: {
  isOpen: boolean;
  chatAvailabilityMode: string;
  agentsAccepting: boolean;
  asyncEnabled: boolean;
}): boolean {
  if (!args.isOpen) return true;
  return (
    args.chatAvailabilityMode === 'WHEN_ACCEPTING' && !args.agentsAccepting && args.asyncEnabled
  );
}

export function parseConfigResponse(raw: Record<string, unknown>): ConfigResponse {
  const rawConfig = raw.config;
  // The one non-optional field in the protocol. Everywhere else is
  // null-tolerant; here a missing/mistyped `config` is a protocol violation —
  // surface a typed error instead of letting a cast produce `undefined` deeper
  // in.
  if (rawConfig == null || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    throw new EasyLiveChatError(EasyLiveChatErrorCode.UNKNOWN, {
      message: 'GET /config response missing a `config` object.',
    });
  }
  return {
    tenantId: String(raw.tenantId ?? ''),
    config: parseWidgetConfig(rawConfig as Record<string, unknown>),
    isOpen: raw.isOpen === true,
    // Absent on older servers — default to the permissive value so a missing
    // field can never close the widget.
    agentsAccepting: raw.agentsAccepting !== false,
    chatAvailabilityMode: String(raw.chatAvailabilityMode ?? 'ALWAYS'),
    asyncEnabled: raw.asyncEnabled === true,
    // Defaulting these to the permissive values on an older server is
    // deliberate; silently defaulting them while a CURRENT server was sending
    // NOTICE_ONLY is what left the widget offering a pre-chat form to visitors
    // it had already been told to turn away.
    visitorMode: parseVisitorMode(raw.visitorMode),
    reason: parseAvailabilityReason(raw.reason),
    nextOpenAt: parseIsoDate(raw.nextOpenAt),
    closureLabel: trimmedOrUndefined(raw.closureLabel),
    nextOpenLocal: trimmedOrUndefined(raw.nextOpenLocal),
    timezone: trimmedOrUndefined(raw.timezone),
    // Absent on a server that predates the assistant: false, so nothing claims
    // an answer is coming that nobody will send.
    assistantCovers: raw.assistantCovers === true,
    transcriptEmailEnabled: raw.transcriptEmailEnabled === true,
    replyEmailEnabled: raw.replyEmailEnabled === true,
  };
}

/**
 * Fill visitor variables into tenant-authored copy.
 *
 * Mirrors `substituteVisitorVariables` on the server, which resolves the same
 * tokens for text it PERSISTS (the auto-greeting). Copy the server hands over
 * unresolved — welcome title, offline notice — is resolved here instead,
 * because at the moment `GET /config` is served nobody knows who is asking.
 *
 * Both syntaxes are accepted, matching the server: this codebase shipped
 * `%number%` in queue text and `{{name}}` in canned responses, and a tenant
 * should not have to remember which surface takes which.
 *
 * An unknown name falls back to `defaultName`, then to the empty string —
 * never to a literal `%name%` on screen.
 */
export function substituteVisitorVariables(
  template: string,
  vars: { name?: string | null; defaultName?: string | null } = {},
): string {
  const named = vars.name?.trim() ?? '';
  const resolved = named.length > 0 ? named : (vars.defaultName?.trim() ?? '');
  const first = resolved.length === 0 ? '' : (resolved.split(/\s+/)[0] ?? '');
  return template.replace(
    /%(name|first_name)%|\{\{\s*(name|first_name)\s*\}\}/gi,
    (_match, pct: string | undefined, mustache: string | undefined) =>
      (pct ?? mustache ?? '').toLowerCase() === 'first_name' ? first : resolved,
  );
}
