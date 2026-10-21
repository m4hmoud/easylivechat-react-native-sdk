import { EasyLiveChat, type WidgetConfig, parseWidgetConfig } from '@easylivechat/react-native';
import { cleanup, render, screen } from '@testing-library/react-native';
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DirectionProvider } from '../src/direction';
import { __resetOverrides, overrideAll, stringsFor } from '../src/l10n';
import { ClosedNoticeBanner, ClosedNoticeView, closedNoticeText } from '../src/views/closed-notice-view';
import { RTL_THEME, THEME, bootOffline, setAvailability, setVisitorMode } from './support';

/**
 * The closed / busy notice — the web widget's `closedBannerText` (Embed.tsx),
 * on the banner above the thread and on the full closed screen alike.
 *
 * The business's own notice (`offlineInfoText`) ALWAYS wins. Without one, the
 * notice says the assistant can help in the meantime while it covers — "leave
 * a message and we'll reply when we're back" is untrue when it answers in
 * seconds — and the reopening time stays: it is when a PERSON is back. The
 * leave-a-message prompt (`offlineMessage`) is never the notice: it carries a
 * schema default nobody typed.
 */
const EN = {
  closed: "Our team is offline right now. Leave your message and we'll reply as soon as we're back.",
  noAgents: "Everyone's busy right now. Leave a message and we'll reply shortly.",
  closedAssistant: 'Our team is offline right now, but our assistant can help you in the meantime.',
  noAgentsAssistant: "Everyone's busy right now, but our assistant can help you in the meantime.",
  readOnly: "Our team is offline right now. We'll be back soon.",
};

const NOTICE = 'Closed for stocktaking — back Monday.';
const PROMPT = "We're offline — leave us a message.";

/** A config whose tenant wrote no closed notice — the leave-a-message prompt is all it has. */
const plainConfig = (): WidgetConfig => parseWidgetConfig({ offlineMessage: PROMPT });
/** A config whose tenant wrote its own closed notice in Settings → Availability. */
const noticeConfig = (): WidgetConfig =>
  parseWidgetConfig({ offlineMessage: PROMPT, offlineInfoText: `  ${NOTICE}  ` });

beforeAll(bootOffline);
afterAll(() => EasyLiveChat.instance.shutdown());
afterEach(() => {
  cleanup();
  setAvailability();
  setVisitorMode('CHAT');
  __resetOverrides();
});

function banner(config: WidgetConfig | null = null, locale = 'en', rtl = false) {
  render(
    <DirectionProvider value={rtl ? 'rtl' : 'ltr'}>
      <ClosedNoticeBanner config={config} theme={rtl ? RTL_THEME : THEME} strings={stringsFor(locale)} />
    </DirectionProvider>,
  );
}

function fullView(config: WidgetConfig = plainConfig(), locale = 'en') {
  render(<ClosedNoticeView config={config} theme={THEME} strings={stringsFor(locale)} />);
}

describe('the business’s own notice', () => {
  it('is read off the config, trimmed, and absent when blank', () => {
    expect(noticeConfig().offlineInfoText).toBe(NOTICE);
    expect(parseWidgetConfig({ offlineInfoText: '   ' }).offlineInfoText).toBeUndefined();
    expect(parseWidgetConfig({ offlineInfoText: null }).offlineInfoText).toBeUndefined();
    expect(parseWidgetConfig({}).offlineInfoText).toBeUndefined();
  });

  it('always wins on the banner — over the assistant notice too', () => {
    setAvailability({ reason: 'AFTER_HOURS', assistantCovers: true, nextOpenLocal: '09:00' });
    banner(noticeConfig());
    expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(screen.queryByText(new RegExp('assistant'))).toBeNull();
  });

  it('always wins on the full screen, and in a notice-only workspace', () => {
    setAvailability({ reason: 'NO_AGENTS', isOpen: true });
    setVisitorMode('NOTICE_ONLY');
    fullView(noticeConfig());
    expect(screen.getByText(NOTICE)).toBeTruthy();
  });

  it('fills in the visitor’s name like the rest of the tenant’s copy', () => {
    setAvailability({ reason: 'AFTER_HOURS' });
    banner(parseWidgetConfig({ offlineInfoText: 'Sorry %name%, we are shut.', defaultCustomerName: 'there' }));
    expect(screen.getByText('Sorry there, we are shut.')).toBeTruthy();
  });
});

