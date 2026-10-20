import { EasyLiveChat, parseWidgetConfig } from '@easylivechat/react-native';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DirectionProvider } from '../src/direction';
import { CheckboxIcon } from '../src/icons';
import { stringsFor } from '../src/l10n';
import { PreChatFormView } from '../src/views/pre-chat-form-view';
import { THEME, bootOffline, flush, rowOf, runsRightToLeft } from './support';

/**
 * Port of `pre_chat_consent_widget_test.dart`: the consent checkbox in the
 * pre-chat form.
 *
 * A box, the tenant's sentence beside it and an optional privacy-policy link.
 * A required one blocks the chat until it is ticked; the link opens outside
 * the app and never ticks anything; and the whole row reads from the start
 * edge in either direction.
 */
const SENTENCE = 'I agree that this workspace may store what I write here.';

const consent = ({
  required = true,
  policyUrl = 'https://example.com/privacy' as unknown,
  label = SENTENCE,
} = {}) => ({ id: 'privacy', label, type: 'consent', required, policyUrl });

const openURL = Linking.openURL as unknown as ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

async function pump(field: Record<string, unknown>, { locale = 'en', rtl = false } = {}) {
  const config = parseWidgetConfig({
    locale,
    welcomeTitle: 'Hello',
    welcomeSubtitle: ' ',
    preChatForm: { enabled: true, fields: [field] },
  });
  render(
    <DirectionProvider value={rtl ? 'rtl' : 'ltr'}>
      <PreChatFormView config={config} theme={{ ...THEME, direction: rtl ? 'rtl' : 'ltr' }} strings={stringsFor(locale)} />
    </DirectionProvider>,
  );
  await flush();
}

const box = (): ReactTestInstance => screen.getByRole('checkbox');
const ticked = (): boolean => box().props.accessibilityState?.checked === true;
const sessionCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/session'));

describe('consent checkboxes', () => {
  beforeEach(async () => {
    openURL.mockClear();
    // The test runner has no network: every request is answered with a 400,
    // and what matters is whether one was made at all.
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'INVALID_PAYLOAD' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await bootOffline();
  });

  afterEach(() => {
    cleanup();
    EasyLiveChat.instance.shutdown();
    vi.unstubAllGlobals();
  });

  it('draws a box, the sentence verbatim and the policy link', async () => {
    await pump(consent());
    expect(screen.UNSAFE_queryAllByType(CheckboxIcon)).toHaveLength(1);
    expect(screen.getByText(`${SENTENCE} *`)).toBeTruthy();
    expect(screen.getByText('Privacy policy')).toBeTruthy();
    // A checkbox is never a text box.
    expect(screen.UNSAFE_queryAllByType('TextInput' as unknown as React.ComponentType)).toHaveLength(0);
    expect(ticked()).toBe(false);
  });

  it('a required box left unticked blocks the chat', async () => {
    await pump(consent());
    fireEvent.press(screen.getByText('Start chat'));
    await flush();
    expect(screen.getByText('Please tick this box to continue')).toBeTruthy();
    // Nothing was sent.
    expect(sessionCalls()).toHaveLength(0);
    expect(EasyLiveChat.instance.phase.get()).toBe('idle');
  });

  it('tapping the sentence ticks the box and clears the error', async () => {
    await pump(consent());
    fireEvent.press(screen.getByText('Start chat'));
    await flush();
    expect(screen.getByText('Please tick this box to continue')).toBeTruthy();

    fireEvent.press(screen.getByText(`${SENTENCE} *`));
    expect(ticked()).toBe(true);
    expect(screen.queryByText('Please tick this box to continue')).toBeNull();

    fireEvent.press(box());
    expect(ticked()).toBe(false);
  });

  it('the policy opens outside the app and ticks nothing', async () => {
    await pump(consent());
    fireEvent.press(screen.getByText('Privacy policy'));
    expect(openURL.mock.calls).toEqual([['https://example.com/privacy']]);
    expect(ticked()).toBe(false);
    // Its own target and its own screen-reader node, outside the checkbox.
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toBeTruthy();
    expect(box().findAll((n) => n.props.accessibilityRole === 'link')).toHaveLength(0);
  });

  it('no link without a policy, and never a javascript: one', async () => {
    await pump(consent({ policyUrl: 'javascript:alert(1)' }));
    expect(screen.queryByText('Privacy policy')).toBeNull();
    cleanup();
    await pump(consent({ policyUrl: null }));
    expect(screen.queryByText('Privacy policy')).toBeNull();
  });

  it('an optional box can stay unticked', async () => {
    await pump(consent({ required: false }));
    // No required marker.
    expect(screen.getByText(SENTENCE)).toBeTruthy();
    fireEvent.press(screen.getByText('Start chat'));
    await flush();
    expect(screen.queryByText('Please tick this box to continue')).toBeNull();
    // Not blocked: the session start went out.
    expect(sessionCalls()).toHaveLength(1);
  });

  it('a 500-character sentence is drawn whole, wrapping rather than cut', async () => {
    const long = Array(50).fill('I agree.').join(' ');
    await pump(consent({ label: long }));
    const text = screen.getByText(`${long} *`);
    expect(text.props.numberOfLines).toBeUndefined();
  });

  it('RTL: the box leads from the right; chrome is translated', async () => {
    const sentence = 'أوافق على أن تحتفظ مساحة العمل هذه بما أكتبه هنا.';
    await pump(consent({ label: sentence }), { locale: 'ar', rtl: true });
    const row = rowOf(screen.getByText(`${sentence} *`));
    // The row runs right to left, and the box is its first child: the right.
    expect(runsRightToLeft(row)).toBe(true);
    expect((row.children[0] as ReactTestInstance).findAllByType(CheckboxIcon)).toHaveLength(1);
    expect(screen.getByText('سياسة الخصوصية')).toBeTruthy();

    fireEvent.press(screen.getByText('بدء المحادثة'));
    await flush();
    expect(screen.getByText('يُرجى تحديد هذا المربع للمتابعة')).toBeTruthy();
  });
});
