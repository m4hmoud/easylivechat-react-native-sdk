import { parseChatMessage } from '@easylivechat/react-native';
import { describe, expect, it } from 'vitest';

import { shouldChime } from '../src/chime';
import { formatRecordDuration } from '../src/views/composer-bar';
import {
  deriveSurface,
  FALLBACK_THEME,
  luminance,
  normalizeColor,
  onColor,
  parseHexColor,
  themeFromConfig,
  withAlpha,
} from '../src/theme';
import { parseWidgetConfig } from '@easylivechat/react-native';

/** Port of `chime_test.dart`. */
describe('shouldChime', () => {
  const message = (senderType: string) =>
    parseChatMessage({ id: 'm', conversationId: 'c', senderType, createdAt: '2026-09-01T10:00:00Z' });

  it('rings ONLY for an agent', () => {
    // Not the visitor's own echoes, not bot greetings, not SYSTEM transfer
    // notices — matching the web widget exactly.
    expect(shouldChime(message('AGENT'), { soundEnabled: true })).toBe(true);
    expect(shouldChime(message('CUSTOMER'), { soundEnabled: true })).toBe(false);
    expect(shouldChime(message('BOT'), { soundEnabled: true })).toBe(false);
    expect(shouldChime(message('SYSTEM'), { soundEnabled: true })).toBe(false);
    expect(shouldChime(message('SOMETHING_NEW'), { soundEnabled: true })).toBe(false);
  });

  it('honours the workspace sound switch', () => {
    expect(shouldChime(message('AGENT'), { soundEnabled: false })).toBe(false);
  });
});

describe('colour parsing', () => {
  it('accepts every CSS hex shape the dashboard can produce', () => {
    expect(parseHexColor('#FFF')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseHexColor('2563EB')).toEqual({ r: 0x25, g: 0x63, b: 0xeb, a: 1 });
    expect(parseHexColor('#2563EB')).toEqual({ r: 0x25, g: 0x63, b: 0xeb, a: 1 });
    // #AARRGGBB — alpha FIRST, matching the dashboard picker, not CSS order.
    expect(parseHexColor('#802563EB')?.a).toBeCloseTo(0x80 / 255, 3);
  });

  it('NEVER throws on garbage — theming must not crash the UI', () => {
    for (const bad of ['', '   ', '#', 'rebeccapurple', '#12', '#GGGGGG', 'rgb(1,2,3)']) {
      expect(parseHexColor(bad)).toBeNull();
    }
    expect(normalizeColor('nonsense', '#2563EB')).toBe('#2563EB');
    expect(normalizeColor(undefined, '#2563EB')).toBe('#2563EB');
  });

  it('derives a surface a hair off the background, in the right direction', () => {
    // Light backgrounds go darker, dark ones go lighter, so a raised layer
    // stays legible either way.
    const light = parseHexColor(deriveSurface('#FFFFFF'))!;
    expect(light.r).toBeLessThan(255);
    const dark = parseHexColor(deriveSurface('#000000'))!;
    expect(dark.r).toBeGreaterThan(0);
    // Unparseable input still yields a usable surface.
    expect(deriveSurface('nonsense')).toBe(FALLBACK_THEME.surface);
  });

  it('picks a readable foreground', () => {
    expect(onColor('#FFFFFF')).toBe('#0F172A');
    expect(onColor('#000000')).toBe('#FFFFFF');
    expect(onColor('#2563EB')).toBe('#FFFFFF');
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 2);
    expect(luminance('#000000')).toBeCloseTo(0, 2);
  });

  it('re-tints at a new alpha', () => {
    expect(withAlpha('#0F172A', 0.5)).toBe('rgba(15, 23, 42, 0.5)');
    expect(withAlpha('rgba(1, 2, 3, 1)', 0.2)).toBe('rgba(1, 2, 3, 0.2)');
  });
});

describe('themeFromConfig', () => {
  const rtlConfig = parseWidgetConfig({
    id: 'w',
    tenantId: 't',
    primaryColor: '#111111',
    backgroundColor: '#222222',
    textColor: '#333333',
    direction: 'rtl',
    logoUrl: '/uploads/logo.png',
  });

  it('takes colours from the server and lets an override win', () => {
    const base = themeFromConfig(rtlConfig);
    expect(base.primary).toBe('#111111');
    expect(base.background).toBe('#222222');
    expect(base.text).toBe('#333333');

    const overridden = themeFromConfig(rtlConfig, { primary: '#ABCDEF' });
    expect(overridden.primary).toBe('#ABCDEF');
    expect(overridden.background).toBe('#222222');
  });

  it('NEVER takes `direction` from the override', () => {
    // Layout direction is a function of locale and content, not branding.
    // A colours-only override (whose `direction` defaults to LTR) would
    // otherwise silently force an RTL workspace to LTR.
    expect(themeFromConfig(rtlConfig, { primary: '#ABCDEF' }).direction).toBe('rtl');
    expect(themeFromConfig(rtlConfig, { direction: 'ltr' }).direction).toBe('rtl');
  });

  it('paints the fallback theme before the config arrives', () => {
    const t = themeFromConfig(null);
    expect(t.primary).toBe(FALLBACK_THEME.primary);
    expect(t.direction).toBe('ltr');
    expect(themeFromConfig(null, { primary: '#ABCDEF' }).primary).toBe('#ABCDEF');
  });

  it('carries the tenant logo and bubble icon through', () => {
    expect(themeFromConfig(rtlConfig).logoUrl).toBe('/uploads/logo.png');
    expect(themeFromConfig(rtlConfig, { logoUrl: '/x.png' }).logoUrl).toBe('/x.png');
  });
});

describe('formatRecordDuration', () => {
  it('is m:ss — voice messages are short, so no hours component', () => {
    expect(formatRecordDuration(0)).toBe('0:00');
    expect(formatRecordDuration(9)).toBe('0:09');
    expect(formatRecordDuration(65)).toBe('1:05');
    expect(formatRecordDuration(300)).toBe('5:00');
    expect(formatRecordDuration(-5)).toBe('0:00');
  });
});
