import { EasyLiveChat, parseWidgetConfig } from '@easylivechat/react-native';
import { cleanup, render, screen } from '@testing-library/react-native';
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DirectionProvider } from '../src/direction';
import { EasyLiveChatLauncher } from '../src/launcher';
import { __resetOverrides, stringsFor } from '../src/l10n';
import { QueueNotice } from '../src/views/queue-notice-view';
import { RTL_THEME, THEME, bootOffline, rowOf, runsRightToLeft, setQueue, setWidgetConfig, styleOf } from './support';

/**
 * Two smaller pieces of the widget the SDK now matches.
 *
 * The queue notice — the widget's `QueueView`: while the visitor waits for a
 * person, a "Queue" kicker, the workspace's own notice (filled in by the
 * server) and their place and wait, above a thread they can still use.
 *
 * The launcher's options from Widget settings — its size (48 / 56 / 64) and
 * words beside the icon, the pill the web loader draws.
 */
beforeAll(bootOffline);
afterAll(() => EasyLiveChat.instance.shutdown());
afterEach(() => {
  cleanup();
  setQueue(null);
  setWidgetConfig(null);
  __resetOverrides();
});

function notice(locale = 'en', rtl = false) {
  render(
    <DirectionProvider value={rtl ? 'rtl' : 'ltr'}>
      <QueueNotice theme={rtl ? RTL_THEME : THEME} strings={stringsFor(locale)} />
    </DirectionProvider>,
  );
}

const ISO = (s: string) => `⁨${s}⁩`;

describe('the queue notice', () => {
  it('says where the visitor stands, in the workspace’s words and ours', () => {
    setQueue({ position: 2, minutes: 5, text: 'Thanks Sam — you are number 2 in line.' });
    notice();
    expect(screen.getByText('Queue')).toBeTruthy();
    expect(screen.getByText('Thanks Sam — you are number 2 in line.')).toBeTruthy();
    expect(screen.getByText(`${ISO('#2')} · about 5 min`)).toBeTruthy();
  });

  it('gives the place alone when there is no estimate, and neither when there is no place', () => {
    setQueue({ position: 3, minutes: 0, text: '' });
    notice();
    expect(screen.getByText(ISO('#3'))).toBeTruthy();
    cleanup();

    setQueue({ position: 0, minutes: 0, text: 'Hold tight.' });
    notice();
    expect(screen.getByText('Hold tight.')).toBeTruthy();
    expect(screen.queryByText(/#/)).toBeNull();
  });

  it('is gone when nobody is waiting, and goes the moment someone is there', () => {
    notice();
    expect(screen.queryByText('Queue')).toBeNull();
    setQueue({ position: 1, minutes: 2, text: 'Next!' });
    expect(screen.getByText('Queue')).toBeTruthy();
    setQueue(null);
    expect(screen.queryByText('Queue')).toBeNull();
  });

  it('is in the visitor’s language, start-aligned in RTL, the place kept in order', () => {
    setQueue({ position: 4, minutes: 7, text: 'تکایە چاوەڕێ بکە.' });
    notice('ckb', true);
    expect(screen.getByText('ڕیز')).toBeTruthy();
    const meta = screen.getByText(`${ISO('#4')} · نزیکەی 7 خولەک`);
    expect(styleOf(meta)).toMatchObject({ textAlign: 'right', writingDirection: 'rtl' });
    expect(styleOf(screen.getByText('تکایە چاوەڕێ بکە.'))).toMatchObject({ textAlign: 'right' });
    cleanup();

    setQueue({ position: 1, minutes: 3, text: '' });
    notice('ar', true);
    expect(screen.getByText('قائمة الانتظار')).toBeTruthy();
    expect(screen.getByText(`${ISO('#1')} · 3 دقيقة تقريبًا`)).toBeTruthy();
  });

  it('lets the workspace’s own words face their own way inside an RTL chat', () => {
    setQueue({ position: 1, minutes: 1, text: 'You are next.' });
    notice('ar', true);
    expect(styleOf(screen.getByText('You are next.'))).toMatchObject({ textAlign: 'left', writingDirection: 'ltr' });
  });
});

describe('the launcher', () => {
  const bubble = () => screen.getByRole('button');

  it('is the 56-point circle it always was when Widget settings says nothing', () => {
    setWidgetConfig(parseWidgetConfig({}));
    render(<EasyLiveChatLauncher />);
    expect(styleOf(bubble())).toMatchObject({ height: 56, minWidth: 56, borderRadius: 28 });
    expect(screen.queryByText('Chat with us')).toBeNull();
  });

  it('takes its size from Widget settings', () => {
    setWidgetConfig(parseWidgetConfig({ launcherSize: 'small' }));
    render(<EasyLiveChatLauncher />);
    expect(styleOf(bubble())).toMatchObject({ height: 48, minWidth: 48 });
    cleanup();

    setWidgetConfig(parseWidgetConfig({ launcherSize: 'large' }));
    render(<EasyLiveChatLauncher />);
    expect(styleOf(bubble())).toMatchObject({ height: 64, minWidth: 64, borderRadius: 32 });
  });

  it('becomes a pill with the workspace’s words beside the icon', () => {
    setWidgetConfig(parseWidgetConfig({ launcherLabel: 'Chat with us', welcomeTitle: 'Hi there' }));
    render(<EasyLiveChatLauncher />);
    expect(screen.getByText('Chat with us')).toBeTruthy();
    // The words are what a screen reader hears too.
    expect(bubble().props.accessibilityLabel).toBe('Chat with us');
    expect(runsRightToLeft(rowOf(screen.getByText('Chat with us')))).toBe(false);
  });

  it('runs the pill right-to-left for an RTL workspace', () => {
    setWidgetConfig(parseWidgetConfig({ launcherLabel: 'گفتوگۆ لەگەڵمان', direction: 'rtl', locale: 'ckb' }));
    render(<EasyLiveChatLauncher />);
    const words = screen.getByText('گفتوگۆ لەگەڵمان');
    expect(runsRightToLeft(rowOf(words))).toBe(true);
    expect(styleOf(words).writingDirection).toBe('rtl');
  });

  it('falls back to the welcome title, then the chrome title, for its label', () => {
    setWidgetConfig(parseWidgetConfig({ welcomeTitle: 'Hi there' }));
    render(<EasyLiveChatLauncher />);
    expect(bubble().props.accessibilityLabel).toBe('Hi there');
  });
});
