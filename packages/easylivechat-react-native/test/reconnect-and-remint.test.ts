import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isAuthHandshakeError, SessionController } from '../src/session-controller';
import { InMemoryStorage, StorageKeys } from '../src/storage';
import {
  configBody,
  fakeJwt,
  installFakeServer,
  messageRow,
  sessionBody,
  type FakeServer,
} from './fake-server';
import { latestSocket, resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

function makeController(storage = new InMemoryStorage()): SessionController {
  return new SessionController(
    { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
    storage,
  );
}

/** Wait a macrotask, so a fire-and-forget promise chain can settle. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('reconnect backfill', () => {
  let server: FakeServer;
  let controller: SessionController;

  beforeEach(async () => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
    controller = makeController();
    await controller.boot();
    await controller.open();
  });

  afterEach(() => {
    controller.dispose();
    server.restore();
  });

  it('does NOT backfill on the FIRST connect', async () => {
    // The session payload already seeded the newest page.
    await flush();
    expect(server.requestsFor('/messages')).toHaveLength(0);
  });

  it('walks the cursor backward until a page overlaps what we already hold', async () => {
    // Seed something known, so an overlap is possible.
    const socket = latestSocket('/widgets');
    socket.fire('message:new', messageRow({ id: 'known', createdAt: '2026-09-01T09:00:00.000Z' }));

    // A three-page gap, then a page that overlaps `known`.
    server.reply('/messages', {
      body: { messages: [messageRow({ id: 'p1' })], nextCursor: 'c-p1' },
    });
    server.reply('/messages', {
      body: { messages: [messageRow({ id: 'p2' })], nextCursor: 'c-p2' },
    });
    server.reply('/messages', {
      body: { messages: [messageRow({ id: 'p3' })], nextCursor: 'c-p3' },
    });
    server.reply('/messages', {
      body: { messages: [messageRow({ id: 'known' })], nextCursor: 'c-p4' },
    });
    // Would be a fifth page if the walk did not stop.
    server.always('/messages', { body: { messages: [messageRow({ id: 'p5' })], nextCursor: null } });

    socket.disconnect();
    socket.connect();
    await flush();

    const pages = server.requestsFor('/messages');
    // Four requests: three gap pages plus the overlapping one that stops it.
    expect(pages).toHaveLength(4);
    expect(pages[0]?.query.has('cursor')).toBe(false);
    expect(pages[1]?.query.get('cursor')).toBe('c-p1');
    expect(pages[3]?.query.get('cursor')).toBe('c-p3');

    const ids = controller.messages.get().map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['p1', 'p2', 'p3', 'known']));
    expect(ids).not.toContain('p5');
  });

  it('stops when the server runs out of history', async () => {
    server.always('/messages', { body: { messages: [messageRow({ id: 'p1' })], nextCursor: null } });
    const socket = latestSocket('/widgets');
    socket.disconnect();
    socket.connect();
    await flush();
    expect(server.requestsFor('/messages')).toHaveLength(1);
  });

  it('stops walking on a failure instead of recursing into a re-mint', async () => {
    // We may be inside an in-flight re-mint here; recursing would deadlock on
    // its own promise. The connect-error handler or the next guardAuth call
    // re-mints and re-backfills cleanly.
    server.always('/messages', { status: 401, body: { error: 'UNAUTHENTICATED' } });
    const socket = latestSocket('/widgets');
    socket.disconnect();
    socket.connect();
    await flush();
    expect(server.requestsFor('/messages')).toHaveLength(1);
  });

  it('clamps the page limit to 1..100 client-side', async () => {
    server.always('/messages', { body: { messages: [], nextCursor: null } });
    await controller.rest.getMessages({ token: 't', limit: 5000 });
    await controller.rest.getMessages({ token: 't', limit: 0 });
    const pages = server.requestsFor('/messages');
    expect(pages[0]?.query.get('limit')).toBe('100');
    expect(pages[1]?.query.get('limit')).toBe('1');
  });

  it('reports reconnecting rather than disconnected while a token is held', () => {
    const socket = latestSocket('/widgets');
    expect(controller.connection.get()).toBe('connected');
    socket.disconnect();
    expect(controller.connection.get()).toBe('reconnecting');
  });
});

describe('token re-mint', () => {
  let server: FakeServer;
  let controller: SessionController;

  beforeEach(async () => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody({ nextCursor: 'c0' }) });
    controller = makeController();
    await controller.boot();
    await controller.open();
    server.requests.length = 0;
  });

  // Every case here drives the auth path through `loadOlderMessages`, which
  // only reaches the network when the session left a cursor behind — a thread
  // whose whole history already arrived correctly short-circuits instead.

  afterEach(() => {
    controller.dispose();
    server.restore();
  });

  it('is SINGLE-FLIGHT: five concurrent 401s cause exactly one POST /session', async () => {
    server.always('/messages', { status: 401, body: { error: 'UNAUTHENTICATED' } });
    await Promise.allSettled([
      controller.loadOlderMessages(),
      controller.loadOlderMessages(),
      controller.loadOlderMessages(),
      controller.loadOlderMessages(),
      controller.loadOlderMessages(),
    ]);
    expect(server.requestsFor('/session')).toHaveLength(1);
  });

  it('re-mints and retries the failed call once', async () => {
    server.reply('/messages', { status: 401, body: { error: 'UNAUTHENTICATED' } });
    server.always('/messages', { body: { messages: [messageRow({ id: 'p1' })], nextCursor: null } });
    const page = await controller.loadOlderMessages();
    expect(page.messages.map((m) => m.id)).toEqual(['p1']);
    expect(server.requestsFor('/session')).toHaveLength(1);
    expect(server.requestsFor('/session')[0]?.body?.resumeOnly).toBe(true);
  });

  it('forces a FRESH HANDSHAKE, not just a stored token', async () => {
    // A live socket does not re-read its handshake auth on a no-op connect(),
    // so a stale token would keep flowing until the next natural drop.
    const socket = latestSocket('/widgets');
    const connectsBefore = socket.connectCount;
    const freshToken = fakeJwt();
    server.always('/session', { body: sessionBody({ token: freshToken, nextCursor: 'c0' }) });
    server.reply('/messages', { status: 401, body: { error: 'UNAUTHENTICATED' } });
    server.always('/messages', { body: { messages: [], nextCursor: null } });

    await controller.loadOlderMessages();
    expect(socket.connectCount).toBeGreaterThan(connectsBefore);
    expect(socket.auth).toEqual({ token: freshToken });
  });

  it('does NOT loop when the conversation is gone — it drops to prechat/idle', async () => {
    server.always('/session', { body: sessionBody({ hasActiveConversation: false, token: undefined }) });
    server.always('/messages', { status: 401, body: { error: 'UNAUTHENTICATED' } });

    await controller.loadOlderMessages().catch(() => undefined);
    expect(server.requestsFor('/session')).toHaveLength(1);
    expect(controller.phase.get()).toBe('idle');
    expect(controller.connection.get()).toBe('disconnected');
    expect(await controller.storage.read(StorageKeys.token)).toBeNull();
  });

  it('pre-emptively re-mints a token inside the refresh leeway', async () => {
    const nearlyExpired = fakeJwt(30); // 30s left, leeway is 60s
    server.always('/session', { body: sessionBody({ token: nearlyExpired, nextCursor: 'c0' }) });
    // Adopt the nearly-expired token.
    await controller.silentResume();
    server.requests.length = 0;

    server.always('/session', { body: sessionBody({ token: fakeJwt(), nextCursor: 'c0' }) });
    server.always('/messages', { body: { messages: [], nextCursor: null } });
    await controller.loadOlderMessages();
    // The re-mint happened BEFORE the call, not after a 401.
    expect(server.requestsFor('/session')).toHaveLength(1);
  });

  it('re-mints on an auth-shaped connect_error, and only on one', () => {
    const socket = latestSocket('/widgets');
    socket.fire('connect_error', new Error('xhr poll error'));
    expect(server.requestsFor('/session')).toHaveLength(0);

    socket.fire('connect_error', new Error('WIDGET_TOKEN_MISSING'));
    expect(server.requestsFor('/session')).toHaveLength(1);
  });
});

describe('isAuthHandshakeError', () => {
  it('matches the specific token/JWT signals', () => {
    for (const e of [
      'WIDGET_TOKEN_MISSING',
      'TOKEN_EXPIRED',
      'token_invalid',
      'INVALID_TOKEN',
      'Unauthorized',
      'UNAUTHENTICATED',
      'ERR_JWS_INVALID',
      'ERR_JWT_EXPIRED',
      'signature verification failed',
      'JWS verification failed',
    ]) {
      expect(isAuthHandshakeError(e)).toBe(true);
    }
  });

  it('does NOT match a bare "token", so a benign message cannot storm', () => {
    expect(isAuthHandshakeError('rate limit token bucket exhausted')).toBe(false);
    expect(isAuthHandshakeError('xhr poll error')).toBe(false);
    expect(isAuthHandshakeError('timeout')).toBe(false);
    expect(isAuthHandshakeError('websocket error')).toBe(false);
  });
});

describe('socket conversation divergence', () => {
  let server: FakeServer;
  let controller: SessionController;

  beforeEach(async () => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody({ conversationId: 'c1' }) });
    controller = makeController();
    await controller.boot();
    await controller.open();
  });

  afterEach(() => {
    controller.dispose();
    server.restore();
  });

  it('forces a fresh handshake when the token is for a NEW conversation', async () => {
    // The server reads `conversationId` off the token ONCE, at connect time,
    // and routes everything on that socket there forever. Without this, a
    // visitor who ended one chat and started another kept sending into the
    // old, closed conversation.
    const socket = latestSocket('/widgets');
    const connectsBefore = socket.connectCount;

    server.always('/session', { body: sessionBody({ conversationId: 'c2', token: fakeJwt() }) });
    await controller.silentResume();

    expect(controller.conversationId).toBe('c2');
    expect(socket.connectCount).toBeGreaterThan(connectsBefore);
  });

  it('does NOT re-handshake when the conversation is unchanged', async () => {
    const socket = latestSocket('/widgets');
    const connectsBefore = socket.connectCount;
    await controller.silentResume();
    expect(controller.conversationId).toBe('c1');
    expect(socket.connectCount).toBe(connectsBefore);
  });
});

describe('silentResume single-flight', () => {
  let server: FakeServer;
  let controller: SessionController;

  beforeEach(async () => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
    controller = makeController();
    await controller.boot();
  });

  afterEach(() => {
    controller.dispose();
    server.restore();
  });

  it('adopts ONE session even when called concurrently', async () => {
    // `open()` awaits it while an incoming proactive message also fires it
    // fire-and-forget; two concurrent resumes adopt two sessions (duplicate
    // sockets, clobbered conversation state).
    const results = await Promise.all([
      controller.silentResume(),
      controller.silentResume(),
      controller.silentResume(),
    ]);
    expect(results).toEqual([true, true, true]);
    expect(server.requestsFor('/session')).toHaveLength(1);
  });

  it('never strands at `resuming` when there is nothing to resume', async () => {
    server.always('/session', { body: sessionBody({ hasActiveConversation: false, token: undefined }) });
    await expect(controller.silentResume()).resolves.toBe(false);
    expect(controller.phase.get()).toBe('idle');
  });

  it('falls back to prechat when a form is configured', async () => {
    server.always('/config', {
      body: configBody({}, { preChatForm: { enabled: true, fields: [{ id: 'name', label: 'Name' }] } }),
    });
    server.always('/session', { body: sessionBody({ hasActiveConversation: false, token: undefined }) });
    await controller.loadConfig();
    await controller.silentResume();
    expect(controller.phase.get()).toBe('prechat');
  });
});
