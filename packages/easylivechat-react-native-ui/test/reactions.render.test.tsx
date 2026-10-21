import { type ChatMessage, EasyLiveChat, QUICK_REACTIONS } from '@easylivechat/react-native';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import type { ReactTestInstance } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DirectionProvider } from '../src/direction';
import { __resetOverrides, stringsFor } from '../src/l10n';
import { QuickReactionRow, ReactionChips } from '../src/views/reactions-view';
import { ThreadView } from '../src/views/thread-view';
import {
  RTL_THEME,
  THEME,
  bootOffline,
  currentMessages,
  message,
  setConnection,
  setMessages,
  setVisitorMode,
  styleOf,
} from './support';

/**
 * Reactions in the thread (C1) — the web widget's `components/Reactions.tsx`.
 *
 * Chips under any bubble that has reactions: the visitor's own (tapping it
 * takes it back) and the team's on the visitor's messages. A long press on one
 * of the team's messages opens the quick six in place under it; picking one
 * reacts, picking theirs again takes it back. Offered only while the socket is
 * up and the workspace takes messages — `connected && !composerLocked`.
 */
let minute = 0;
function msg(
  id: string,
  senderType: 'agent' | 'customer' | 'system',
  body: string,
  reactions?: { emoji: string; by: 'agent' | 'customer' }[],
): ChatMessage {
  return message({
    id,
    senderType,
    body,
    createdAt: new Date(Date.UTC(2026, 9, 18, 10, minute++)).toISOString(),
    ...(reactions ? { reactions } : {}),
  });
}

function pump(locale = 'en', rtl = false) {
  render(
    <DirectionProvider value={rtl ? 'rtl' : 'ltr'}>
      <ThreadView theme={rtl ? RTL_THEME : THEME} strings={stringsFor(locale)} />
    </DirectionProvider>,
  );
}

/** Long-press a bubble by its words, the way a thumb opens the quick row. */
function longPress(text: string) {
  fireEvent(screen.getByText(text), 'longPress');
}

const quickRow = () => screen.UNSAFE_queryAllByType(QuickReactionRow);
const chipsUnder = (id: string): ReactTestInstance[] =>
  screen.UNSAFE_queryAllByType(ReactionChips).filter((c) => c.props.message.id === id);

let react: { mock: { calls: unknown[][] } };

beforeAll(bootOffline);
afterAll(() => EasyLiveChat.instance.shutdown());
beforeEach(() => {
  setConnection('connected');
  react = vi.spyOn(EasyLiveChat.instance, 'react').mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  setMessages([]);
  setVisitorMode('CHAT');
  setConnection('disconnected');
  vi.restoreAllMocks();
  __resetOverrides();
});

describe('reaction chips', () => {
  it('show the visitor’s own reaction under a team message, and take it back on a tap', () => {
    setMessages([msg('a1', 'agent', 'Your order shipped', [{ emoji: '👍', by: 'customer' }])]);
    pump();
    const chip = screen.getByRole('button', { name: 'Your reaction: 👍' });
    expect(chip.props.accessibilityState).toEqual({ selected: true });
    fireEvent.press(chip);
    expect(react).toHaveBeenCalledWith('a1', null);
  });

  it('show the team’s reaction on the visitor’s message, as a label only', () => {
    setMessages([msg('m1', 'customer', 'Thanks!', [{ emoji: '❤️', by: 'agent' }])]);
    pump();
    expect(screen.getByLabelText('The team reacted with ❤️')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'The team reacted with ❤️' })).toBeNull();
  });

  it('count a group of the same emoji', () => {
    setMessages([
      msg('m1', 'customer', 'We did it', [
        { emoji: '🙏', by: 'agent' },
        { emoji: '🙏', by: 'agent' },
        { emoji: '😂', by: 'agent' },
      ]),
    ]);
    pump();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByLabelText('The team reacted with 😂')).toBeTruthy();
  });

  it('are absent on a message nobody reacted to', () => {
    setMessages([msg('a1', 'agent', 'Hello', [])]);
    pump();
    expect(screen.UNSAFE_queryAllByType(ReactionChips).every((c) => c.children.length === 0)).toBe(true);
    expect(screen.queryByLabelText(/reaction/)).toBeNull();
  });

  it('follow a live change without a remount', () => {
    setMessages([msg('a1', 'agent', 'Hello')]);
    pump();
    expect(screen.queryByLabelText(/Your reaction/)).toBeNull();
    setMessages(currentMessages().map((m) => ({ ...m, reactions: [{ emoji: '😮', by: 'customer' as const }] })));
    expect(screen.getByRole('button', { name: 'Your reaction: 😮' })).toBeTruthy();
  });

  it('hug the sender’s side, mirrored in RTL', () => {
    setMessages([
      msg('m1', 'customer', 'Thanks!', [{ emoji: '❤️', by: 'agent' }]),
      msg('a1', 'agent', 'Any time', [{ emoji: '👍', by: 'customer' }]),
    ]);
    pump();
    const own = chipsUnder('m1')[0]!.children[0] as ReactTestInstance;
    const team = chipsUnder('a1')[0]!.children[0] as ReactTestInstance;
    expect(styleOf(own)).toMatchObject({ flexDirection: 'row', justifyContent: 'flex-end' });
    expect(styleOf(team)).toMatchObject({ flexDirection: 'row', justifyContent: 'flex-start' });
    cleanup();

    pump('ar', true);
    const rtlOwn = chipsUnder('m1')[0]!.children[0] as ReactTestInstance;
    // An LTR host with an RTL chat: `row-reverse` IS right-to-left, and the
    // visitor's trailing side is the left.
    expect(styleOf(rtlOwn)).toMatchObject({ flexDirection: 'row-reverse', justifyContent: 'flex-end' });
  });

  it('are worded in the visitor’s language', () => {
    setMessages([
      msg('a1', 'agent', 'سڵاو', [{ emoji: '👍', by: 'customer' }]),
      msg('m1', 'customer', 'سوپاس', [{ emoji: '❤️', by: 'agent' }]),
    ]);
    pump('ckb', true);
    expect(screen.getByRole('button', { name: 'کاردانەوەکەت: 👍' })).toBeTruthy();
    expect(screen.getByLabelText('تیمەکە بە ❤️ کاردانەوەی دایەوە')).toBeTruthy();
    cleanup();

    pump('ar', true);
    expect(screen.getByRole('button', { name: 'تفاعلك: 👍' })).toBeTruthy();
  });
});

