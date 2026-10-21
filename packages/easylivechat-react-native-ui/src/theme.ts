import { type WidgetConfig, resolveColorScheme } from '@easylivechat/react-native';

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
  /**
   * Which appearance these colours are for. {@link themeFromConfig} always
   * sets it — from the workspace's `colorScheme` and the device — and a host
   * override may pin it. Undefined on a hand-built theme, which reads as
   * light. Decides what only the scheme can: the keyboard's appearance.
   */
  scheme?: 'light' | 'dark';
  /**
   * The brand as INK — links, outlined chips, the read ticks, icons on a
   * surface — where {@link primary} is the brand as a FILL. The same colour in
   * light; in dark nudged lighter until it reads on the dark surface, the way
   * the web widget's `--widget-accent-ink` is. Read it with {@link inkOf}.
   */
  primaryInk?: string;
}

/** What the UI paints before the server config has arrived. */
export const FALLBACK_THEME: EasyLiveChatTheme = {
  primary: '#2563EB',
  background: '#FFFFFF',
  surface: '#F1F5F9',
  text: '#0F172A',
  direction: 'ltr',
  scheme: 'light',
};

/** Destructive red, shared by validation, failed sends and error banners. */
export const ERROR_COLOR = '#DC2626';

/** The same red on a dark chat — the web widget's dark `--color-danger`, which reads there. */
export const ERROR_COLOR_DARK = '#F87171';

/** The destructive red for this theme. */
export function errorColorOf(theme: Pick<EasyLiveChatTheme, 'scheme'> | null | undefined): string {
  return theme?.scheme === 'dark' ? ERROR_COLOR_DARK : ERROR_COLOR;
}

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

// ── colour maths for dark (packages/shared widget-theme.ts) ─────────────────

/** `a` moved `t` (0…1) of the way toward `b`, in sRGB. Unparseable input returns `a` as given. */
export function mixColors(a: string, b: string, t: number): string {
  const x = parseHexColor(a);
  const y = parseHexColor(b);
  if (x == null || y == null) return a;
  const mix = (p: number, q: number): number => Math.round(Math.min(255, Math.max(0, p + (q - p) * t)));
  return toCss({ r: mix(x.r, y.r), g: mix(x.g, y.g), b: mix(x.b, y.b), a: 1 });
}

/** WCAG contrast ratio, 1…21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * `color` itself when it already reads at `ratio` against `ground`; otherwise
 * the least step toward white (on a dark ground) or near-black (on a light
 * one) that does. A brand blue that reads stays exactly the brand blue.
 */
export function inkOn(color: string, ground: string, ratio: number): string {
  if (parseHexColor(color) == null || parseHexColor(ground) == null) return color;
  if (contrastRatio(color, ground) >= ratio) return color;
  const toward = luminance(ground) > 0.5 ? '#111827' : '#FFFFFF';
  for (let step = 1; step <= 20; step++) {
    const next = mixColors(color, toward, step / 20);
    if (contrastRatio(next, ground) >= ratio) return next;
  }
  return toward;
}

/**
 * The iOS keyboard for a field on this theme: dark on a dark chat. A light
 * chat leaves it to the system, as it always did.
 */
export function keyboardAppearance(theme: EasyLiveChatTheme): 'dark' | 'default' {
  return theme.scheme === 'dark' ? 'dark' : 'default';
}

/** The brand as ink — {@link EasyLiveChatTheme.primaryInk}, or the brand itself on a hand-built theme. */
export function inkOf(theme: EasyLiveChatTheme): string {
  return theme.primaryInk ?? theme.primary;
}

/** The web widget's own dark ground and card, before the brand tint, and its text. */
const DARK_GROUND = '#121316';
const DARK_CARD = '#1E1F23';
const DARK_TEXT = '#ECEDEF';
/** How far the dark surfaces lean toward the brand: enough to feel theirs, not enough to colour the text. */
const BRAND_TINT = 0.05;
/** A background a tenant has already made dark is their dark theme: kept, not replaced. */
const DARK_THEME_LUMINANCE = 0.2;

/**
 * Build a theme from the server config.
 *
 * LIGHT is the look the SDK has always drawn — the tenant's own colours —
 * whatever the workspace's `colorScheme` says, so a workspace still on
 * `light` (every one that existed before dark mode) sees no change at all.
 *
 * DARK is DERIVED from the same colours, never asked for twice, exactly as
 * the web widget derives it (`widgetPalette`, packages/shared
 * widget-theme.ts): the brand stays where a visitor sees it — the launcher,
 * the visitor's bubble, the send button — and the light surfaces become the
 * widget's own dark ground and card, tinted a little toward the brand. Text
 * becomes light unless the tenant's own reads at 7:1 on the card. A workspace
 * whose own background is already dark designed a dark widget: its colours
 * are kept. Where the brand is INK (links, outlined chips) it is nudged
 * lighter until it reads at 4.5:1 — {@link EasyLiveChatTheme.primaryInk}.
 *
 * Which one: the workspace's `colorScheme` — `auto` follows `deviceScheme`
 * (React Native's `useColorScheme()`; `useEasyLiveChatTheme` passes it) —
 * unless the host's override says. A host's explicit theme still wins:
 * `override.scheme` pins the scheme, and an override that paints the surfaces
 * itself (`background`, `surface` or `text`) is taken at its word — its
 * scheme is read off its own colours, so the gaps are filled from the same
 * one rather than a dark card under a host's white page. Every colour on the
 * override wins as before.
 *
 * `direction` is deliberately NOT taken from the override: layout direction is
 * a function of locale and content, not branding, and always follows the
 * server/locale-resolved config. Otherwise a colours-only override (whose
 * `direction` would default to LTR) silently forces an RTL workspace to LTR.
 * Hosts that genuinely need to force it get an explicit `directionOverride`
 * prop on the screen and the launcher.
 *
 * Before the config arrives the fallback is light: almost every workspace is,
 * and the spinner it covers is up for a moment.
 */
