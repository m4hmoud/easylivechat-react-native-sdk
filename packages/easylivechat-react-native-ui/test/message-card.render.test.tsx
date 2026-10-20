import { type ChatMessage, EasyLiveChat } from '@easylivechat/react-native';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import * as RN from 'react-native';
import { Linking } from 'react-native';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DirectionProvider } from '../src/direction';
import { stringsFor } from '../src/l10n';
import type { EasyLiveChatTheme } from '../src/theme';
import { LinkifiedText } from '../src/views/linkified-text';
import { MessageBubble } from '../src/views/message-bubble';
import { CardCarousel, CardView, ReplyChips } from '../src/views/message-extras-view';
import { RemoteImage } from '../src/views/remote-image';
import { bootOffline, isHost, message, styleOf } from './support';

/**
 * Port of `message_card_widget_test.dart` and `reply_buttons_widget_test.dart`.
 *
 * A card is a message from the team with an image, a title, text and buttons.
 * What is pinned: the card replaces the plain-text version it carries rather
 * than joining it, its link buttons open their links and nothing but
 * http(s), its reply buttons answer, it wears the team's bubble in either
 * direction — and a message's reply buttons draw under its own words, never
 * ALSO the numbered menu its body carries for older clients.
 */
const THEME: EasyLiveChatTheme = {
  primary: '#0E7C66',
  background: '#FFFFFF',
  surface: '#F2F0EB',
  text: '#1B1B1B',
  direction: 'ltr',
};

const FALLBACK =
  'Order #1042 is on its way\nArriving Friday.\n\n' +
  'Track parcel: https://shop.example/t/1042\nHelp: https://shop.example/help';

const CARD = {
  imageUrl: '/uploads/t1/2026-09/parcel.png',
  title: 'Order #1042 is on its way',
  text: 'Arriving Friday.',
  buttons: [
    { label: 'Track parcel', url: 'https://shop.example/t/1042' },
    { label: 'Help', url: 'https://shop.example/help' },
  ],
};

function cardMessage({
  card = CARD as Record<string, unknown>,
  metadata,
  attachmentUrls = ['/uploads/t1/2026-09/parcel.png'],
  contentType = 'CARD',
}: {
  card?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  attachmentUrls?: string[];
  contentType?: string;
} = {}): ChatMessage {
  return message({
    id: 'card-1',
    body: FALLBACK,
    senderName: 'Sam',
    contentType,
    attachmentUrls,
    metadata: metadata ?? { card },
  });
}

function pump(
  m: ChatMessage,
  {
    rtl = false,
    theme = THEME,
    showButtons = false,
    chosenButtonId = null,
    onButton = null,
  }: {
    rtl?: boolean;
    theme?: EasyLiveChatTheme;
    showButtons?: boolean;
    chosenButtonId?: string | null;
    onButton?: ((id: string, label: string) => void) | null;
  } = {},
) {
  render(
    <DirectionProvider value={rtl ? 'rtl' : 'ltr'}>
      <MessageBubble
        message={m}
        theme={{ ...theme, direction: rtl ? 'rtl' : 'ltr' }}
        showAgentName
        showAgentAvatar={false}
        strings={stringsFor('en')}
        agentLastReadAt={null}
        onOpenImage={() => undefined}
        showButtons={showButtons}
        chosenButtonId={chosenButtonId}
        onButton={onButton}
      />
    </DirectionProvider>,
  );
}

const openURL = Linking.openURL as unknown as ReturnType<typeof vi.fn>;

