import { cleanup, render, screen } from '@testing-library/react-native';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { DirectionProvider } from '../src/direction';
import { stringsFor } from '../src/l10n';
import { MessageBubble } from '../src/views/message-bubble';
import { THEME, leftToRight, message, rowOf } from './support';

/**
 * Port of `edited_label_widget_test.dart`.
 *
 * An agent may change a reply after sending it; the visitor is told so,
 * quietly, beside the time — in their own language, on the leading side of the
 * time in either direction.
 */
describe('the edited label', () => {
  afterEach(cleanup);

  const sentAt = new Date(2026, 9, 6, 10, 1);
  const agent = (editedAt?: Date) =>
    message({ id: 'a1', body: 'Your order ships Tuesday', createdAt: sentAt.toISOString() }, { editedAt });

  function pump(m: ReturnType<typeof agent>, locale = 'en', rtl = false) {
    render(
      <DirectionProvider value={rtl ? 'rtl' : 'ltr'}>
        <MessageBubble
          message={m}
          theme={rtl ? { ...THEME, direction: 'rtl' } : THEME}
          showAgentName={false}
          showAgentAvatar={false}
          strings={stringsFor(locale)}
          agentLastReadAt={null}
          onOpenImage={() => undefined}
        />
      </DirectionProvider>,
    );
  }

  it('an edited message says so beside its time', () => {
    pump(agent(new Date(sentAt.getTime() + 2 * 60_000)));
    expect(screen.getByText('edited')).toBeTruthy();
    expect(screen.getByText('⁨10:01⁩')).toBeTruthy();
  });

  it('a message as first sent says nothing extra', () => {
    pump(agent());
    expect(screen.queryByText('edited')).toBeNull();
  });

  it('in Arabic it is translated and leads the time from the right', () => {
    pump(agent(new Date(sentAt.getTime() + 2 * 60_000)), 'ar', true);
    const label = screen.getByText('معدّلة');
    // Leading in RTL is the right: on screen the time, then the label.
    expect(leftToRight(rowOf(label))).toEqual(['⁨10:01⁩', 'معدّلة']);
  });

  it('in English the label leads from the left', () => {
    pump(agent(new Date(sentAt.getTime() + 2 * 60_000)));
    expect(leftToRight(rowOf(screen.getByText('edited')))).toEqual(['edited', '⁨10:01⁩']);
  });
});
