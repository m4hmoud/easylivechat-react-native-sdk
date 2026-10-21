import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DirectionProvider, isolate } from '../src/direction';
import { __resetOverrides, stringsFor } from '../src/l10n';
import { EMAIL_SENT_DISMISS_MS, EmailCard, type EmailCardResult } from '../src/views/email-card';
import { RTL_THEME, THEME, flush, leftToRight, rowOf } from './support';

/**
 * The web widget's `EmailCard` (apps/widget/src/components/EmailCard.tsx):
 * an inline card, never a modal, that says what happened in its own place.
 */
function card(
  props: Partial<React.ComponentProps<typeof EmailCard>> & { locale?: string; rtl?: boolean } = {},
) {
  const { locale = 'en', rtl = false, ...rest } = props;
  const onSubmit = rest.onSubmit ?? vi.fn(async (): Promise<EmailCardResult> => ({ ok: true, hint: 'j•••@example.com' }));
  const onClose = rest.onClose ?? vi.fn();
  render(
    <DirectionProvider value={rtl ? 'rtl' : 'ltr'}>
      <EmailCard
        mode={rest.mode ?? 'transcript'}
        emailHint={rest.emailHint ?? null}
        theme={rtl ? RTL_THEME : THEME}
        strings={stringsFor(locale)}
        onSubmit={onSubmit}
        onClose={onClose}
      />
    </DirectionProvider>,
  );
  return { onSubmit, onClose };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  __resetOverrides();
});

describe('Email me this chat', () => {
  it('is a one-tap confirmation that names the address on file', async () => {
    const { onSubmit } = card({ emailHint: 'j•••@example.com' });
    expect(screen.getByText('Email me this chat')).toBeTruthy();
    expect(screen.getByText(`We'll send a copy to ${isolate('j•••@example.com')}.`)).toBeTruthy();
    expect(screen.queryByLabelText('Your email')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await flush();
    expect(onSubmit).toHaveBeenCalledWith(null);
    expect(screen.getByText(`Sent to ${isolate('j•••@example.com')}.`)).toBeTruthy();
  });

  it('asks for an address with none on file, or when the visitor wants another', async () => {
    const { onSubmit } = card({ emailHint: 'j•••@example.com' });
    fireEvent.press(screen.getByRole('button', { name: 'Use another address' }));
    const field = screen.getByLabelText('Your email');
    expect(field.props.keyboardType).toBe('email-address');
    expect(field.props.autoCapitalize).toBe('none');
    fireEvent.changeText(field, '  jo@example.com ');
    fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await flush();
    expect(onSubmit).toHaveBeenCalledWith('jo@example.com');
  });

  it('refuses an address the widget would refuse, before sending', async () => {
    const { onSubmit } = card();
    fireEvent.changeText(screen.getByLabelText('Your email'), 'jo@example');
    fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await flush();
    expect(screen.getByText('Enter a valid email address')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('says why it was not sent, in place', async () => {
    card({
      onSubmit: async () => ({ ok: false, message: 'This address has unsubscribed from our emails.' }),
    });
    fireEvent.changeText(screen.getByLabelText('Your email'), 'jo@example.com');
    fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await flush();
    expect(screen.getByText('This address has unsubscribed from our emails.')).toBeTruthy();
    // Still there to try again.
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('gets out of the way a moment after it was sent', async () => {
    vi.useFakeTimers();
    const { onClose } = card({ emailHint: 'j•••@example.com' });
    fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await flush();
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(EMAIL_SENT_DISMISS_MS);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('Cancel puts it away', () => {
    const { onClose } = card({ emailHint: 'j•••@example.com' });
    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Get the reply by email', () => {
  it('always asks for an address, and says what it is for', async () => {
    const { onSubmit } = card({ mode: 'notify' });
    expect(screen.getByText('Get the reply by email')).toBeTruthy();
    expect(screen.getByText("We'll answer here. Leave your email in case you've gone by then.")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Your email'), 'jo@example.com');
    fireEvent.press(screen.getByRole('button', { name: 'Email me' }));
    await flush();
    expect(onSubmit).toHaveBeenCalledWith('jo@example.com');
    expect(
      screen.getByText(`We'll email ${isolate('j•••@example.com')} if you've left by the time we reply.`),
    ).toBeTruthy();
  });

  it('stays until it is answered or put away — Not now', async () => {
    vi.useFakeTimers();
    const { onClose } = card({ mode: 'notify' });
    fireEvent.changeText(screen.getByLabelText('Your email'), 'jo@example.com');
    fireEvent.press(screen.getByRole('button', { name: 'Email me' }));
    await flush();
    act(() => {
      vi.advanceTimersByTime(EMAIL_SENT_DISMISS_MS * 2);
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Not now puts it away unanswered', () => {
    const { onClose, onSubmit } = card({ mode: 'notify' });
    fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('in a right-to-left chat', () => {
  it('reads in Sorani, its buttons at the trailing edge in reading order', () => {
    card({ mode: 'notify', locale: 'ckb', rtl: true });
    expect(screen.getByText('وەڵامەکە بە ئیمەیڵ وەربگرە')).toBeTruthy();
    const row = rowOf(screen.getByText('ئێستا نا'));
    // Right to left on screen: "Not now", then "Email me".
    expect(leftToRight(row)).toEqual(['ئیمەیڵم بۆ بنێرە', 'ئێستا نا']);
  });

  it('keeps the address in its own order inside the sentence', () => {
    card({ emailHint: 'j•••@example.com', locale: 'ar', rtl: true });
    expect(screen.getByText(`سنرسل نسخة إلى ${isolate('j•••@example.com')}.`)).toBeTruthy();
  });
});