beforeAll(bootOffline);
afterAll(() => EasyLiveChat.instance.shutdown());
beforeEach(() => openURL.mockClear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a card', () => {
  it('draws the title, text and buttons — and not the text version it carries', () => {
    pump(cardMessage());
    expect(screen.UNSAFE_queryAllByType(CardView)).toHaveLength(1);
    expect(screen.getByText('Order #1042 is on its way')).toBeTruthy();
    expect(screen.getByText('Arriving Friday.')).toBeTruthy();
    expect(screen.getByText('Track parcel')).toBeTruthy();
    expect(screen.getByText('Help')).toBeTruthy();
    // The plain-text version is for clients that can't draw a card.
    expect(screen.UNSAFE_queryAllByType(LinkifiedText)).toHaveLength(0);
    expect(screen.queryByText(/https:\/\/shop\.example/)).toBeNull();
    expect(screen.queryByText(/Track parcel:/)).toBeNull();
  });

  it('shows its image once, on top, 16:9 — not again as an attachment', () => {
    pump(cardMessage());
    const images = screen.UNSAFE_getAllByType(RemoteImage);
    expect(images).toHaveLength(1);
    // Our own upload, resolved against the API like every attachment.
    expect(images[0]!.props.uri).toBe('https://api.example.com/uploads/t1/2026-09/parcel.png');
    expect(images[0]!.props.contentFit).toBe('cover');
    expect(images[0]!.props.style).toMatchObject({ aspectRatio: 16 / 9 });
    // Above the title: the first thing in the card.
    const card = screen.UNSAFE_getByType(CardView);
    const host = card.findAll((n) => isHost(n, 'View'))[0]!;
    expect((host.children[0] as typeof card).type).toBe(RemoteImage);
  });

  it('a card without an image draws none, and still no attachment', () => {
    pump(
      cardMessage({
        card: { title: 'Your refund is on its way', buttons: [{ label: 'See details', url: 'https://shop.example/r/7' }] },
        attachmentUrls: [],
      }),
    );
    expect(screen.UNSAFE_queryAllByType(RemoteImage)).toHaveLength(0);
    expect(screen.getByText('See details')).toBeTruthy();
  });

  it('a button opens its link in the browser', () => {
    pump(cardMessage());
    fireEvent.press(screen.getByText('Track parcel'));
    expect(openURL.mock.calls).toEqual([['https://shop.example/t/1042']]);
  });

  it('each button is a link of its own to a screen reader', () => {
    pump(cardMessage());
    for (const label of ['Track parcel', 'Help']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
  });

  it('a javascript: link in the row is never drawn, let alone opened', () => {
    pump(
      cardMessage({
        card: {
          title: 'Hello',
          buttons: [
            { label: 'Bad', url: 'javascript:alert(1)' },
            { label: 'Good', url: 'https://ok.example' },
          ],
        },
      }),
    );
    expect(screen.queryByText('Bad')).toBeNull();
    fireEvent.press(screen.getByText('Good'));
    expect(openURL.mock.calls).toEqual([['https://ok.example']]);
  });

  it('a CARD message whose card does not validate reads as its text', () => {
    pump(cardMessage({ card: { text: 'no title' }, attachmentUrls: [] }));
    expect(screen.UNSAFE_queryAllByType(CardView)).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(LinkifiedText)).toHaveLength(1);
    expect(screen.getByText(/Track parcel: /)).toBeTruthy();
  });

  it('card metadata on a message that is not a CARD is ignored', () => {
    pump(cardMessage({ contentType: 'TEXT', attachmentUrls: [] }));
    expect(screen.UNSAFE_queryAllByType(CardView)).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(LinkifiedText)).toHaveLength(1);
  });

  it('wears the team bubble: the same surface, outline and tail', () => {
    pump(cardMessage());
    const cardBox = styleOf(screen.UNSAFE_getByType(CardView).children[0] as never);

    cleanup();
    pump(message({ id: 't1', body: 'hello' }));
    const bubble = screen
      .UNSAFE_getAllByType(RN.View)
      .map((v) => styleOf(v))
      .find((s) => s.backgroundColor === THEME.surface)!;

    for (const key of [
      'backgroundColor',
      'borderWidth',
      'borderColor',
      'borderTopStartRadius',
      'borderTopEndRadius',
      'borderBottomStartRadius',
      'borderBottomEndRadius',
    ]) {
      expect(cardBox[key], key).toBe(bubble[key]);
    }
    // The tail: the team's corner, at the bottom of their (leading) side.
    expect(cardBox.borderBottomStartRadius).toBe(4);
    expect(cardBox.borderBottomEndRadius).toBe(16);
  });

  it('the tail sits on the team side in RTL too — and the card stands on that side', () => {
    // An RTL chat inside an LTR app: start/end resolve against the APP, so
    // the team's corner is written as `end` here, which the engine puts on the
    // right — the team's side in Arabic.
    pump(cardMessage(), { rtl: true });
    const cardBox = styleOf(screen.UNSAFE_getByType(CardView).children[0] as never);
    expect(cardBox.borderBottomEndRadius).toBe(4);
    expect(cardBox.borderBottomStartRadius).toBe(16);
    // The column it sits in hugs the right edge.
    const column = screen
      .UNSAFE_getAllByType(RN.View)
      .find((v) => v.findAllByType(CardView).length > 0 && styleOf(v).alignItems != null)!;
    expect(styleOf(column).alignItems).toBe('flex-end');
  });

  it('its buttons wear the workspace accent', () => {
    const pink: EasyLiveChatTheme = {
      primary: '#DB2777',
      background: '#111827',
      surface: '#1F2937',
      text: '#F9FAFB',
      direction: 'ltr',
    };
    pump(cardMessage(), { theme: pink });
    expect(styleOf(screen.getByText('Track parcel'))).toMatchObject({ color: pink.primary });
    expect(styleOf(screen.getByText('Order #1042 is on its way'))).toMatchObject({ color: pink.text });
  });

  it('is 280 wide, or narrower on a phone that cannot fit that', () => {
    pump(cardMessage());
    expect(styleOf(screen.UNSAFE_getByType(CardView).children[0] as never).width).toBe(280);
    cleanup();

    vi.spyOn(RN, 'useWindowDimensions').mockReturnValue({ width: 300, height: 800, scale: 2, fontScale: 1 });
    pump(cardMessage());
    // What the row leaves: 300 less its 12 + 12 of padding.
    expect(styleOf(screen.UNSAFE_getByType(CardView).children[0] as never).width).toBe(276);
  });

  it('each run of text faces the way it reads', () => {
    pump(
      cardMessage({
        card: {
          title: 'داواکاریەکەت نێردرا',
          text: 'Arriving Friday.',
          buttons: [{ label: 'بەدواداچوون', url: 'https://shop.example/t' }],
        },
      }),
    );
    expect(styleOf(screen.getByText('داواکاریەکەت نێردرا'))).toMatchObject({
      writingDirection: 'rtl',
      textAlign: 'right',
    });
    expect(styleOf(screen.getByText('Arriving Friday.'))).toMatchObject({ writingDirection: 'ltr' });
    expect(styleOf(screen.getByText('بەدواداچوون'))).toMatchObject({ writingDirection: 'rtl' });
  });
});

