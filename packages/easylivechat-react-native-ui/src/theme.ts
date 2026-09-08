import type { WidgetConfig } from '@easylivechat/react-native';

/**
 * Resolved theme for the EasyLiveChat UI.
 *
 * All values originate from the server-driven {@link WidgetConfig} — the
 * native analog of the web CSS vars `--widget-accent/--widget-bg/--widget-text`.
 * Hosts may pass a partial override; any field present on the override wins.
 *
 * `customCss` is intentionally not represented: raw CSS cannot map to React
 * Native styles and is a documented no-op. Hosts customize via the override.
 */
export interface EasyLiveChatTheme {
  /** Accent — send button, launcher bubble, active controls. */
  primary: string;
  /** Page / screen background. */
  background: string;
  /** Raised surfaces (message bubbles, composer, sheets). */
  surface: string;
  /** Body / foreground text. */
  text: string;
  /** Layout direction for the chat subtree. */
  direction: 'ltr' | 'rtl';
  /** Optional header logo (absolute URL, served by the tenant). */
  logoUrl?: string;
  /** Optional launcher-bubble icon (absolute URL); falls back to a chat glyph. */
  bubbleIconUrl?: string;
}

/** What the UI paints before the server config has arrived. */
export const FALLBACK_THEME: EasyLiveChatTheme = {
  primary: '#2563EB',
  background: '#FFFFFF',
  surface: '#F1F5F9',
  text: '#0F172A',
  direction: 'ltr',
};

/** Destructive red, shared by validation, failed sends and error banners. */
export const ERROR_COLOR = '#DC2626';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Parse a CSS-style hex string (`#RGB`, `#RRGGBB`, `#AARRGGBB`, with or
 * without the leading `#`) into channels.
 *
 * Returns null on any malformed input — callers fall back rather than throw.
 * THEMING MUST NEVER CRASH THE UI: a tenant can type anything into that field.
 */
export function parseHexColor(hex: string | null | undefined): Rgba | null {
  if (hex == null) return null;
  let h = hex.trim();
  if (h.length === 0) return null;
  if (h.startsWith('#')) h = h.slice(1);
  // Expand shorthand #RGB → #RRGGBB.
  if (h.length === 3) h = h.split('').map((c) => `${c}${c}`).join('');
  // The server's format is #AARRGGBB (alpha FIRST), matching the dashboard's
  // colour picker — not the CSS #RRGGBBAA order.
  if (h.length === 6) h = `FF${h}`;
  if (h.length !== 8) return null;
  if (!/^[0-9a-fA-F]{8}$/.test(h)) return null;
  const value = Number.parseInt(h, 16);
  return {
    a: ((value >>> 24) & 0xff) / 255,
    r: (value >>> 16) & 0xff,
    g: (value >>> 8) & 0xff,
    b: value & 0xff,
  };
}

function toCss({ r, g, b, a }: Rgba): string {
  return a >= 1
    ? `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
    : `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

/** Normalize a tenant colour, falling back when it cannot be parsed. */
export function normalizeColor(hex: string | null | undefined, fallback: string): string {
  const parsed = parseHexColor(hex);
  return parsed == null ? fallback : toCss(parsed);
}

/**
 * The same colour at a different opacity — the RN equivalent of Flutter's
 * `withValues(alpha:)`, used everywhere the UI needs a muted variant of the
 * theme's text colour.
 */
export function withAlpha(color: string, alpha: number): string {
  const parsed = parseHexColor(color);
  if (parsed == null) {
    // Already an rgb()/rgba()/named colour — re-tint what we can read.
    const m = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
    if (m?.[1] != null) {
      const parts = m[1].split(',').map((p) => p.trim());
      const [r, g, b] = parts;
      if (r != null && g != null && b != null) return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
  }
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${Number((parsed.a * alpha).toFixed(3))})`;
}

/** Relative luminance (sRGB, gamma-corrected), for on-colour decisions. */
export function luminance(color: string): number {
  const parsed = parseHexColor(color) ?? { r: 0, g: 0, b: 0, a: 1 };
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(parsed.r) + 0.7152 * channel(parsed.g) + 0.0722 * channel(parsed.b);
}

/** Readable foreground for a filled surface: near-black on light, white on dark. */
export function onColor(background: string): string {
  return luminance(background) > 0.5 ? '#0F172A' : '#FFFFFF';
}

/**
 * Pick a surface tint a hair off the background.
 *
 * The server has no dedicated `surface` colour, so it is derived: nudge dark
 * backgrounds lighter and light backgrounds darker (~5%) so bubbles and the
 * composer read as a subtle raised layer rather than melting into the page.
 */
export function deriveSurface(background: string): string {
  const parsed = parseHexColor(background);
  if (parsed == null) return FALLBACK_THEME.surface;
  const lighten = luminance(background) < 0.5;
  const delta = 0x0d;
  const shift = (c: number): number => Math.min(255, Math.max(0, lighten ? c + delta : c - delta));
  return toCss({ r: shift(parsed.r), g: shift(parsed.g), b: shift(parsed.b), a: parsed.a });
}

/**
 * Build a theme from the server config.
 *
 * `direction` is deliberately NOT taken from the override: layout direction is
 * a function of locale and content, not branding, and always follows the
 * server/locale-resolved config. Otherwise a colours-only override (whose
 * `direction` would default to LTR) silently forces an RTL workspace to LTR.
 * Hosts that genuinely need to force it get an explicit `directionOverride`
 * prop on the screen and the launcher.
 */
export function themeFromConfig(
  config: WidgetConfig | null,
  override?: Partial<EasyLiveChatTheme>,
): EasyLiveChatTheme {
  if (config == null) {
    return {
      ...FALLBACK_THEME,
      ...stripDirection(override),
      // Even with no config, an override's direction is not authoritative —
      // same rule as below.
      direction: FALLBACK_THEME.direction,
    };
  }
  const background = normalizeColor(config.backgroundColor, FALLBACK_THEME.background);
  const base: EasyLiveChatTheme = {
    primary: normalizeColor(config.primaryColor, FALLBACK_THEME.primary),
    background,
    surface: deriveSurface(background),
    text: normalizeColor(config.textColor, FALLBACK_THEME.text),
    direction: config.direction === 'rtl' ? 'rtl' : 'ltr',
    logoUrl: config.logoUrl,
    bubbleIconUrl: config.bubbleIconUrl,
  };
  if (override == null) return base;
  return {
    ...base,
    ...stripDirection(override),
    logoUrl: override.logoUrl ?? base.logoUrl,
    bubbleIconUrl: override.bubbleIconUrl ?? base.bubbleIconUrl,
    direction: base.direction,
  };
}

function stripDirection(
  override: Partial<EasyLiveChatTheme> | undefined,
): Partial<EasyLiveChatTheme> {
  if (override == null) return {};
  const { direction: _ignored, ...rest } = override;
  return rest;
}
