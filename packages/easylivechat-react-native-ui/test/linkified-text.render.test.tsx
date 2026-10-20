import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinkifiedText } from '../src/views/linkified-text';
import { flush, styleOf, textOf } from './support';

/**
 * Port of `linkified_text_widget_test.dart`: a link in a message is a link —
 * the right app opens it, and the words around it are untouched.
 */
const openURL = Linking.openURL as unknown as ReturnType<typeof vi.fn>;
const LINK = '#2563EB';

function host(body: string) {
  render(<LinkifiedText text={body} style={{ fontSize: 15, color: '#0F172A' }} linkColor={LINK} />);
}

async function tap(run: string): Promise<void> {
  fireEvent.press(screen.getByRole('link', { name: run }));
  await flush();
}

describe('LinkifiedText', () => {
  beforeEach(() => openURL.mockClear());
  afterEach(cleanup);

  it('plain text renders without any tappable span', () => {
    host('Hello, how can I help?');
    expect(screen.getByText('Hello, how can I help?')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('tapping a URL opens it in the browser', async () => {
    host('Docs are at https://livechattools.com/docs — enjoy');
    await tap('https://livechattools.com/docs');
    expect(openURL.mock.calls).toEqual([['https://livechattools.com/docs']]);
  });

  it('tapping a scheme-less domain opens it over https', async () => {
    host('see livechattools.com');
    await tap('livechattools.com');
    expect(openURL.mock.calls).toEqual([['https://livechattools.com']]);
  });

  it('tapping an email opens the mail composer', async () => {
    host('write to hello@livechattools.com any time');
    await tap('hello@livechattools.com');
    expect(openURL.mock.calls).toEqual([['mailto:hello@livechattools.com']]);
  });

  it('tapping a phone number opens the dialer', async () => {
    host('call +964 750 123 4567 today');
    await tap('+964 750 123 4567');
    expect(openURL.mock.calls).toEqual([['tel:+9647501234567']]);
  });

  it('link runs are underlined in the link color', () => {
    host('go to https://example.com now');
    expect(styleOf(screen.getByRole('link'))).toMatchObject({
      color: LINK,
      textDecorationLine: 'underline',
    });
  });

  it('non-link text around a link is preserved verbatim', () => {
    const body = 'ping https://example.com then reply';
    host(body);
    expect(textOf(screen.getByText(body))).toBe(body);
  });

  it('a message faces the way its own text reads', () => {
    host('مرحبا https://example.com');
    expect(styleOf(screen.getByText('مرحبا https://example.com'))).toMatchObject({ writingDirection: 'rtl' });
  });
});
