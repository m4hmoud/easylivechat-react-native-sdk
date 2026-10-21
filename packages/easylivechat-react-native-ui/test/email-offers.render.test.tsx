import { EasyLiveChat, EasyLiveChatError, type VisitorEmailState } from '@easylivechat/react-native';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AfterChatEmailOffer,
  ChatEmailOffers,
  EasyLiveChatEmailTranscriptButton,
  __resetEmailOffers,
} from '../src/email-offers';
import { isolate } from '../src/direction';
import { __resetOverrides, stringsFor } from '../src/l10n';
import {
  THEME,
  bootOffline,
  flush,
  message,
  setAgentsAccepting,
  setAvailability,
  setConversation,
  setEmailOffers,
  setMessages,
  setPhase,
  setQueue,
  setVisitorMode,
} from './support';

/**
 * When the two email cards appear — the web widget's rules (Embed.tsx §7b):
 * "Email me this chat" once there is a conversation with something in it,
 * and on the screen after the chat; "Get the reply by email" once the visitor
 * has written while nobody can answer, to someone with no address on file,
 * once per conversation, never while the workspace takes no messages. Each
 * only while its switch is on.
 */
const strings = stringsFor('en');
const HINT = 'j•••@example.com';

function state(emailHint: string | null): VisitorEmailState {
  return { emailHint, unsubscribed: false, transcriptEnabled: true, replyEmailEnabled: true };
}

let visitorEmail: ReturnType<typeof vi.fn>;

function offers(): void {
  render(<ChatEmailOffers theme={THEME} strings={strings} />);
}

const customer = message({ id: 'm1', senderType: 'customer', body: 'Is anyone there?' });
const greeting = message({ id: 'g1', senderType: 'bot', body: 'Hi! How can we help?' });
const notice = message({ id: 's1', senderType: 'system', body: 'New chat' });

