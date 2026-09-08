import { EasyLiveChatError, EasyLiveChatErrorCode } from './errors';

/** Immutable configuration for the EasyLiveChat client. */
export interface EasyLiveChatConfig {
  /** API base, e.g. `https://api.livechattools.com` (a trailing slash is stripped). */
  apiBase: string;

  /**
   * Tenant/workspace slug. Resolves `:slug` on widget endpoints and the
   * `tenantSlug` on heartbeat/presence.
   */
  tenantSlug: string;

  /**
   * The locale sent to the server and shown to agents. Free-form.
   *
   * Hosts often put a readable language NAME here because that is what agents
   * see in the dashboard. That is safe — the server stores a locale CODE on
   * the contact and takes it from {@link contentLocale}, keeping an
   * unrecognised value for the agent to read rather than treating it as the
   * customer's language.
   */
  locale?: string;

  /**
   * Language code (`en`, `ar`, `ckb`, `kmr`…) the tenant's customer-facing
   * copy should come back in — welcome text, offline message, pre-chat labels,
   * auto-greeting.
   *
   * Separate from {@link locale} precisely because that one is a display value
   * the server cannot match against, so without this every mobile visitor got
   * the workspace's default language however well the tenant had translated
   * it. Unknown codes fall back to that default server-side.
   */
  contentLocale?: string;

  /**
   * Channel/inbox key (e.g. `'rider'`, `'driver'`). Routes the conversation to
   * that inbox in the dashboard, AND selects the per-channel overrides the
   * server applies to the config. Omit for the workspace's `default` channel.
   */
  channel?: string;

  /**
   * Arbitrary client-provided attributes (device/app info like OS, model, app
   * version). Sent verbatim on session start; the server stores them on the
   * contact and shows them in the dashboard. NOT validated/filtered like
   * pre-chat form fields.
   */
  attributes?: Record<string, string>;

  /**
   * Optional `?origin=` value for `GET /:slug/config`. Native clients should
   * usually OMIT this — the server's `allowedOrigins` gate is skipped entirely
   * when no origin is supplied. Only set it if the tenant requires a match.
   */
  originHeader?: string;

  /**
   * Open the receive-only `/widget-presence` socket before a chat session
   * exists (for proactive outreach). Default true, matching web behavior.
   */
  enablePresenceSocket?: boolean;

  /**
   * Send periodic `POST /visitor/heartbeat` while the app is foregrounded.
   *
   * NOTE: a heartbeat can trigger an agent-side "new visitor" notification on
   * first arrival / re-arrival after idle — keep the interval modest and only
   * run it while foregrounded.
   */
  enableHeartbeat?: boolean;

  /** Heartbeat cadence in ms (default 30_000). Only sent while foregrounded. */
  heartbeatIntervalMs?: number;

  /** HTTP/socket connect timeout in ms (default 20_000). */
  connectTimeoutMs?: number;

  /**
   * Re-mint the widget JWT this long (ms) before its `exp`. The protocol has
   * no refresh route, so re-mint means `POST /session { resumeOnly: true }`.
   */
  tokenRefreshLeewayMs?: number;
}

/** Every optional field of {@link EasyLiveChatConfig}, filled in. */
export interface ResolvedConfig extends EasyLiveChatConfig {
  enablePresenceSocket: boolean;
  enableHeartbeat: boolean;
  heartbeatIntervalMs: number;
  connectTimeoutMs: number;
  tokenRefreshLeewayMs: number;
  /** `apiBase` with any trailing slash removed. */
  normalizedApiBase: string;
}

export const CONFIG_DEFAULTS = {
  enablePresenceSocket: true,
  enableHeartbeat: true,
  heartbeatIntervalMs: 30_000,
  connectTimeoutMs: 20_000,
  tokenRefreshLeewayMs: 60_000,
} as const;

/** `apiBase` with any trailing slash removed. */
export function normalizeApiBase(apiBase: string): string {
  return apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
}

/**
 * Validate the config at boot. Throws an {@link EasyLiveChatError} for a
 * misconfiguration that would otherwise fail opaquely deep in the transport.
 *
 * `http://` is allowed (local/staging) but disables TLS for the visitor JWT
 * and PII — not blocked, not encouraged.
 */
export function validateConfig(config: EasyLiveChatConfig): void {
  if (config.apiBase == null || config.apiBase.trim().length === 0) {
    throw new EasyLiveChatError(EasyLiveChatErrorCode.UNKNOWN, {
      message: 'EasyLiveChatConfig.apiBase must not be empty.',
    });
  }
  if (!config.apiBase.startsWith('https://') && !config.apiBase.startsWith('http://')) {
    throw new EasyLiveChatError(EasyLiveChatErrorCode.UNKNOWN, {
      message:
        'EasyLiveChatConfig.apiBase must include an http(s):// scheme, ' +
        `e.g. https://api.example.com (got "${config.apiBase}").`,
    });
  }
  if (config.tenantSlug == null || config.tenantSlug.trim().length === 0) {
    throw new EasyLiveChatError(EasyLiveChatErrorCode.UNKNOWN, {
      message: 'EasyLiveChatConfig.tenantSlug must not be empty.',
    });
  }
}

/** Validate, then fill in the defaults. */
export function resolveConfig(config: EasyLiveChatConfig): ResolvedConfig {
  validateConfig(config);
  return {
    ...config,
    enablePresenceSocket: config.enablePresenceSocket ?? CONFIG_DEFAULTS.enablePresenceSocket,
    enableHeartbeat: config.enableHeartbeat ?? CONFIG_DEFAULTS.enableHeartbeat,
    heartbeatIntervalMs: config.heartbeatIntervalMs ?? CONFIG_DEFAULTS.heartbeatIntervalMs,
    connectTimeoutMs: config.connectTimeoutMs ?? CONFIG_DEFAULTS.connectTimeoutMs,
    tokenRefreshLeewayMs: config.tokenRefreshLeewayMs ?? CONFIG_DEFAULTS.tokenRefreshLeewayMs,
    normalizedApiBase: normalizeApiBase(config.apiBase),
  };
}