describe('the quick row', () => {
  it('opens on a long press of a team message, with the quick six and a close', () => {
    setMessages([msg('a1', 'agent', 'Your order shipped')]);
    pump();
    expect(quickRow()).toHaveLength(0);
    longPress('Your order shipped');
    expect(quickRow()).toHaveLength(1);
    for (const emoji of QUICK_REACTIONS) expect(screen.getByText(emoji)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(quickRow()).toHaveLength(0);
  });

  it('reacts with the emoji picked, and closes', () => {
    setMessages([msg('a1', 'agent', 'Your order shipped')]);
    pump();
    longPress('Your order shipped');
    fireEvent.press(screen.getByText('❤️'));
    expect(react).toHaveBeenCalledWith('a1', '❤️');
    expect(quickRow()).toHaveLength(0);
  });

  it('marks the visitor’s own, and takes it back when picked again', () => {
    setMessages([msg('a1', 'agent', 'Your order shipped', [{ emoji: '😂', by: 'customer' }])]);
    pump();
    longPress('Your order shipped');
    const row = quickRow()[0]!;
    // Host elements only: a component and the view it renders both carry the prop.
    const selected = row.findAll(
      (n) => typeof n.type === 'string' && n.props.accessibilityState?.selected === true,
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]!.findByType('Text' as never).props.children).toBe('😂');
    fireEvent.press(screen.getAllByText('😂').at(-1)!);
    expect(react).toHaveBeenCalledWith('a1', null);
  });

  it('keeps one open at a time', () => {
    setMessages([msg('a1', 'agent', 'First'), msg('a2', 'agent', 'Second')]);
    pump();
    longPress('First');
    longPress('Second');
    expect(quickRow()).toHaveLength(1);
    expect(quickRow()[0]!.props.message.id).toBe('a2');
    // The same bubble again closes it.
    longPress('Second');
    expect(quickRow()).toHaveLength(0);
  });

  it('opens from the "React" accessibility action on the bubble’s words', () => {
    setMessages([msg('a1', 'agent', 'Your order shipped')]);
    pump();
    const words = screen.getByText('Your order shipped');
    expect(words.props.accessibilityActions).toEqual([{ name: 'react', label: 'React' }]);
    fireEvent(words, 'accessibilityAction', { nativeEvent: { actionName: 'react' } });
    expect(quickRow()).toHaveLength(1);
  });

  it('is not offered on the visitor’s own message, a system notice, or a send in flight', () => {
    setMessages([
      msg('m1', 'customer', 'Mine'),
      msg('s1', 'system', 'Conversation transferred'),
      { ...msg('tmp-1', 'agent', 'Sending'), isOptimistic: true },
    ]);
    pump();
    longPress('Mine');
    longPress('Sending');
    expect(quickRow()).toHaveLength(0);
    expect(screen.getByText('Mine').props.accessibilityActions).toBeUndefined();
  });

  it('is not offered while the socket is down or the workspace takes no messages', () => {
    setMessages([msg('a1', 'agent', 'Hello', [{ emoji: '👍', by: 'customer' }])]);
    setConnection('disconnected');
    pump();
    longPress('Hello');
    expect(quickRow()).toHaveLength(0);
    // The chip still says what the visitor did — it just cannot take it back.
    expect(screen.queryByRole('button', { name: 'Your reaction: 👍' })).toBeNull();
    expect(screen.getByLabelText('Your reaction: 👍')).toBeTruthy();
    cleanup();

    setConnection('connected');
    setVisitorMode('NOTICE_ONLY');
    pump();
    longPress('Hello');
    expect(quickRow()).toHaveLength(0);
  });

  it('runs from the leading edge, mirrored in RTL, on the page’s own ground', () => {
    setMessages([msg('a1', 'agent', 'مرحبا')]);
    pump('ar', true);
    longPress('مرحبا');
    const row = quickRow()[0]!.children[0] as ReactTestInstance;
    expect(styleOf(row)).toMatchObject({ flexDirection: 'row-reverse', backgroundColor: RTL_THEME.background });
    // Its close says so in the visitor's language.
    expect(screen.getByRole('button', { name: 'إغلاق' })).toBeTruthy();
  });
});
