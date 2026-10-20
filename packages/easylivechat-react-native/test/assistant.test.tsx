import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChat } from '../src/client';
import { useAgentTyping, useAssistantCovers, useAssistantTyping, useWorkspaceAvailability } from '../src/hooks';
import { type ChatMessage, isFromAssistant, parseChatMessage } from '../src/models/chat-message';
import type { SenderType } from '../src/models/enums';
import { parseConfigResponse, parseWorkspaceAvailability } from '../src/models/widget-config';
import { SessionController } from '../src/session-controller';
import { InMemoryStorage } from '../src/storage';
import { configBody, installFakeServer, messageRow, sessionBody, type FakeServer } from './fake-server';
import { latestSocket, resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * Port of `assistant_test.dart`: the AI assistant, as the SDK sees it.
 *
 * The server has answered SDK visitors with the assistant since it shipped —
 * the SDK talks to the same `/widgets` namespace as the web widget — but the
 * SDK read none of what the widget reads about it: every assistant reply
 * looked like a person's, the closed notice told a visitor to leave a message
 * while the assistant was about to answer, and the typing row vanished four
 * seconds into a reply that takes ten.
 */
describe('assistantCovers', () => {
  const config = (covers?: unknown): Record<string, unknown> =>
    configBody({
      isOpen: false,
      reason: 'AFTER_HOURS',
      ...(covers !== undefined ? { assistantCovers: covers } : {}),
    });

  it('is read from the config response', () => {
    expect(parseConfigResponse(config(true)).assistantCovers).toBe(true);
    expect(parseConfigResponse(config(false)).assistantCovers).toBe(false);
  });

  it('reads as false from a server that does not send it', () => {
    expect(parseConfigResponse(config()).assistantCovers).toBe(false);
    // Only a literal true: a stringly value is not a promise of an answer.
    expect(parseConfigResponse(config('true')).assistantCovers).toBe(false);
  });

  it('is read from a live availability push', () => {
    const a = parseWorkspaceAvailability({ isOpen: false, reason: 'NO_AGENTS', assistantCovers: true });
    expect(a.assistantCovers).toBe(true);
    expect(parseWorkspaceAvailability({ isOpen: true }).assistantCovers).toBe(false);
  });

  describe('on the controller', () => {
    let server: FakeServer;

    beforeEach(() => {
      resetFakeSockets();
      server = installFakeServer();
      server.always('/session', { body: sessionBody() });
    });

    afterEach(() => server.restore());

    const controller = (): SessionController =>
      new SessionController(
        { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
        new InMemoryStorage(),
      );

    it('follows the config fetch, the live push and a refresh', async () => {
      server.reply('/config', { body: config(true) });
      server.always('/config', { body: config(false) });
      const c = controller();
      await c.boot();
      await c.open();
      expect(c.assistantCovers.get()).toBe(true);

      // The assistant stops covering mid-session (the workspace switched it
      // off, or the shift it covered ended): the push says so.
      latestSocket('/widgets').fire('workspace:availability', {
        isOpen: false,
        reason: 'AFTER_HOURS',
        assistantCovers: false,
      });
      expect(c.assistantCovers.get()).toBe(false);

      latestSocket('/widgets').fire('workspace:availability', {
        isOpen: false,
        reason: 'NO_AGENTS',
        assistantCovers: true,
      });
      expect(c.assistantCovers.get()).toBe(true);

      await c.refreshAvailability();
      expect(c.assistantCovers.get()).toBe(false);
      c.dispose();
    });

    it('drops to false on a push from a server that predates it', async () => {
      server.always('/config', { body: config(true) });
      const c = controller();
      await c.boot();
      await c.open();
      latestSocket('/widgets').fire('workspace:availability', { isOpen: false });
      expect(c.assistantCovers.get()).toBe(false);
      c.dispose();
    });
  });
});

describe('isFromAssistant', () => {
  const m = (senderType: SenderType, metadata?: Record<string, unknown>): ChatMessage => ({
    id: 'm1',
    conversationId: 'c1',
    body: 'hi',
    senderType,
    contentType: 'text',
    attachmentUrls: [],
    attachments: [],
    deliveryStatus: 'sent',
    readByAgent: false,
    createdAt: new Date('2026-09-13T00:00:00.000Z'),
    isOptimistic: false,
    failed: false,
    metadata,
  });

  it("is true for a reply the server marked as the assistant's", () => {
    expect(isFromAssistant(m('bot', { assistant: true }))).toBe(true);
  });

  it('is false for the automatic greeting, which is a BOT message too', () => {
    // Seen on zirak, which never switched the assistant on: its greeting
    // arrived badged "AI".
    expect(isFromAssistant(m('bot'))).toBe(false);
    expect(isFromAssistant(m('bot', { i18n: { key: 'x' } }))).toBe(false);
    expect(isFromAssistant(m('bot', { assistant: 'true' }))).toBe(false);
  });

  it('is false for people', () => {
    expect(isFromAssistant(m('agent', { assistant: true }))).toBe(false);
    expect(isFromAssistant(m('customer'))).toBe(false);
  });

  it('survives the wire: parsed from the JSON the server sends', () => {
    const reply = parseChatMessage({
      id: 'm2',
      conversationId: 'c1',
      body: 'The Pro plan is $15.',
      senderType: 'BOT',
      contentType: 'TEXT',
      createdAt: '2026-09-13T10:00:00.000Z',
      metadata: { assistant: true },
    });
    const greeting = parseChatMessage({
      id: 'm3',
      conversationId: 'c1',
      body: 'Hello, how can I help?',
      senderType: 'BOT',
      contentType: 'TEXT',
      createdAt: '2026-09-13T10:00:00.000Z',
    });
    expect(isFromAssistant(reply)).toBe(true);
    expect(isFromAssistant(greeting)).toBe(false);
  });
});

describe('assistant typing', () => {
  let server: FakeServer;
  let c: SessionController;

  const assistantTyping = (isTyping: boolean): void =>
    latestSocket('/widgets').fire('agent:typing', { isTyping, actor: 'assistant' });
  const personTyping = (isTyping: boolean): void =>
    latestSocket('/widgets').fire('agent:typing', { isTyping });

  beforeEach(async () => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
    c = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      new InMemoryStorage(),
    );
    await c.boot();
    await c.open();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    c.dispose();
    server.restore();
  });

  it('shows the typing row, named for the assistant', () => {
    assistantTyping(true);
    expect(c.agentTyping.get()).toBe(true);
    expect(c.assistantTyping.get()).toBe(true);
  });

  it('clears on the explicit stop the assistant sends', () => {
    assistantTyping(true);
    assistantTyping(false);
    expect(c.agentTyping.get()).toBe(false);
    expect(c.assistantTyping.get()).toBe(false);
  });

  it('outlasts the 4-second clear meant for a person', () => {
    // The bug Flutter 0.1.51 fixed: read as a person's typing, the row
    // vanished halfway through a reply that takes ten seconds.
    assistantTyping(true);
    vi.advanceTimersByTime(12_000);
    expect(c.agentTyping.get()).toBe(true);
    expect(c.assistantTyping.get()).toBe(true);

    // …but a stop lost to a dropped connection does not leave it for ever.
    vi.advanceTimersByTime(45_000);
    expect(c.agentTyping.get()).toBe(false);
    expect(c.assistantTyping.get()).toBe(false);
  });

  it("is cleared by the assistant's own reply", () => {
    assistantTyping(true);
    latestSocket('/widgets').fire(
      'message:new',
      messageRow({ id: 'a1', senderType: 'BOT', body: 'Here you go', metadata: { assistant: true } }),
    );
    expect(c.agentTyping.get()).toBe(false);
    expect(c.assistantTyping.get()).toBe(false);
  });

  it('is not cleared by a message that is not the assistant answering', () => {
    assistantTyping(true);
    // The automatic greeting is a BOT message too.
    latestSocket('/widgets').fire('message:new', messageRow({ id: 'g1', senderType: 'BOT' }));
    expect(c.assistantTyping.get()).toBe(true);
  });

  it('gives way to a person typing, who keeps the short clear', () => {
    assistantTyping(true);
    personTyping(true);
    expect(c.agentTyping.get()).toBe(true);
    expect(c.assistantTyping.get()).toBe(false);
    vi.advanceTimersByTime(4_001);
    expect(c.agentTyping.get()).toBe(false);
  });

  it("leaves a person's typing as it was", () => {
    personTyping(true);
    expect(c.agentTyping.get()).toBe(true);
    expect(c.assistantTyping.get()).toBe(false);
    vi.advanceTimersByTime(4_001);
    expect(c.agentTyping.get()).toBe(false);
  });

  it('goes with the visitor on an identity switch', () => {
    c.identify({ userId: 'user-ada', userHash: 'ha' });
    assistantTyping(true);
    c.identify({ userId: 'user-grace', userHash: 'hg' });
    expect(c.agentTyping.get()).toBe(false);
    expect(c.assistantTyping.get()).toBe(false);
  });
});