export function themeFromConfig(
  config: WidgetConfig | null,
  override?: Partial<EasyLiveChatTheme>,
  deviceScheme?: string | null,
): EasyLiveChatTheme {
  const pinned = hostScheme(override);
  if (config == null) {
    const scheme = pinned ?? 'light';
    return finish(
      {
        ...FALLBACK_THEME,
        ...(scheme === 'dark' ? darkSurfaces(FALLBACK_THEME.primary, null, null) : {}),
        ...stripLayout(override),
        // Even with no config, an override's direction is not authoritative —
        // same rule as below.
        direction: FALLBACK_THEME.direction,
        scheme,
      },
      override,
    );
  }
  const scheme =
    pinned ?? resolveColorScheme(config.colorScheme, deviceScheme === 'dark');
  const primary = normalizeColor(config.primaryColor, FALLBACK_THEME.primary);
  const background = normalizeColor(config.backgroundColor, FALLBACK_THEME.background);
  const text = normalizeColor(config.textColor, FALLBACK_THEME.text);
  const base: EasyLiveChatTheme = {
    primary,
    background,
    surface: deriveSurface(background),
    text,
    direction: config.direction === 'rtl' ? 'rtl' : 'ltr',
    logoUrl: config.logoUrl,
    bubbleIconUrl: config.bubbleIconUrl,
    scheme,
    ...(scheme === 'dark' ? darkSurfaces(primary, background, text) : {}),
  };
  if (override == null) return finish(base, undefined);
  return finish(
    {
      ...base,
      ...stripLayout(override),
      logoUrl: override.logoUrl ?? base.logoUrl,
      bubbleIconUrl: override.bubbleIconUrl ?? base.bubbleIconUrl,
      direction: base.direction,
      scheme,
    },
    override,
  );
}

/**
 * The dark ground, card and text for a tenant's colours. `own*` null means
 * "no tenant colour" (before the config arrives).
 */
function darkSurfaces(
  primary: string,
  ownBackground: string | null,
  ownText: string | null,
): Pick<EasyLiveChatTheme, 'background' | 'surface' | 'text'> {
  const tenantDark =
    ownBackground != null &&
    parseHexColor(ownBackground) != null &&
    luminance(ownBackground) < DARK_THEME_LUMINANCE;
  const background = tenantDark ? ownBackground : mixColors(DARK_GROUND, primary, BRAND_TINT);
  const surface = tenantDark ? deriveSurface(ownBackground) : mixColors(DARK_CARD, primary, BRAND_TINT);
  const text =
    ownText != null && parseHexColor(ownText) != null && contrastRatio(ownText, surface) >= 7
      ? ownText
      : DARK_TEXT;
  return { background, surface, text };
}

/** The ink, worked out from the colours as they finally stand — host overrides included. */
function finish(
  theme: EasyLiveChatTheme,
  override: Partial<EasyLiveChatTheme> | undefined,
): EasyLiveChatTheme {
  const primaryInk =
    override?.primaryInk ??
    (theme.scheme === 'dark' ? inkOn(theme.primary, theme.surface, 4.5) : theme.primary);
  return { ...theme, primaryInk };
}

/**
 * The scheme a host override decides: its own `scheme`, else the one its own
 * surface colours are for. Undefined when it says nothing about surfaces — a
 * brand colour alone leaves the scheme to the workspace and the device.
 */
function hostScheme(override: Partial<EasyLiveChatTheme> | undefined): 'light' | 'dark' | undefined {
  if (override == null) return undefined;
  if (override.scheme === 'light' || override.scheme === 'dark') return override.scheme;
  const ground = [override.background, override.surface].find((c) => parseHexColor(c) != null);
  if (ground != null) return luminance(ground) < 0.5 ? 'dark' : 'light';
  if (parseHexColor(override.text) != null) return luminance(override.text!) > 0.5 ? 'dark' : 'light';
  return undefined;
}

function stripLayout(
  override: Partial<EasyLiveChatTheme> | undefined,
): Partial<EasyLiveChatTheme> {
  if (override == null) return {};
  const { direction: _ignored, scheme: _scheme, primaryInk: _ink, ...rest } = override;
  return rest;
}
