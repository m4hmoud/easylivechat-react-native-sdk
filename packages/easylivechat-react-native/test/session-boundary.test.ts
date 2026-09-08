import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseChatMessage } from '../src/models/chat-message';
import { SessionController, newestSessionStartMarker } from '../src/session-controller';
import { InMemoryStorage } from '../src/storage';
import { configBody, installFakeServer, messageRow, sessionBody, type FakeServer } from './fake-server';
import { latestSocket, resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

const marker = (id: string, at: string): Record<string, unknown> =>
  messageRow({
    id,
    senderType: 'SYSTEM',
    body: 'New chat',
    createdAt: at,
    metadata: { i18n: { key: 'conversation.session.started' } },
  });

/**
 * Port of `session_boundary_test.dart`.
 *
 * What matters is the marker's IDENTITY, never its presence. The same marker
 * arrives again on every resume, backfill and reconnect; treating that as a
 * new visit would re-ask a visitor who has just rated. Only a marker not
 * already accounted for means a visit has begun.
 */
describe('newestSessionStartMarker', () => {
  it('picks the newest marker and ignores everything else', () => {
    const messages = [
      parseChatMessage(marker('s1', '2026-09-01T10:00:00.000Z')),
      parseChatMessage(messageRow({ id: 'm1', createdAt: '2026-09-01T11:00:00.000Z' })),
      parseChatMessage(marker('s2', '2026-09-02T10:00:00.000Z')),
      parseChatMessage(
        messageRow({
          id: 'e1',
          senderType: 'SYSTEM',
          createdAt: '2026-09-03T10:00:00.000Z',
          metadata: { i18n: { key: 'conversation.session.ended' } },
        }),
      ),
    ];
    expect(newestSessionStartMarker(messages)?.id).toBe('s2');
  });

  it('returns null when there is no marker', () => {
    expect(newestSessionStartMarker([parseChatMessage(messageRow())])).toBeNull();
  });
});

describe('the post-chat guard across visits', () => {
  let server: FakeServer;
  let controller: SessionController;

  beforeEach(async () => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', {
      body: sessionBody({ messages: [marker('s1', '2026-09-01T10:00:00.000Z')] }),
    });
    controller = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      new InMemoryStorage(),
    );
    await controller.boot();
    await controller.open();
  });

  afterEach(() => {
    controller.dispose();
    server.restore();
  });

  it('moves to feedback on conversation:closed', () => {
    latestSocket('/widgets').fire('conversation:closed', { conversationId: 'c1' });
    expect(controller.phase.get()).toBe('feedback');
  });

  it('ignores a re-fired close for the same conversation', () => {
    // The server emits on ANY *→CLOSED PATCH, not only OPEN→CLOSED.
    const socket = latestSocket('/widgets');
    socket.fire('conversation:closed', { conversationId: 'c1' });
    expect(controller.phase.get()).toBe('feedback');

    controller.phase.set('chat');
    socket.fire('conversation:closed', { conversationId: 'c1' });
    expect(controller.phase.get()).toBe('chat');
  });

  it('ignores a close for a DIFFERENT conversation', () => {
    latestSocket('/widgets').fire('conversation:closed', { conversationId: 'other' });
    expect(controller.phase.get()).toBe('chat');
  });

  it('does NOT re-arm on the same marker arriving again', async () => {
    const socket = latestSocket('/widgets');
    socket.fire('conversation:closed', { conversationId: 'c1' });
    expect(controller.phase.get()).toBe('feedback');
    controller.phase.set('chat');

    // A resume/backfill re-delivers the SAME marker. Nothing new has begun.
    socket.fire('message:new', marker('s1', '2026-09-01T10:00:00.000Z'));
    socket.fire('conversation:closed', { conversationId: 'c1' });
    expect(controller.phase.get()).toBe('chat');
  });

  it('DOES re-arm on a NEW marker — a second visit gets its own survey', async () => {
    const socket = latestSocket('/widgets');
    socket.fire('conversation:closed', { conversationId: 'c1' });
    controller.phase.set('chat');

    // A returning customer lands back in the thread they already have, so the
    // conversation id stopped being one-per-visit. Rating once must not
    // suppress the survey for the life of the thread.
    socket.fire('message:new', marker('s2', '2026-09-05T09:00:00.000Z'));
    socket.fire('conversation:closed', { conversationId: 'c1' });
    expect(controller.phase.get()).toBe('feedback');
  });

  it('re-arms after a rating too, not only after a close', async () => {
    server.always('/feedback', { body: { ok: true, rating: 5 } });
    await controller.submitFeedback({ rating: 5 });

    const socket = latestSocket('/widgets');
    // Already rated: the close is ignored.
    socket.fire('conversation:closed', { conversationId: 'c1' });
    expect(controller.phase.get()).toBe('chat');

    // A new visit clears the rated flag for this conversation.
    socket.fire('message:new', marker('s2', '2026-09-05T09:00:00.000Z'));
    socket.fire('conversation:closed', { conversationId: 'c1' });
    expect(controller.phase.get()).toBe('feedback');
  });
});

describe('endChat', () => {
  let server: FakeServer;
  let controller: SessionController;

  beforeEach(async () => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
    controller = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      new InMemoryStorage(),
    );
    await controller.boot();
    await controller.open();
    latestSocket('/widgets').ackResponder = () => ({ ok: true });
  });

  afterEach(() => {
    controller.dispose();
    server.restore();
  });

  it('reports that a post-chat step will follow', async () => {
    await expect(controller.endChat()).resolves.toBe(true);
    expect(latestSocket('/widgets').emitsOf('conversation:end')).toHaveLength(1);
  });

  it('reports false for an already-closed chat and finishes the session', async () => {
    latestSocket('/widgets').fire('conversation:closed', { conversationId: 'c1' });
    // The answer cannot be inferred from the phase afterwards: the echo is
    // deliberately ignored for a conversation already closed, so "end" can
    // legitimately change nothing at all and a caller waiting for a phase
    // change waited forever.
    await expect(controller.endChat()).resolves.toBe(false);
    // Nothing left to ask ⇒ let go of the conversation, so the visitor's next
    // message starts a fresh chat instead of re-opening the closed one.
    expect(controller.conversationId).toBeNull();
  });

  it('reports false when there is no live socket', async () => {
    controller.closeSession();
    await expect(controller.endChat()).resolves.toBe(false);
  });
});
