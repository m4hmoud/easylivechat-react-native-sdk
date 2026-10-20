import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChat } from '../src/client';
import { SessionController } from '../src/session-controller';
import { InMemoryStorage, StorageKeys } from '../src/storage';
import { configBody, installFakeServer, sessionBody, type FakeServer } from './fake-server';
import { createdSockets, resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * The identity edges `easylivechat` 0.1.56 closed: `identify()` before
 * `boot()`, `clearIdentity()`, and `open()` as a single flight.
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const CONFIG = {
  apiBase: 'https://api.example.com',
  tenantSlug: 'acme',
  enableHeartbeat: false,
  enablePresenceSocket: false,
};

/** Requests that START a session, as opposed to resume probes. */
const starts = (server: FakeServer) =>
  server.requestsFor('/session').filter((r) => r.body?.resumeOnly !== true);

describe('identify() before boot()', () => {
  let server: FakeServer;
  let storage: InMemoryStorage;

  beforeEach(() => {
    resetFakeSockets();
    storage = new InMemoryStorage();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
  });

  afterEach(() => {
    EasyLiveChat.instance.shutdown();
    server.restore();
  });

  it('is held by the facade and applied by boot — it used to throw', async () => {
    expect(EasyLiveChat.instance.isBooted).toBe(false);
    expect(() =>
      EasyLiveChat.instance.identify({ name: 'Ada', email: 'ada@example.com', userId: 'u-ada', userHash: 'h' }),
    ).not.toThrow();

    await EasyLiveChat.instance.boot(CONFIG, { storage });
    expect(EasyLiveChat.instance.visitorName).toBe('Ada');
    await EasyLiveChat.instance.open();

    // Started directly as Ada — no pre-chat form — with her claim.
    const [start] = starts(server);
    expect(start?.body).toMatchObject({
      name: 'Ada',
      email: 'ada@example.com',
      userId: 'u-ada',
      userHash: 'h',
    });
    expect(await storage.read(StorageKeys.identifiedUserId)).toBe('u-ada');
  });

  it('is judged against the STORED user, so a different person never resumes', async () => {
    // Ada's visitor, as a previous launch left it.
    await storage.write(StorageKeys.visitorId, 'ada-visitor');
    await storage.write(StorageKeys.identifiedUserId, 'user-ada');
    await storage.write(StorageKeys.profile, '{"name":"Ada"}');

    EasyLiveChat.instance.identify({ name: 'Grace', userId: 'user-grace', userHash: 'hg' });
    await EasyLiveChat.instance.boot(CONFIG, { storage });
    await EasyLiveChat.instance.open();

    expect(EasyLiveChat.instance.visitorId).not.toBe('ada-visitor');
    expect(EasyLiveChat.instance.visitorName).toBe('Grace');
    expect(server.requests.filter((r) => r.body?.visitorId === 'ada-visitor')).toHaveLength(0);
    expect(await storage.read(StorageKeys.identifiedUserId)).toBe('user-grace');
  });

  it('survives the usual un-awaited boot(); identify() pair', async () => {
    await storage.write(StorageKeys.visitorId, 'ada-visitor');
    await storage.write(StorageKeys.identifiedUserId, 'user-ada');
    await storage.write(StorageKeys.profile, '{"name":"Ada","email":"ada@example.com"}');

    // boot() has created the controller but not yet read storage when this
    // lands. Judged then, Grace looked like an anonymous visitor signing in —
    // keeping Ada's visitor — and boot's profile read clobbered her name.
    const booting = EasyLiveChat.instance.boot(CONFIG, { storage });
    EasyLiveChat.instance.identify({ name: 'Grace', userId: 'user-grace', userHash: 'hg' });
    await booting;

    expect(EasyLiveChat.instance.visitorId).not.toBe('ada-visitor');
    expect(EasyLiveChat.instance.visitorName).toBe('Grace');
    await EasyLiveChat.instance.open();
    const [start] = starts(server);
    expect(start?.body).toMatchObject({ name: 'Grace', userId: 'user-grace' });
    expect(start?.body).not.toHaveProperty('email');
  });

  it('is held by the controller too, until its own boot() has read storage', async () => {
    await storage.write(StorageKeys.profile, '{"name":"Stale","email":"stale@example.com"}');
    const c = new SessionController(CONFIG, storage);
    const booting = c.boot();
    c.identify({ name: 'Ada' });
    await booting;
    // identify() is authoritative: the cached profile does not win.
    expect(c.visitorName).toBe('Ada');
    await c.open();
    expect(starts(server)[0]?.body).toMatchObject({ name: 'Ada' });
    expect(starts(server)[0]?.body).not.toHaveProperty('email');
    c.dispose();
  });

  it('keeps only the latest call', async () => {
    EasyLiveChat.instance.identify({ name: 'Ada' });
    EasyLiveChat.instance.identify({ name: 'Grace' });
    await EasyLiveChat.instance.boot(CONFIG, { storage });
    expect(EasyLiveChat.instance.visitorName).toBe('Grace');
  });

  it('is dropped by clearIdentity() and by reset() before boot', async () => {
    EasyLiveChat.instance.identify({ name: 'Ada' });
    EasyLiveChat.instance.clearIdentity();
    await EasyLiveChat.instance.boot(CONFIG, { storage });
    expect(EasyLiveChat.instance.visitorName).toBeNull();
    EasyLiveChat.instance.shutdown();

    EasyLiveChat.instance.identify({ name: 'Grace' });
    await EasyLiveChat.instance.reset({ storage });
    await EasyLiveChat.instance.boot(CONFIG, { storage });
    expect(EasyLiveChat.instance.visitorName).toBeNull();
  });
});

describe('clearIdentity()', () => {
  let server: FakeServer;
  let storage: InMemoryStorage;

  const controller = (): SessionController => new SessionController(CONFIG, storage);
  const lastSession = () => server.requestsFor('/session').at(-1)?.body;

  beforeEach(() => {
    resetFakeSockets();
    storage = new InMemoryStorage();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
  });

  afterEach(() => server.restore());

  it('clears a name/email-only identity without forgetting the visitor', async () => {
    const c = controller();
    await c.boot();
    c.identify({ name: 'Ada', email: 'ada@example.com', phone: '+1', fields: { plan: 'pro' } });
    await c.open();
    const visitor = c.visitorId;
    expect(c.conversationId).toBe('c1');
    expect(await storage.read(StorageKeys.profile)).toContain('Ada');

    c.clearIdentity();
    await flush();

    // The same visitor and conversation, now anonymous…
    expect(c.visitorId).toBe(visitor);
    expect(c.conversationId).toBe('c1');
    expect(c.phase.get()).toBe('chat');
    expect(c.visitorName).toBeNull();
    // …with nothing left to resend the name from, now or after a cold start.
    expect(await storage.read(StorageKeys.profile)).toBeNull();
    await c.silentResume();
    expect(lastSession()).toMatchObject({ visitorId: visitor, resumeOnly: true });
    for (const key of ['name', 'email', 'phone', 'userId', 'userHash']) {
      expect(lastSession()).not.toHaveProperty(key);
    }
    c.dispose();
  });

  it('forgets a visitor identified with a userId, and re-opens as an anonymous one', async () => {
    const c = controller();
    await c.boot();
    c.identify({ name: 'Ada', userId: 'user-ada', userHash: 'ha' });
    await c.open();
    const ada = c.visitorId;
    expect(c.phase.get()).toBe('chat');

    c.clearIdentity();
    // Synchronously gone: nothing of Ada's conversation stays on screen.
    expect(c.messages.get()).toEqual([]);
    expect(c.conversationId).toBeNull();

    await vi.waitFor(() => expect(c.phase.get()).toBe('chat'));
    expect(c.visitorId).not.toBe(ada);
    expect(c.visitorName).toBeNull();
    expect(await storage.read(StorageKeys.identifiedUserId)).toBeNull();
    expect(await storage.read(StorageKeys.visitorId)).toBe(c.visitorId);
    const restart = starts(server).at(-1)?.body;
    expect(restart?.visitorId).toBe(c.visitorId);
    expect(restart).not.toHaveProperty('userId');
    expect(restart).not.toHaveProperty('name');
    c.dispose();
  });

  it('does not re-open a chat that was not on screen', async () => {
    const c = controller();
    await c.boot();
    c.identify({ userId: 'user-ada', userHash: 'ha' });
    await flush();
    const before = server.requests.length;

    c.clearIdentity();
    await flush();
    expect(c.phase.get()).toBe('idle');
    expect(server.requests.length).toBe(before);
    c.dispose();
  });

  it('is a no-op for a visitor who never identified', async () => {
    await storage.write(StorageKeys.visitorId, 'anon');
    const c = controller();
    await c.boot();
    c.clearIdentity();
    await flush();
    expect(c.visitorId).toBe('anon');
    expect(await storage.read(StorageKeys.visitorId)).toBe('anon');
    c.dispose();
  });

  it('is on the facade, and safe before boot', async () => {
    expect(() => EasyLiveChat.instance.clearIdentity()).not.toThrow();
    await EasyLiveChat.instance.boot(CONFIG, { storage });
    EasyLiveChat.instance.identify({ name: 'Ada' });
    expect(EasyLiveChat.instance.visitorName).toBe('Ada');
    EasyLiveChat.instance.clearIdentity();
    expect(EasyLiveChat.instance.visitorName).toBeNull();
    EasyLiveChat.instance.shutdown();
  });
});

describe('open() is single-flight', () => {
  let server: FakeServer;
  let storage: InMemoryStorage;

  const controller = (): SessionController => new SessionController(CONFIG, storage);

  beforeEach(() => {
    resetFakeSockets();
    storage = new InMemoryStorage();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
  });

  afterEach(() => server.restore());

  it('joins an open already running instead of starting a second session', async () => {
    const c = controller();
    await c.boot();
    const first = c.open();
    const second = c.open();
    expect(second).toBe(first);
    await Promise.all([first, second]);

    expect(starts(server)).toHaveLength(1);
    expect(server.requestsFor('/config')).toHaveLength(1);
    expect(createdSockets.filter((s) => s.url.endsWith('/widgets'))).toHaveLength(1);
    expect(c.phase.get()).toBe('chat');
    c.dispose();
  });

  it('joins the resume of a returning visitor as well', async () => {
    await storage.write(StorageKeys.visitorId, 'returning');
    const c = controller();
    await c.boot();
    await Promise.all([c.open(), c.open(), c.open()]);
    expect(server.requestsFor('/config')).toHaveLength(1);
    expect(server.requestsFor('/session')).toHaveLength(1);
    expect(server.requestsFor('/session')[0]?.body?.resumeOnly).toBe(true);
    c.dispose();
  });

  it('runs again once the last one has finished', async () => {
    const c = controller();
    await c.boot();
    await c.open();
    await c.open();
    // A reopen re-reads availability; it does not hang on the finished run.
    expect(server.requestsFor('/config')).toHaveLength(2);
    c.dispose();
  });

  it('runs again after one that failed', async () => {
    server.reply('/config', { status: 500, body: { error: 'BOOM' } });
    const c = controller();
    await c.boot();
    await expect(c.open()).rejects.toBeDefined();
    await c.open();
    expect(c.phase.get()).toBe('chat');
    c.dispose();
  });

  it('gives the new person their own run when the visitor is switched mid-open', async () => {
    // Hold every response until released, so the switch lands mid-open.
    const real = globalThis.fetch;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      await gate;
      return real(...args);
    }) as typeof fetch;

    const c = controller();
    await c.boot();
    c.identify({ name: 'Ada', userId: 'user-ada', userHash: 'ha' });
    const adaOpen = c.open();
    await flush();
    const ada = c.visitorId;

    // Grace signs in while Ada's open is still waiting on the network. Joining
    // that run would strand her: it belongs to Ada and bails out.
    c.identify({ name: 'Grace', userId: 'user-grace', userHash: 'hg' });
    release();
    await adaOpen;

    await vi.waitFor(() => expect(c.phase.get()).toBe('chat'));
    const all = starts(server).map((r) => r.body);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ name: 'Grace', userId: 'user-grace' });
    expect(all[0]?.visitorId).toBe(c.visitorId);
    expect(c.visitorId).not.toBe(ada);
    c.dispose();
  });
});
