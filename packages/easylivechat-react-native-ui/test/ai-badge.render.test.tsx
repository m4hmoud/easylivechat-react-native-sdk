import { cleanup, render, screen } from '@testing-library/react-native';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { DirectionProvider } from '../src/direction';
import { stringsFor } from '../src/l10n';
import { AiBadge, MessageBubble } from '../src/views/message-bubble';
import { RTL_THEME, THEME, leftToRight, message, rowOf, runsRightToLeft, styleOf } from './support';

/**
 * Port of `ai_badge_widget_test.dart`: every assistant reply says it is
 * automated.
 *
 * The SDK drew BOT messages exactly like a colleague's, and with agent names
 * switched off — a common tenant choice — like nobody's at all. The web widget
 * badges them; a visitor decides whether to trust an answer, wait for a person
 * or repeat themselves based on who they think is talking.
 */
describe('the AI badge', () => {
  afterEach(cleanup);

  const reply = (
    senderType: 'agent' | 'bot',
    { name, assistant = false, jobTitle }: { name?: string; assistant?: boolean; jobTitle?: string } = {},
  ) =>
    message({
      senderType,
      body: 'The Pro plan is $15 per month.',
      ...(name != null ? { senderName: name } : {}),
      ...(jobTitle != null ? { senderJobTitle: jobTitle } : {}),
      ...(assistant ? { metadata: { assistant: true } } : {}),
    });

  function pump(
    m: ReturnType<typeof reply>,
    { showAgentName = false, locale = 'en', rtl = false }: { showAgentName?: boolean; locale?: string; rtl?: boolean } = {},
  ) {
    render(
      <DirectionProvider value={rtl ? 'rtl' : 'ltr'}>
        <MessageBubble
          message={m}
          theme={rtl ? RTL_THEME : THEME}
          showAgentName={showAgentName}
          showAgentAvatar={false}
          strings={stringsFor(locale)}
          agentLastReadAt={null}
          onOpenImage={() => undefined}
        />
      </DirectionProvider>,
    );
  }

  const badges = () => screen.UNSAFE_queryAllByType(AiBadge);

  it('an assistant reply carries its name and an AI badge, names off or not', () => {
    pump(reply('bot', { name: 'eMenu Assistant', assistant: true }));
    expect(badges()).toHaveLength(1);
    expect(screen.getByText('AI')).toBeTruthy();
    expect(screen.getByText('eMenu Assistant')).toBeTruthy();
  });

  it('carries them with names on too, and only once', () => {
    pump(reply('bot', { name: 'eMenu Assistant', assistant: true }), { showAgentName: true });
    expect(badges()).toHaveLength(1);
    expect(screen.getAllByText('eMenu Assistant')).toHaveLength(1);
  });

  it('the badge stands on its own when the assistant has no name', () => {
    pump(reply('bot', { assistant: true }));
    expect(badges()).toHaveLength(1);
    // Nothing but the badge on that line: no empty name, no stray spacer.
    const line = rowOf(screen.getByText('AI'));
    expect(leftToRight(line)).toEqual(['AI']);
    expect(line.children).toHaveLength(1);
  });

  it('the automatic greeting is not badged', () => {
    // A greeting is a BOT message too. Seen on zirak, which never switched the
    // assistant on: "Zirak · AI" above its own greeting.
    pump(reply('bot', { name: 'Zirak' }), { showAgentName: true });
    expect(badges()).toHaveLength(0);
    expect(screen.queryByText('AI')).toBeNull();
  });

  it('a person is never badged', () => {
    pump(reply('agent', { name: 'Sam' }), { showAgentName: true });
    expect(badges()).toHaveLength(0);
    expect(screen.getByText('Sam')).toBeTruthy();
  });

  it('a person flagged as the assistant is still not badged', () => {
    // Only a BOT message can be the assistant's; stray metadata on an agent's
    // reply must not turn a colleague into a machine.
    pump(reply('agent', { name: 'Sam', assistant: true }), { showAgentName: true });
    expect(badges()).toHaveLength(0);
  });

  it("the badge is in the visitor's language", () => {
    pump(reply('bot', { name: 'eMenu', assistant: true }), { locale: 'ar' });
    expect(screen.getByText('ذكاء اصطناعي')).toBeTruthy();
  });

  it('is drawn in the accent, on a tint of it', () => {
    pump(reply('bot', { name: 'eMenu', assistant: true }));
    const [badge] = badges();
    expect(styleOf(screen.getByText('AI')).color).toBe(THEME.primary);
    const pill = badge!.findAll((n) => typeof n.type === 'string')[0]!;
    expect(styleOf(pill).backgroundColor).not.toBe(THEME.primary);
    expect(styleOf(pill).borderRadius).toBe(999);
  });

  it('follows the name from the left in English', () => {
    pump(reply('bot', { name: 'eMenu Assistant', assistant: true }));
    const line = rowOf(screen.getByText('eMenu Assistant'));
    expect(runsRightToLeft(line)).toBe(false);
    expect(leftToRight(line)).toEqual(['eMenu Assistant', 'AI']);
  });

  it('follows the name from the right in Arabic', () => {
    pump(reply('bot', { name: 'مساعد إي منيو', assistant: true }), { locale: 'ar', rtl: true });
    const line = rowOf(screen.getByText('ذكاء اصطناعي'));
    expect(runsRightToLeft(line)).toBe(true);
    // Leading in RTL is the right: on screen the badge, then the name.
    expect(leftToRight(line)).toEqual(['ذكاء اصطناعي', 'مساعد إي منيو']);
  });

  it('names the assistant without a job title beside it', () => {
    // The badge says what it is; "Assistant · Support Lead" would say a person.
    pump(reply('bot', { name: 'eMenu Assistant', jobTitle: 'Support Lead', assistant: true }), {
      showAgentName: true,
    });
    expect(screen.getByText('eMenu Assistant')).toBeTruthy();
    expect(screen.queryByText('eMenu Assistant · Support Lead')).toBeNull();
  });
});
