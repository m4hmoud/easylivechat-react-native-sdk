import { describe, expect, it } from 'vitest';

import { EasyLiveChatError } from '../src/errors';
import {
  isWorkspaceClosed,
  parseConfigResponse,
  parseWorkspaceAvailability,
} from '../src/models/widget-config';
import { configBody } from './fake-server';

/**
 * Port of `availability_parsing_test.dart`.
 *
 * PERMISSIVE DEFAULTS. Every field except `config` is optional, and an older
 * server that omits `agentsAccepting`, `visitorMode` or `reason` must NEVER be
 * read as closing the widget.
 */
describe('config response parsing', () => {
  it('defaults every optional availability field permissively', () => {
    const res = parseConfigResponse({
      tenantId: 't1',
      isOpen: true,
      config: (configBody().config as Record<string, unknown>),
    });
    // `!== false`, not `=== true`: absent must not close the widget.
    expect(res.agentsAccepting).toBe(true);
    expect(res.visitorMode).toBe('CHAT');
    expect(res.reason).toBe('OPEN');
    expect(res.chatAvailabilityMode).toBe('ALWAYS');
    expect(res.asyncEnabled).toBe(false);
    expect(res.nextOpenAt).toBeNull();
    expect(res.closureLabel).toBeUndefined();
  });

  it('reads agentsAccepting: false as a real answer', () => {
    const res = parseConfigResponse(configBody({ agentsAccepting: false }));
    expect(res.agentsAccepting).toBe(false);
  });

  it('carries the server-formatted nextOpenLocal through untouched', () => {
    // The device can only render its own timezone, which is the wrong answer
    // for a visitor travelling or abroad — and Hermes has no full ICU. The
    // server knows the tenant's IANA zone and sends the string.
    const res = parseConfigResponse(
      configBody({
        isOpen: false,
        reason: 'AFTER_HOURS',
        nextOpenAt: '2026-09-09T06:00:00.000Z',
        nextOpenLocal: '09:00',
        timezone: 'Asia/Baghdad',
      }),
    );
    expect(res.nextOpenLocal).toBe('09:00');
    expect(res.timezone).toBe('Asia/Baghdad');
    expect(res.nextOpenAt?.toISOString()).toBe('2026-09-09T06:00:00.000Z');
  });

  it('keeps a named closure and drops a blank one', () => {
    expect(
      parseConfigResponse(configBody({ reason: 'HOLIDAY', closureLabel: '  Eid al-Adha  ' }))
        .closureLabel,
    ).toBe('Eid al-Adha');
    expect(parseConfigResponse(configBody({ closureLabel: '   ' })).closureLabel).toBeUndefined();
  });

  it('falls back to CHAT/OPEN for a future server value', () => {
    const res = parseConfigResponse(configBody({ visitorMode: 'TELEPATHY', reason: 'ECLIPSE' }));
    expect(res.visitorMode).toBe('CHAT');
    expect(res.reason).toBe('OPEN');
  });

  it('throws a typed error when `config` is missing', () => {
    // The ONE non-optional field. A cast would produce `undefined` deeper in.
    expect(() => parseConfigResponse({ tenantId: 't1', isOpen: true })).toThrow(EasyLiveChatError);
    expect(() => parseConfigResponse({ config: [] })).toThrow(EasyLiveChatError);
  });

  it('defaults voiceNotesEnabled to false and soundEnabled to true', () => {
    // A microphone prompt is a large thing to spring on someone who only
    // opened a chat, so an older server keeps the SDK quiet rather than
    // guessing; sound is the opposite — the tenant default is on.
    const { config } = parseConfigResponse(configBody());
    expect(config.voiceNotesEnabled).toBe(false);
    expect(config.soundEnabled).toBe(true);
    expect(config.showAgentNames).toBe(true);
    expect(config.showAgentAvatars).toBe(true);
  });
});

describe('workspace:availability parsing', () => {
  it('applies the same permissive defaults as the config route', () => {
    const a = parseWorkspaceAvailability({ isOpen: true });
    expect(a.agentsAccepting).toBe(true);
    expect(a.visitorMode).toBe('CHAT');
    expect(a.reason).toBe('OPEN');
  });

  it('reads an explicit NOTICE_ONLY verdict', () => {
    const a = parseWorkspaceAvailability({ isOpen: false, visitorMode: 'NOTICE_ONLY' });
    expect(a.visitorMode).toBe('NOTICE_ONLY');
  });
});

describe('isWorkspaceClosed', () => {
  const base = { isOpen: true, chatAvailabilityMode: 'ALWAYS', agentsAccepting: true, asyncEnabled: false };

  it('is closed outside working hours', () => {
    expect(isWorkspaceClosed({ ...base, isOpen: false })).toBe(true);
  });

  it('ignores agentsAccepting for an ALWAYS tenant', () => {
    expect(isWorkspaceClosed({ ...base, agentsAccepting: false })).toBe(false);
  });

  it('closes a WHEN_ACCEPTING tenant only when async is on and nobody is accepting', () => {
    expect(
      isWorkspaceClosed({
        ...base,
        chatAvailabilityMode: 'WHEN_ACCEPTING',
        agentsAccepting: false,
        asyncEnabled: true,
      }),
    ).toBe(true);
    expect(
      isWorkspaceClosed({
        ...base,
        chatAvailabilityMode: 'WHEN_ACCEPTING',
        agentsAccepting: false,
        asyncEnabled: false,
      }),
    ).toBe(false);
  });
});
