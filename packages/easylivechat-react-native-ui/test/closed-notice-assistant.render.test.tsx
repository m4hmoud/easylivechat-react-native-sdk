import { EasyLiveChat, type WidgetConfig, parseWidgetConfig } from '@easylivechat/react-native';
import { cleanup, render, screen } from '@testing-library/react-native';
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DirectionProvider } from '../src/direction';
import { __resetOverrides, overrideAll, stringsFor } from '../src/l10n';
import { ClosedNoticeBanner, ClosedNoticeView } from '../src/views/closed-notice-view';
import { RTL_THEME, THEME, bootOffline, setAvailability } from './support';

/**
 * The closed / busy notice while the AI assistant covers.
 *
 * "Leave a message and we'll reply when we're back" is untrue when the
 * assistant answers in seconds, so the notice says it can help in the meantime
 * instead — on the banner over the tenant's own leave-a-message copy too. The
 * reopening time stays: it is when a PERSON is back. (`easylivechat_ui`
 * 0.1.66, `closed_notice_view.dart`.)
 */
const EN = {
  closed: "Our team is offline right now. Leave your message and we'll reply as soon as we're back.",
  noAgents: "Everyone's busy right now. Leave a message and we'll reply shortly.",
  closedAssistant: 'Our team is offline right now, but our assistant can help you in the meantime.',
  noAgentsAssistant: "Everyone's busy right now, but our assistant can help you in the meantime.",
};

const TENANT_COPY = 'Leave us a note and we will write back tomorrow.';

/** A config whose tenant left the offline message blank — the default notice shows. */
const blankConfig = (): WidgetConfig => ({ ...parseWidgetConfig({}), offlineMessage: '' });
const tenantConfig = (): WidgetConfig => parseWidgetConfig({ offlineMessage: TENANT_COPY });

beforeAll(bootOffline);
afterAll(() => EasyLiveChat.instance.shutdown());
afterEach(() => {
  cleanup();
  setAvailability();
  __resetOverrides();
});

function banner(config: WidgetConfig | null = null, locale = 'en', rtl = false) {
  render(
    <DirectionProvider value={rtl ? 'rtl' : 'ltr'}>
      <ClosedNoticeBanner config={config} theme={rtl ? RTL_THEME : THEME} strings={stringsFor(locale)} />
    </DirectionProvider>,
  );
}

function fullView(config: WidgetConfig, locale = 'en') {
  render(<ClosedNoticeView config={config} theme={THEME} strings={stringsFor(locale)} />);
}

