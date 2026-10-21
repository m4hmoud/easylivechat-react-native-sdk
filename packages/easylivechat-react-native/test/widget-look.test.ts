import { describe, expect, it } from 'vitest';

import {
  LAUNCHER_PX,
  parseColorScheme,
  parseConfigResponse,
  parseWidgetConfig,
  resolveColorScheme,
} from '../src/models/widget-config';
import { configBody } from './fake-server';

/**
 * The widget's look as Widget settings leaves it (C2): light, dark or
 * following the device; previews under links; the launcher's size and words.
 * Every one is absent on an older server, and must read as what that server's
 * widgets always were.
 */
describe('colorScheme', () => {
  it('reads the workspace’s choice', () => {
    expect(parseWidgetConfig({ colorScheme: 'dark' }).colorScheme).toBe('dark');
    expect(parseWidgetConfig({ colorScheme: 'auto' }).colorScheme).toBe('auto');
    expect(parseWidgetConfig({ colorScheme: 'light' }).colorScheme).toBe('light');
  });

  it('is light when the server says nothing, or something it does not know', () => {
    // Existing widgets were kept light; a missing field never changes a look.
    expect(parseWidgetConfig({}).colorScheme).toBe('light');
    expect(parseColorScheme('sepia')).toBe('light');
    expect(parseColorScheme(null)).toBe('light');
  });

  it('follows the device only for auto', () => {
    expect(resolveColorScheme('auto', true)).toBe('dark');
    expect(resolveColorScheme('auto', false)).toBe('light');
    expect(resolveColorScheme('light', true)).toBe('light');
    expect(resolveColorScheme('dark', false)).toBe('dark');
  });
});

describe('linkPreviews', () => {
  it('is on unless the workspace turned it off', () => {
    expect(parseWidgetConfig({}).linkPreviews).toBe(true);
    expect(parseWidgetConfig({ linkPreviews: true }).linkPreviews).toBe(true);
    expect(parseWidgetConfig({ linkPreviews: false }).linkPreviews).toBe(false);
  });
});

describe('the launcher', () => {
  it('reads its size, medium when unknown', () => {
    expect(parseWidgetConfig({ launcherSize: 'small' }).launcherSize).toBe('small');
    expect(parseWidgetConfig({ launcherSize: 'large' }).launcherSize).toBe('large');
    expect(parseWidgetConfig({}).launcherSize).toBe('medium');
    expect(parseWidgetConfig({ launcherSize: 'huge' }).launcherSize).toBe('medium');
    expect(LAUNCHER_PX).toEqual({ small: 48, medium: 56, large: 64 });
  });

  it('reads its words on one line, capped at forty, none when blank', () => {
    expect(parseWidgetConfig({ launcherLabel: '  Chat\n with   us ' }).launcherLabel).toBe('Chat with us');
    expect(parseWidgetConfig({ launcherLabel: '   ' }).launcherLabel).toBeUndefined();
    expect(parseWidgetConfig({ launcherLabel: null }).launcherLabel).toBeUndefined();
    expect(Array.from(parseWidgetConfig({ launcherLabel: 'گ'.repeat(60) }).launcherLabel ?? '')).toHaveLength(40);
  });
});

describe('transcriptEmailEnabled', () => {
  it('is offered only when the server says so', () => {
    expect(parseConfigResponse(configBody()).transcriptEmailEnabled).toBe(false);
    expect(parseConfigResponse(configBody({ transcriptEmailEnabled: true })).transcriptEmailEnabled).toBe(true);
  });
});
