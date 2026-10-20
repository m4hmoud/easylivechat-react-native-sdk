import { type ChatMessage, type SendResult, EasyLiveChat, isFromCustomer } from '@easylivechat/react-native';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import type { ReactTestInstance } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DirectionProvider } from '../src/direction';
import { __resetOverrides, stringsFor } from '../src/l10n';
import type { EasyLiveChatTheme } from '../src/theme';
import { MessageBubble } from '../src/views/message-bubble';
import { ReplyChips } from '../src/views/message-extras-view';
import { ThreadView } from '../src/views/thread-view';
import {
  bootOffline,
  currentMessages,
  flush,
  leftToRight,
  message,
  rowOf,
  runsRightToLeft,
  setMessages,
  setVisitorMode,
  styleOf,
} from './support';

/**
 * Port of `quick_replies_widget_test.dart`: the greeting's suggested answers
 * and the assistant's Yes / No, as one-tap buttons.
 *
 * Which message offers them is unit-tested in the core package. What is
 * pinned here is the part that only exists on screen: that the thread draws
 * them under that message and nowhere else, takes them away the moment the
 * visitor answers, and that a tap sends the reply once — as the visitor's own
 * message — however fast they tap.
 */
const THEME: EasyLiveChatTheme = {
  primary: '#7C3AED',
  background: '#FFFFFF',
  surface: '#F3F4F6',
  text: '#111827',
  direction: 'ltr',
};

let minute = 0;
function msg(
  id: string,
  senderType: 'agent' | 'customer' | 'system' | 'bot',
  { body = 'x', replies, assistant = false }: { body?: string; replies?: string[]; assistant?: boolean } = {},
): ChatMessage {
  return message({
    id,
    senderType,
    body,
    createdAt: new Date(Date.UTC(2026, 8, 16, 9, minute++)).toISOString(),
    metadata: { ...(replies ? { quickReplies: replies } : {}), ...(assistant ? { assistant: true } : {}) },
  });
}

const greeting = () => msg('greeting', 'bot', { body: 'Hi! How can we help?', replies: ['Track my order', 'Talk to a person'] });

function pump(rtl = false, locale = 'en') {
  render(
    <DirectionProvider value={rtl ? 'rtl' : 'ltr'}>
      <ThreadView theme={{ ...THEME, direction: rtl ? 'rtl' : 'ltr' }} strings={stringsFor(locale)} />
    </DirectionProvider>,
  );
}

/** The chips under one message, by its id. */
function repliesUnder(id: string): ReactTestInstance[] {
  const bubble = screen.UNSAFE_getAllByType(MessageBubble).find((b) => b.props.message.id === id);
  return bubble?.findAllByType(ReplyChips) ?? [];
}

function chip(label: string): ReactTestInstance {
  return screen.getByRole('button', { name: label });
}

const enabled = (label: string) => chip(label).props.accessibilityState?.disabled !== true;

beforeAll(bootOffline);
afterAll(() => EasyLiveChat.instance.shutdown());
afterEach(() => {
  cleanup();
  setMessages([]);
  setVisitorMode('CHAT');
  vi.restoreAllMocks();
  __resetOverrides();
});