beforeAll(bootOffline);
afterAll(() => EasyLiveChat.instance.shutdown());
beforeEach(() => {
  visitorEmail = vi.fn(async () => state(null));
  vi.spyOn(EasyLiveChat.instance, 'visitorEmail').mockImplementation(visitorEmail as never);
  setPhase('chat');
  setConversation('c1');
  setEmailOffers({ transcript: true, reply: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  __resetEmailOffers();
  __resetOverrides();
  setMessages([]);
  setQueue(null);
  setAvailability();
  setAgentsAccepting(true);
  setVisitorMode('CHAT');
  setEmailOffers({});
  setConversation(null);
  setPhase('idle');
});

describe('Get the reply by email', () => {
  it('is asked once the visitor has written while the team is closed', async () => {
    setAvailability({ reason: 'AFTER_HOURS' });
    setMessages([greeting, customer]);
    offers();
    await flush();
    expect(screen.getByText('Get the reply by email')).toBeTruthy();
  });

  it('is asked while they wait in the queue, and while nobody is accepting', async () => {
    setQueue({ position: 2, minutes: 5, text: '' });
    setMessages([customer]);
    offers();
    await flush();
    expect(screen.getByText('Get the reply by email')).toBeTruthy();
    cleanup();
    __resetEmailOffers();
    setQueue(null);
    setAgentsAccepting(false);
    offers();
    await flush();
    expect(screen.getByText('Get the reply by email')).toBeTruthy();
  });

  it('waits until they have written', async () => {
    setAvailability({ reason: 'AFTER_HOURS' });
    setMessages([greeting]);
    offers();
    await flush();
    expect(screen.queryByText('Get the reply by email')).toBeNull();
  });

  it('is not asked while someone can answer', async () => {
    setMessages([customer]);
    offers();
    await flush();
    expect(screen.queryByText('Get the reply by email')).toBeNull();
  });

  it('is not asked of a visitor whose contact has an address', async () => {
    visitorEmail.mockImplementation(async () => state(HINT));
    setAvailability({ reason: 'AFTER_HOURS' });
    setMessages([customer]);
    offers();
    await flush();
    expect(screen.queryByText('Get the reply by email')).toBeNull();
  });

  it('is not asked while the workspace takes no messages, nor with its switch off', async () => {
    setAvailability({ reason: 'AFTER_HOURS' });
    setMessages([customer]);
    setVisitorMode('NOTICE_ONLY');
    offers();
    await flush();
    expect(screen.queryByText('Get the reply by email')).toBeNull();
    cleanup();
    setVisitorMode('CHAT');
    setEmailOffers({ transcript: true, reply: false });
    offers();
    await flush();
    expect(screen.queryByText('Get the reply by email')).toBeNull();
  });

  it('is asked once per conversation, answered or put away', async () => {
    setAvailability({ reason: 'AFTER_HOURS' });
    setMessages([customer]);
    offers();
    await flush();
    fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    await flush();
    expect(screen.queryByText('Get the reply by email')).toBeNull();
    // The screen again, later in the same run of the app.
    cleanup();
    offers();
    await flush();
    expect(screen.queryByText('Get the reply by email')).toBeNull();
    // A new conversation is asked again.
    cleanup();
    setConversation('c2');
    offers();
    await flush();
    expect(screen.getByText('Get the reply by email')).toBeTruthy();
  });

  it('keeps the address on the contact and says so', async () => {
    const save = vi
      .spyOn(EasyLiveChat.instance, 'setVisitorEmail')
      .mockResolvedValue({ emailHint: HINT });
    setAvailability({ reason: 'AFTER_HOURS' });
    setMessages([customer]);
    offers();
    await flush();
    fireEvent.changeText(screen.getByLabelText('Your email'), 'jo@example.com');
    fireEvent.press(screen.getByRole('button', { name: 'Email me' }));
    await flush();
    expect(save).toHaveBeenCalledWith('jo@example.com');
    expect(screen.getByText(`We'll email ${isolate(HINT)} if you've left by the time we reply.`)).toBeTruthy();
  });

  it('words a refusal as the widget does', async () => {
    vi.spyOn(EasyLiveChat.instance, 'setVisitorEmail').mockRejectedValue(
      new EasyLiveChatError('EMAIL_UNSUBSCRIBED', { httpStatus: 409 }),
    );
    setAvailability({ reason: 'AFTER_HOURS' });
    setMessages([customer]);
    offers();
    await flush();
    fireEvent.changeText(screen.getByLabelText('Your email'), 'jo@example.com');
    fireEvent.press(screen.getByRole('button', { name: 'Email me' }));
    await flush();
    expect(screen.getByText('This address has unsubscribed from our emails.')).toBeTruthy();
  });
});

describe('Email me this chat', () => {
  function bar(): void {
    render(
      <>
        <EasyLiveChatEmailTranscriptButton />
        <ChatEmailOffers theme={THEME} strings={strings} />
      </>,
    );
  }

  it('is on offer once the conversation has something in it', async () => {
    setMessages([notice]);
    bar();
    expect(screen.queryByRole('button', { name: 'Email me this chat' })).toBeNull();
    cleanup();
    setMessages([notice, greeting]);
    bar();
    expect(screen.getByRole('button', { name: 'Email me this chat' })).toBeTruthy();
  });

  it('is not on offer with the switch off, or with no conversation', () => {
    setMessages([greeting]);
    setEmailOffers({ transcript: false, reply: true });
    bar();
    expect(screen.queryByRole('button', { name: 'Email me this chat' })).toBeNull();
    cleanup();
    setEmailOffers({ transcript: true });
    setConversation(null);
    bar();
    expect(screen.queryByRole('button', { name: 'Email me this chat' })).toBeNull();
  });

  it('opens its card above the thread, and sends to the address on file', async () => {
    visitorEmail.mockImplementation(async () => state(HINT));
    const send = vi
      .spyOn(EasyLiveChat.instance, 'emailTranscript')
      .mockResolvedValue({ sentTo: HINT });
    setMessages([greeting, customer]);
    bar();
    await flush();
    act(() => {
      fireEvent.press(screen.getByRole('button', { name: 'Email me this chat' }));
    });
    await flush();
    expect(screen.getByText(`We'll send a copy to ${isolate(HINT)}.`)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await flush();
    expect(send).toHaveBeenCalledWith({});
    expect(screen.getByText(`Sent to ${isolate(HINT)}.`)).toBeTruthy();
  });

  it('asks for an address when the server finds none on file after all', async () => {
    visitorEmail.mockImplementation(async () => state(HINT));
    vi.spyOn(EasyLiveChat.instance, 'emailTranscript').mockRejectedValue(
      new EasyLiveChatError('NO_CONTACT_EMAIL', { httpStatus: 400 }),
    );
    setMessages([greeting]);
    bar();
    await flush();
    act(() => {
      fireEvent.press(screen.getByRole('button', { name: 'Email me this chat' }));
    });
    await flush();
    fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await flush();
    expect(screen.getByText('Enter a valid email address')).toBeTruthy();
  });

  it('words a refusal for asking too often', async () => {
    vi.spyOn(EasyLiveChat.instance, 'emailTranscript').mockRejectedValue(
      new EasyLiveChatError('TRANSCRIPT_RATE_LIMITED', { httpStatus: 429 }),
    );
    setMessages([greeting]);
    bar();
    await flush();
    act(() => {
      fireEvent.press(screen.getByRole('button', { name: 'Email me this chat' }));
    });
    await flush();
    fireEvent.changeText(screen.getByLabelText('Your email'), 'jo@example.com');
    fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await flush();
    expect(screen.getByText("You've asked for this chat a few times already. Try again later.")).toBeTruthy();
  });

  it('is offered on the screen after the chat, for the one that just ended', async () => {
    const send = vi
      .spyOn(EasyLiveChat.instance, 'emailTranscript')
      .mockResolvedValue({ sentTo: HINT });
    visitorEmail.mockImplementation(async () => state(HINT));
    setPhase('feedback');
    render(<AfterChatEmailOffer theme={THEME} strings={strings} />);
    fireEvent.press(screen.getByRole('button', { name: 'Email me this chat' }));
    await flush();
    fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await flush();
    expect(send).toHaveBeenCalledWith({});
    expect(screen.getByText(`Sent to ${isolate(HINT)}.`)).toBeTruthy();
  });

  it('is not offered after the chat with the switch off', () => {
    setEmailOffers({ transcript: false });
    setPhase('feedback');
    render(<AfterChatEmailOffer theme={THEME} strings={strings} />);
    expect(screen.queryByRole('button', { name: 'Email me this chat' })).toBeNull();
  });
});
