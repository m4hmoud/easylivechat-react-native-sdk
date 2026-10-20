import { EasyLiveChat } from '@easylivechat/react-native';
import { cleanup, render, screen } from '@testing-library/react-native';
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DirectionProvider } from '../src/direction';
import { __resetOverrides, overrideAll, stringsFor } from '../src/l10n';
import { ThreadView } from '../src/views/thread-view';
import { TypingRow } from '../src/views/typing-row';
import { RTL_THEME, THEME, bootOffline, message, setMessages, setTyping } from './support';

/**
 * "Assistant is typing…" while the AI assistant composes a reply.
 *
 * The core keeps `agentTyping` true while the assistant types — so a UI that
 * binds only that still shows the row — and says which it is through
 * `assistantTyping`. The row follows the first and is NAMED from the second,
 * so the wait is not mistaken for a person. (`easylivechat_ui` 0.1.66, the
 * `_TypingRow` label in `thread_view.dart`.)
 */
beforeAll(bootOffline);
afterAll(() => EasyLiveChat.instance.shutdown());
afterEach(() => {
  cleanup();
  setTyping(false, false);
  setMessages([]);
  __resetOverrides();
});

function pump(locale = 'en', rtl = false) {
  render(
    <DirectionProvider value={rtl ? 'rtl' : 'ltr'}>
      <ThreadView theme={rtl ? RTL_THEME : THEME} strings={stringsFor(locale)} />
    </DirectionProvider>,
  );
}

const rows = () => screen.UNSAFE_queryAllByType(TypingRow);

describe('the typing row', () => {
  it('says a person is typing when one is', () => {
    setMessages([message({ id: 'q', senderType: 'customer', body: 'Do you ship to Erbil?' })]);
    setTyping(true);
    pump();
    expect(rows()).toHaveLength(1);
    expect(screen.getByLabelText('Typing…')).toBeTruthy();
    expect(screen.queryByLabelText('Assistant is typing…')).toBeNull();
  });

  it('says the assistant is typing when it is the one composing', () => {
    setTyping(true, true);
    pump();
    expect(rows()).toHaveLength(1);
    expect(screen.getByLabelText('Assistant is typing…')).toBeTruthy();
    expect(screen.queryByLabelText('Typing…')).toBeNull();
  });

  it('switches its label in place as the typist changes, and goes when nobody types', () => {
    pump();
    expect(rows()).toHaveLength(0);

    setTyping(true, true);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.props.label).toBe('Assistant is typing…');

    // The assistant handed over and a person picked the chat up.
    setTyping(true, false);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.props.label).toBe('Typing…');

    setTyping(false, false);
    expect(rows()).toHaveLength(0);
  });

  it('is shown by agentTyping alone — assistantTyping only names it', () => {
    // Not a state the core produces; pinned so the row is never driven by the
    // label's store and then left on screen after the reply lands.
    setTyping(false, true);
    pump();
    expect(rows()).toHaveLength(0);
  });

  it("is named in the visitor's language", () => {
    setTyping(true, true);
    pump('ar', true);
    expect(screen.getByLabelText('المساعد يكتب…')).toBeTruthy();
  });

  it('takes a host override like every other string', () => {
    overrideAll({ assistantTyping: 'Our bot is writing…' });
    setTyping(true, true);
    pump();
    expect(screen.getByLabelText('Our bot is writing…')).toBeTruthy();
  });
});