describe('quick replies in the thread', () => {
  it('draws them under the newest message that offers them', () => {
    setMessages([msg('hi', 'customer', { body: 'hi' }), greeting()]);
    pump();
    expect(screen.UNSAFE_queryAllByType(ReplyChips)).toHaveLength(1);
    expect(repliesUnder('greeting')).toHaveLength(1);
    expect(screen.getByText('Track my order')).toBeTruthy();
    expect(screen.getByText('Talk to a person')).toBeTruthy();
    expect(enabled('Track my order')).toBe(true);
  });

  it("draws the assistant's Yes / No under its handover offer", () => {
    setMessages([
      msg('q', 'customer', { body: 'Can I speak to someone?' }),
      msg('offer', 'bot', {
        body: 'Shall I pass you to the team?',
        replies: ['Yes, please', 'No, thanks'],
        assistant: true,
      }),
    ]);
    pump();
    expect(repliesUnder('offer')).toHaveLength(1);
    expect(screen.getByText('Yes, please')).toBeTruthy();
    expect(screen.getByText('No, thanks')).toBeTruthy();
  });

  it('never under an older message once the team has said more', () => {
    setMessages([greeting(), msg('a1', 'agent', { body: 'Sam here.' })]);
    pump();
    expect(screen.UNSAFE_queryAllByType(ReplyChips)).toHaveLength(0);
    expect(screen.queryByText('Track my order')).toBeNull();
  });

  it('stay put through a system notice', () => {
    setMessages([greeting(), msg('sys', 'system', { body: 'Transferred' })]);
    pump();
    expect(repliesUnder('greeting')).toHaveLength(1);
  });

  it('go the moment the visitor answers', () => {
    setMessages([greeting()]);
    pump();
    expect(screen.UNSAFE_queryAllByType(ReplyChips)).toHaveLength(1);

    setMessages([...currentMessages(), msg('answer', 'customer', { body: 'Where is my parcel?' })]);
    expect(screen.UNSAFE_queryAllByType(ReplyChips)).toHaveLength(0);
    expect(screen.queryByText('Track my order')).toBeNull();
  });

  it('a tap sends the reply once, however fast the second tap comes', async () => {
    let settle: (id: string) => void = () => undefined;
    const send = vi.spyOn(EasyLiveChat.instance, 'sendMessage').mockImplementation(
      () =>
        ({
          optimistic: msg('tmp', 'customer'),
          serverMessageId: new Promise<string>((resolve) => {
            settle = resolve;
          }),
        }) as SendResult,
    );
    setMessages([greeting()]);
    pump();

    // Two taps before any re-render…
    const onPress = chip('Track my order').props.onPress as () => void;
    onPress();
    onPress();
    await flush();
    // …and a third on the other reply, after it.
    fireEvent.press(screen.getByText('Talk to a person'));

    expect(send.mock.calls.map((c) => c[0])).toEqual(['Track my order']);
    // Visible but disabled while that send is in flight.
    expect(enabled('Track my order')).toBe(false);
    expect(enabled('Talk to a person')).toBe(false);

    settle('m-server');
    await flush();
    expect(enabled('Talk to a person')).toBe(true);
  });

  it("the thread's send path puts the reply in the thread as the visitor's message", async () => {
    setMessages([greeting()]);
    pump();

    fireEvent.press(screen.getByText('Talk to a person'));
    fireEvent.press(screen.queryByText('Talk to a person') ?? screen.getByText('Hi! How can we help?'));
    await flush();

    const fromVisitor = currentMessages().filter(isFromCustomer);
    expect(fromVisitor).toHaveLength(1);
    expect(fromVisitor[0]!.body).toBe('Talk to a person');
    expect(fromVisitor[0]!.contentType).toBe('text');
    // Answered, so nothing is on offer any more.
    expect(screen.UNSAFE_queryAllByType(ReplyChips)).toHaveLength(0);
    // With no connection the send fails like any other — the visitor's own
    // bubble with its retry, not a silent drop.
    expect(screen.getByText(stringsFor('en').t('sendFailedRetry'))).toBeTruthy();
  });

  it('disabled while the workspace takes no messages, and back when it does', () => {
    setMessages([greeting()]);
    setVisitorMode('NOTICE_ONLY');
    pump();
    expect(screen.getByText('Track my order')).toBeTruthy();
    expect(enabled('Track my order')).toBe(false);

    setVisitorMode('CHAT');
    expect(enabled('Track my order')).toBe(true);
  });

  it("announced as a group of suggested replies, in the visitor's language", () => {
    setMessages([greeting()]);
    pump(true, 'ar');
    expect(screen.UNSAFE_getByType(ReplyChips).props.label).toBe('ردود مقترحة');
    expect(screen.getByLabelText('ردود مقترحة')).toBeTruthy();
    // Each reply is a button of its own, not folded into the group's label.
    expect(screen.getByRole('button', { name: 'Track my order' })).toBeTruthy();
  });

  it("in RTL they wrap from the right, under the team's bubble", () => {
    setMessages([greeting()]);
    pump(true);
    const row = rowOf(screen.getByText('Track my order'));
    expect(runsRightToLeft(row)).toBe(true);
    expect(styleOf(row).flexWrap).toBe('wrap');
    // First reply on the leading (right) edge, the next one to its left.
    expect(leftToRight(row)).toEqual(['Talk to a person', 'Track my order']);
  });

  it('wear the workspace accent, and no default colour', () => {
    setMessages([greeting()]);
    pump();
    const style = styleOf(chip('Track my order'));
    expect(style.borderColor).toBe(THEME.primary);
    expect(style.backgroundColor).toBe(THEME.background);
    expect(style.borderRadius).toBe(999);
    expect(styleOf(screen.getByText('Track my order')).color).toBe(THEME.primary);
  });

  it('a long reply wraps instead of being cut', () => {
    const long = 'I would like to change the delivery address on my last order please';
    setMessages([msg('g', 'bot', { body: 'Hi!', replies: [long] })]);
    pump();
    expect(screen.getByText(long).props.numberOfLines).toBeUndefined();
  });
});

describe('quick replies on a bubble of their own', () => {
  it('draw disabled with no send path', () => {
    render(
      <DirectionProvider value="ltr">
        <MessageBubble
          message={greeting()}
          theme={THEME}
          showAgentName={false}
          showAgentAvatar={false}
          strings={stringsFor('en')}
          agentLastReadAt={null}
          onOpenImage={() => undefined}
          quickReplies={['Track my order']}
          onQuickReply={null}
        />
      </DirectionProvider>,
    );
    expect(enabled('Track my order')).toBe(false);
  });
});