describe('the facade and hooks', () => {
  let server: FakeServer;

  beforeEach(() => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody({ isOpen: false, assistantCovers: true }) });
    server.always('/session', { body: sessionBody() });
  });

  afterEach(() => {
    EasyLiveChat.instance.shutdown();
    server.restore();
  });

  it('expose assistant typing and cover the way agent typing is exposed', async () => {
    const seen: Array<{ typing: boolean; assistant: boolean; covers: boolean; viewCovers: boolean }> = [];
    function Probe(): React.ReactElement {
      seen.push({
        typing: useAgentTyping(),
        assistant: useAssistantTyping(),
        covers: useAssistantCovers(),
        viewCovers: useWorkspaceAvailability().assistantCovers,
      });
      return React.createElement('probe');
    }

    let tree: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      tree = TestRenderer.create(React.createElement(Probe));
    });
    // Safe before boot, like every hook.
    expect(seen.at(-1)).toEqual({ typing: false, assistant: false, covers: false, viewCovers: false });

    await act(async () => {
      await EasyLiveChat.instance.boot(
        { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
        { storage: new InMemoryStorage() },
      );
      await EasyLiveChat.instance.open();
    });
    expect(EasyLiveChat.instance.assistantCovers.get()).toBe(true);
    expect(seen.at(-1)).toMatchObject({ covers: true, viewCovers: true });

    await act(async () => {
      latestSocket('/widgets').fire('agent:typing', { isTyping: true, actor: 'assistant' });
    });
    expect(EasyLiveChat.instance.assistantTyping.get()).toBe(true);
    expect(seen.at(-1)).toMatchObject({ typing: true, assistant: true });

    await act(async () => {
      latestSocket('/widgets').fire('agent:typing', { isTyping: false, actor: 'assistant' });
    });
    expect(seen.at(-1)).toMatchObject({ typing: false, assistant: false });

    act(() => {
      tree?.unmount();
    });
  });
});