describe('the closed banner', () => {
  it('asks for a message while nobody covers — in ours, not the leave-a-message prompt', () => {
    setAvailability({ reason: 'AFTER_HOURS' });
    banner(plainConfig());
    expect(screen.getByText(EN.closed)).toBeTruthy();
    expect(screen.queryByText(PROMPT)).toBeNull();
  });

  it('says the assistant can help while it covers a closed workspace', () => {
    setAvailability({ reason: 'AFTER_HOURS', assistantCovers: true });
    banner(plainConfig());
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

  it('invites nothing while the composer is locked: the reopening time is the notice', () => {
    setVisitorMode('NOTICE_ONLY');
    setAvailability({ reason: 'AFTER_HOURS', nextOpenLocal: '06:00' });
    banner(plainConfig());
    expect(screen.getByText("We're back at 06:00.")).toBeTruthy();
    cleanup();

    setAvailability({ reason: 'NO_AGENTS', isOpen: true });
    banner(plainConfig());
    expect(screen.getByText(EN.readOnly)).toBeTruthy();
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
  it('says the assistant can help, under the unavailable title — over the leave-a-message prompt', () => {
    setAvailability({ reason: 'AFTER_HOURS', assistantCovers: true, nextOpenLocal: '09:00' });
    fullView(plainConfig());
    expect(screen.getByText("We're not available right now")).toBeTruthy();
    expect(screen.getByText(`${EN.closedAssistant} We're back at 09:00.`)).toBeTruthy();
    expect(screen.queryByText(PROMPT)).toBeNull();
  });

  it('says the assistant can help while everyone is busy', () => {
    setAvailability({ reason: 'NO_AGENTS', isOpen: true, assistantCovers: true });
    fullView();
    expect(screen.getByText(EN.noAgentsAssistant)).toBeTruthy();
  });

  it('reads as the banner does while nobody covers', () => {
    setAvailability({ reason: 'NO_AGENTS', isOpen: true });
    fullView();
    expect(screen.getByText(EN.noAgents)).toBeTruthy();
  });

  it('invites nothing in a notice-only workspace', () => {
    setVisitorMode('NOTICE_ONLY');
    setAvailability({ reason: 'AFTER_HOURS', nextOpenLocal: '06:00' });
    fullView();
    expect(screen.getByText("We're back at 06:00.")).toBeTruthy();
    expect(screen.queryByText(EN.closed)).toBeNull();
  });

  it('is the same sentence as the banner, in every case', () => {
    const strings = stringsFor('en');
    const cases = [
      { reason: 'AFTER_HOURS' as const, assistantCovers: true, nextOpenLocal: '09:00' },
      { reason: 'NO_AGENTS' as const, assistantCovers: false, nextOpenLocal: null },
      { reason: 'HOLIDAY' as const, assistantCovers: false, nextOpenLocal: null },
    ];
    for (const c of cases) {
      const availability = {
        reason: c.reason,
        assistantCovers: c.assistantCovers,
        composerLocked: false,
        closureLabel: null,
        nextOpenLocal: c.nextOpenLocal,
        nextOpenAt: null,
      };
      setAvailability({ ...c, isOpen: c.reason === 'NO_AGENTS' });
      fullView();
      expect(screen.getByText(closedNoticeText(plainConfig(), strings, availability))).toBeTruthy();
      cleanup();
      banner(plainConfig());
      expect(screen.getByText(closedNoticeText(plainConfig(), strings, availability))).toBeTruthy();
      cleanup();
    }
  });
});