describe('reply buttons', () => {
  const MENU = 'Call you?\n\n1. Yes\n2. No\n\nReply with the number of your choice.';
  const asked = () =>
    message({
      id: 'm1',
      body: MENU,
      metadata: {
        bot: {
          text: 'Call you?',
          buttons: [
            { id: 'q_1', label: 'Yes' },
            { id: 'q_2', label: 'No' },
          ],
        },
        quickReplies: ['Yes', 'No'],
      },
    });

  it('draws the words and the buttons — not the numbered menu as well', () => {
    pump(asked(), { showButtons: true, onButton: () => undefined });
    expect(screen.getByText('Call you?')).toBeTruthy();
    expect(screen.queryByText(/1\. Yes/)).toBeNull();
    expect(screen.UNSAFE_queryAllByType(ReplyChips)).toHaveLength(1);
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
  });

  it('a tap answers with the button’s id and label', () => {
    const taps: string[] = [];
    pump(asked(), { showButtons: true, onButton: (id, label) => taps.push(`${id}:${label}`) });
    fireEvent.press(screen.getByText('No'));
    expect(taps).toEqual(['q_2:No']);
  });

  it('once answered, the choice stays marked and nothing else answers', () => {
    pump(asked(), { showButtons: true, chosenButtonId: 'q_1' });
    expect(screen.UNSAFE_getByType(ReplyChips).props.chosen).toBe('Yes');
    expect(screen.getByRole('button', { name: 'Yes' }).props.accessibilityState).toMatchObject({
      selected: true,
      disabled: true,
    });
    expect(screen.getByRole('button', { name: 'No' }).props.accessibilityState).toMatchObject({
      selected: false,
      disabled: true,
    });
  });

  it('without buttons switched on it reads as its text, as an older client does', () => {
    pump(asked(), { showButtons: false });
    expect(screen.UNSAFE_queryAllByType(ReplyChips)).toHaveLength(0);
    expect(screen.getByText(/1\. Yes/)).toBeTruthy();
  });

  it('a card’s reply button answers, with the label the message gives it', () => {
    const taps: string[] = [];
    pump(
      cardMessage({
        attachmentUrls: [],
        metadata: {
          card: {
            title: 'Order #1042',
            buttons: [
              { label: 'Track', url: 'https://e.example/t' },
              { label: 'Change date', reply: 'k9_1' },
            ],
          },
          bot: { text: 'Order #1042', buttons: [{ id: 'k9_1', label: 'Change date' }] },
        },
      }),
      { showButtons: true, onButton: (id, label) => taps.push(`${id}:${label}`) },
    );
    // On the card, not as chips under it.
    expect(screen.UNSAFE_queryAllByType(ReplyChips)).toHaveLength(0);
    fireEvent.press(screen.getByText('Change date'));
    expect(taps).toEqual(['k9_1:Change date']);
  });

  it('a carousel draws every card, and an answer names its card', () => {
    const taps: string[] = [];
    pump(
      cardMessage({
        attachmentUrls: [],
        metadata: {
          cards: [
            { title: 'Blue', buttons: [{ label: 'Buy', reply: 's_1' }] },
            { title: 'Red', buttons: [{ label: 'Buy', reply: 's_2' }] },
          ],
          bot: {
            text: 'Blue\n\nRed',
            buttons: [
              { id: 's_1', label: 'Blue · Buy' },
              { id: 's_2', label: 'Red · Buy' },
            ],
          },
        },
      }),
      { showButtons: true, onButton: (id, label) => taps.push(`${id}:${label}`) },
    );
    expect(screen.UNSAFE_queryAllByType(CardCarousel)).toHaveLength(1);
    expect(screen.UNSAFE_queryAllByType(CardView)).toHaveLength(2);
    expect(screen.getByLabelText('Cards')).toBeTruthy();
    const buys = screen.getAllByText('Buy');
    fireEvent.press(buys[buys.length - 1]!);
    expect(taps).toEqual(['s_2:Red · Buy']);
  });
});