describe('the closed banner', () => {
  it('asks for a message while nobody covers', () => {
    setAvailability({ reason: 'AFTER_HOURS' });
    banner();
    expect(screen.getByText(EN.closed)).toBeTruthy();
  });

  it('says the assistant can help while it covers a closed workspace', () => {
    setAvailability({ reason: 'AFTER_HOURS', assistantCovers: true });
    banner();
    expect(screen.getByText(EN.closedAssistant)).toBeTruthy();
    expect(screen.queryByText(EN.closed)).toBeNull();
  });

  it('keeps the reopening time — it is when a person is back', () => {
    setAvailability({ reason: 'AFTER_HOURS', assistantCovers: true, nextOpenLocal: '09:00' });
    banner();
    expect(screen.getByText(`${EN.closedAssistant} We're back at 09:00.`)).toBeTruthy();
  });

  it('says the assistant can help while everyone is busy', () => {
    setAvailability({ reason: 'NO_AGENTS', isOpen: true, assistantCovers: true, nextOpenLocal: '09:00' });
    banner();
    // Busy is not shut: no reopening time, as without the assistant.
    expect(screen.getByText(EN.noAgentsAssistant)).toBeTruthy();
  });

  it('says everyone is busy while nobody covers', () => {
    setAvailability({ reason: 'NO_AGENTS', isOpen: true });
    banner();
    expect(screen.getByText(EN.noAgents)).toBeTruthy();
  });

  it('puts the assistant ahead of a named closure', () => {
    setAvailability({ reason: 'HOLIDAY', closureLabel: 'Eid al-Adha' });
    banner();
    expect(screen.getByText("We're closed for Eid al-Adha.")).toBeTruthy();
    cleanup();

    setAvailability({ reason: 'HOLIDAY', closureLabel: 'Eid al-Adha', assistantCovers: true });
    banner();
    expect(screen.getByText(EN.closedAssistant)).toBeTruthy();
  });

  it("gives the tenant's leave-a-message copy way to it", () => {
    setAvailability({ reason: 'AFTER_HOURS' });
    banner(tenantConfig());
    expect(screen.getByText(TENANT_COPY)).toBeTruthy();
    cleanup();

    setAvailability({ reason: 'AFTER_HOURS', assistantCovers: true });
    banner(tenantConfig());
    expect(screen.getByText(EN.closedAssistant)).toBeTruthy();
    expect(screen.queryByText(TENANT_COPY)).toBeNull();
  });

  it('follows a live availability push without being remounted', () => {
    setAvailability({ reason: 'AFTER_HOURS', assistantCovers: true });
    banner();
    expect(screen.getByText(EN.closedAssistant)).toBeTruthy();

    // The shift the assistant covered ended.
    setAvailability({ reason: 'AFTER_HOURS', assistantCovers: false });
    expect(screen.getByText(EN.closed)).toBeTruthy();
    expect(screen.queryByText(EN.closedAssistant)).toBeNull();
  });

  it("is in the visitor's language, start-aligned in RTL", () => {
    setAvailability({ reason: 'AFTER_HOURS', assistantCovers: true });
    banner(null, 'ar', true);
    const text = screen.getByText('فريقنا غير متاح حالياً، لكن مساعدنا يمكنه مساعدتك في هذه الأثناء.');
    // An LTR host with an RTL chat: the start edge is the right.
    expect(text.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ textAlign: 'right', writingDirection: 'rtl' })]),
    );
    cleanup();

    setAvailability({ reason: 'NO_AGENTS', isOpen: true, assistantCovers: true });
    banner(null, 'ckb', true);
    expect(
      screen.getByText('ئێستا هەموو خەریکن، بەڵام یاریدەدەرەکەمان دەتوانێت لەم ماوەیەدا یارمەتیت بدات.'),
    ).toBeTruthy();
  });

  it('takes host overrides like every other string', () => {
    overrideAll({
      closedAssistantNotice: 'We are away — our bot can help.',
      noAgentsAssistantNotice: 'All hands busy — our bot can help.',
    });
    setAvailability({ reason: 'AFTER_HOURS', assistantCovers: true });
    banner();
    expect(screen.getByText('We are away — our bot can help.')).toBeTruthy();
    cleanup();

    setAvailability({ reason: 'NO_AGENTS', isOpen: true, assistantCovers: true });
    banner();
    expect(screen.getByText('All hands busy — our bot can help.')).toBeTruthy();
  });
});

describe('the closed view', () => {
  it('says the assistant can help, under the unavailable title', () => {
    setAvailability({ reason: 'AFTER_HOURS', assistantCovers: true, nextOpenLocal: '09:00' });
    fullView(blankConfig());
    expect(screen.getByText("We're not available right now")).toBeTruthy();
    expect(screen.getByText(`${EN.closedAssistant} We're back at 09:00.`)).toBeTruthy();
  });

  it('says the assistant can help while everyone is busy', () => {
    setAvailability({ reason: 'NO_AGENTS', isOpen: true, assistantCovers: true });
    fullView(blankConfig());
    expect(screen.getByText(EN.noAgentsAssistant)).toBeTruthy();
  });

  it('reads as it always did while nobody covers', () => {
    setAvailability({ reason: 'NO_AGENTS', isOpen: true });
    fullView(blankConfig());
    expect(screen.getByText(EN.noAgents)).toBeTruthy();
  });

  it("keeps the tenant's own copy, as easylivechat_ui's view does", () => {
    // Only the BANNER sets the tenant's wording aside for the assistant
    // notice; the full view, the fallback for workspaces that refuse new
    // chats, prefers it whatever the assistant is doing.
    setAvailability({ reason: 'AFTER_HOURS', assistantCovers: true });
    fullView(tenantConfig());
    expect(screen.getByText(TENANT_COPY)).toBeTruthy();
    expect(screen.queryByText(EN.closedAssistant)).toBeNull();
  });
});
