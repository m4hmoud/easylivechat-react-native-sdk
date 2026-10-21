import { type ChatMessage, EasyLiveChat } from '@easylivechat/react-native';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DirectionProvider } from '../src/direction';
import { __resetRecentEmoji } from '../src/emoji/emoji';
import { __resetOverrides, stringsFor } from '../src/l10n';
import { EmojiPicker } from '../src/views/emoji-picker';
import { ThreadView } from '../src/views/thread-view';
import {
  RTL_THEME,
  THEME,
  bootOffline,
  message,
  rowOf,
  runsRightToLeft,
  setConnection,
  setMessages,
} from './support';

/**
 * The whole emoji picker — the web widget's `EmojiPicker.tsx`: a search over
 * the emoji's names, category tabs, the grid, the recently used first — and
 * the + in the quick reaction row that opens it.
 */
function picker(onPick = vi.fn(), locale = 'en', rtl = false) {
  render(
    <DirectionProvider value={rtl ? 'rtl' : 'ltr'}>
      <EmojiPicker theme={rtl ? RTL_THEME : THEME} strings={stringsFor(locale)} onPick={onPick} />
    </DirectionProvider>,
  );
  return onPick;
}

const search = () => screen.getByLabelText('Search emoji');

afterEach(() => {
  cleanup();
  __resetRecentEmoji();
  __resetOverrides();
});

describe('search', () => {
  it('matches the emoji’s names as the web does, and a tap picks one', () => {
    const onPick = picker();
    fireEvent.changeText(search(), 'pizz');
    fireEvent.press(screen.getByText('🍕'));
    expect(onPick).toHaveBeenCalledWith('🍕');
  });

  it('shows only the matches while there is a query, the grid put by', () => {
    picker();
    expect(screen.queryByLabelText('Results')).toBeNull();
    fireEvent.changeText(search(), 'joy');
    const results = within(screen.getByLabelText('Results'));
    expect(results.getAllByText('😂').length).toBeGreaterThan(0);
    // A flag far down the table is no match.
    expect(results.queryByText('🇩🇪')).toBeNull();
  });

  it('says so when nothing matches', () => {
    picker();
    fireEvent.changeText(search(), 'zzzqqq');
    expect(screen.getByText('No emoji found')).toBeTruthy();
  });

  it('picks the first match from the keyboard', () => {
    const onPick = picker();
    fireEvent.changeText(search(), 'joy');
    fireEvent(search(), 'submitEditing');
    expect(onPick).toHaveBeenCalledWith('😂');
  });

  it('clears, back to the grid', () => {
    picker();
    fireEvent.changeText(search(), 'zzzqqq');
    fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.queryByText('No emoji found')).toBeNull();
    expect(search().props.value).toBe('');
  });

  it('is worded in the visitor’s language', () => {
    picker(vi.fn(), 'ckb');
    expect(screen.getByLabelText('گەڕان بۆ ئیمۆجی')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ئاڵاکان' })).toBeTruthy();
  });
});

describe('the tabs and the recent row', () => {
  it('has a tab per category, named, and a tab clears the search', () => {
    picker();
    for (const name of ['Smileys & emotion', 'People & body', 'Food & drink', 'Flags']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    // No recent tab before anything was picked.
    expect(screen.queryByRole('button', { name: 'Recently used' })).toBeNull();
    fireEvent.changeText(search(), 'zzzqqq');
    fireEvent.press(screen.getByRole('button', { name: 'Flags' }));
    expect(search().props.value).toBe('');
    expect(screen.getByRole('button', { name: 'Flags' }).props.accessibilityState).toEqual({ selected: true });
  });

  it('puts what was just used first, next time it opens', () => {
    picker();
    fireEvent.changeText(search(), 'pizz');
    fireEvent.press(screen.getByText('🍕'));
    cleanup();
    picker();
    expect(screen.getByRole('button', { name: 'Recently used' }).props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByText('Recently used')).toBeTruthy();
  });

  it('fills each row from the chat’s own start — right to left in Arabic', () => {
    picker(vi.fn(), 'ar', true);
    expect(runsRightToLeft(rowOf(screen.getAllByText('😀')[0]!))).toBe(true);
    cleanup();
    picker();
    expect(runsRightToLeft(rowOf(screen.getAllByText('😀')[0]!))).toBe(false);
  });
});

describe('from the quick reaction row', () => {
  let react: { mock: { calls: unknown[][] } };
  const team = (): ChatMessage =>
    message({ id: 'a1', senderType: 'agent', body: 'Your order shipped', createdAt: new Date(Date.UTC(2026, 9, 18, 10)).toISOString() });

  beforeAll(bootOffline);
  afterAll(() => EasyLiveChat.instance.shutdown());
  beforeEach(() => {
    setConnection('connected');
    react = vi.spyOn(EasyLiveChat.instance, 'react').mockResolvedValue(true);
  });
  afterEach(() => {
    setMessages([]);
    setConnection('disconnected');
    vi.restoreAllMocks();
  });

  function openRow(): void {
    setMessages([team()]);
    render(<ThreadView theme={THEME} strings={stringsFor('en')} />);
    fireEvent(screen.getByText('Your order shipped'), 'longPress');
  }

  it('a + opens the whole picker, and a pick reacts and puts both away', () => {
    openRow();
    fireEvent.press(screen.getByRole('button', { name: 'More reactions' }));
    expect(screen.getByLabelText('Search emoji')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Search emoji'), 'pizz');
    act(() => {
      fireEvent.press(screen.getByText('🍕'));
    });
    expect(react).toHaveBeenCalledWith('a1', '🍕');
    expect(screen.queryByLabelText('Search emoji')).toBeNull();
    expect(screen.queryByRole('button', { name: 'More reactions' })).toBeNull();
  });

  it('a tap above the sheet puts it away and leaves the row', () => {
    openRow();
    fireEvent.press(screen.getByRole('button', { name: 'More reactions' }));
    // The backdrop is the sheet's "close"; the row's own close is the other.
    const closes = screen.getAllByRole('button', { name: 'Close' });
    fireEvent.press(closes[closes.length - 1]!);
    expect(screen.queryByLabelText('Search emoji')).toBeNull();
    expect(screen.getByRole('button', { name: 'More reactions' })).toBeTruthy();
    expect(react).not.toHaveBeenCalled();
  });
});
