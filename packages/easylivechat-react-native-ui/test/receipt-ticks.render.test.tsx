import type { ChatMessage } from '@easylivechat/react-native';
import { cleanup, render, screen } from '@testing-library/react-native';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { DirectionProvider } from '../src/direction';
import { CheckIcon, ClockIcon, DoubleCheckIcon } from '../src/icons';
import { type Strings, stringsFor } from '../src/l10n';
import { MessageBubble } from '../src/views/message-bubble';
import { THEME, message } from './support';

/**
 * Port of `receipt_ticks_widget_test.dart`: the ticks a visitor reads their
 * own send by.
 *
 * `receiptFor` is unit-tested in the core; what this pins is the half that
 * only exists on screen — that the bubble asks for a receipt at all, that read
 * is visually distinct from sent rather than the same glyph in the same
 * colour, and that a screen reader is given something to say about a control
 * whose entire content is a 13px icon.
 */
describe('receipt ticks', () => {
  afterEach(cleanup);

  const sentAt = new Date(Date.UTC(2026, 7, 14, 10, 0, 0));
  const customer = (overrides: Partial<ChatMessage> = {}) =>
    message({ senderType: 'customer', createdAt: sentAt.toISOString(), deliveryStatus: 'SENT' }, overrides);

  function pump(m: ChatMessage, agentLastReadAt: Date | null = null, strings: Strings = stringsFor('en')) {
    render(
      <DirectionProvider value="ltr">
        <MessageBubble
          message={m}
          theme={THEME}
          showAgentName={false}
          showAgentAvatar={false}
          strings={strings}
          agentLastReadAt={agentLastReadAt}
          onOpenImage={() => undefined}
        />
      </DirectionProvider>,
    );
  }

  const later = new Date(sentAt.getTime() + 60_000);

  it('an unread send shows a single tick', () => {
    pump(customer());
    expect(screen.UNSAFE_queryAllByType(CheckIcon)).toHaveLength(1);
    expect(screen.UNSAFE_queryAllByType(DoubleCheckIcon)).toHaveLength(0);
  });

  it('a read send shows the double tick in the accent colour', () => {
    pump(customer(), later);
    const double = screen.UNSAFE_getByType(DoubleCheckIcon);
    // No single tick beside it: every tick on screen is one of the pair.
    expect(screen.UNSAFE_queryAllByType(CheckIcon)).toHaveLength(double.findAllByType(CheckIcon).length);
    // The colour is the signal that separates read from sent — a double tick
    // in the muted colour would read as "sent" at a glance.
    expect(double.props.color).toBe(THEME.primary);
  });

  it('an in-flight send shows a clock, not a tick', () => {
    pump(customer({ isOptimistic: true, deliveryStatus: 'pending' }));
    expect(screen.UNSAFE_queryAllByType(ClockIcon)).toHaveLength(1);
    expect(screen.UNSAFE_queryAllByType(CheckIcon)).toHaveLength(0);
  });

  it('a failed send keeps its worded retry affordance', () => {
    // The one state the visitor can act on: it must stay a tappable sentence
    // rather than becoming an icon they would have to interpret.
    pump(customer({ failed: true }));
    const retry = screen.getByText(stringsFor('en').t('sendFailedRetry'));
    expect(retry).toBeTruthy();
    expect(screen.getByRole('button', { name: stringsFor('en').t('sendFailedRetry') })).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(CheckIcon)).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(DoubleCheckIcon)).toHaveLength(0);
  });

  it('an agent message carries no receipt', () => {
    pump(message({ id: 'a1', body: 'hi there', createdAt: sentAt.toISOString() }), later);
    expect(screen.UNSAFE_queryAllByType(CheckIcon)).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(DoubleCheckIcon)).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(ClockIcon)).toHaveLength(0);
  });

  it('each state is announced to a screen reader', () => {
    const s = stringsFor('en');
    pump(customer());
    expect(screen.getByLabelText(s.t('messageSent'))).toBeTruthy();
    cleanup();
    pump(customer(), later);
    expect(screen.getByLabelText(s.t('messageRead'))).toBeTruthy();
    cleanup();
    pump(customer({ isOptimistic: true, deliveryStatus: 'pending' }));
    expect(screen.getByLabelText(s.t('sending'))).toBeTruthy();
  });

  it('the labels follow the chat language', () => {
    // Every other string in the thread is localised; a tick announced in
    // English inside an Arabic chat is the one piece of the UI that is not.
    const arabic = stringsFor('ar');
    expect(arabic.t('messageRead')).not.toBe(stringsFor('en').t('messageRead'));
    pump(customer(), later, arabic);
    expect(screen.getByLabelText(arabic.t('messageRead'))).toBeTruthy();
  });
});
