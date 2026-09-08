import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionController } from '../src/session-controller';
import { InMemoryStorage, StorageKeys } from '../src/storage';
import { configBody, installFakeServer, sessionBody, type FakeServer } from './fake-server';
import { resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * Port of `identify_phone_test.dart`.
 *
 * The phone has to reach BOTH the create path and the resume path. The create
 * path always sent it; the resume path did not, so a visitor who already had a
 * live conversation when the host identified them — opening the chat from a
 * login screen, signing in, coming back — handed the agent a name and no phone
 * number. The server adopts whatever a resume carries; it can only adopt what
 * is sent.
 */
describe('identify()', () => {
  let server: FakeServer;
  let storage: InMemoryStorage;

  const makeController = (): SessionController =>
    new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      storage,
    );

  beforeEach(() => {
    resetFakeSockets();
    storage = new InMemoryStorage();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
  });

  afterEach(() => server.restore());

  it('sends the phone on the CREATE path', async () => {
    server.always('/session', { body: sessionBody({ hasActiveConversation: false, token: undefined }) });
    const c = makeController();
    await c.boot();
    c.identify({ name: 'Ada', email: 'ada@example.com', phone: '+964770 000 0000' });
    await c.startSession(
      { name: 'Ada', email: 'ada@example.com', phone: '+964770 000 0000' },
      { skipValidation: true },
    );
    const create = server.requestsFor('/session').at(-1);
    expect(create?.body?.phone).toBe('+964770 000 0000');
    expect(create?.body?.name).toBe('Ada');
    c.dispose();
  });

  it('sends the phone on the RESUME path', async () => {
    server.always('/session', { body: sessionBody() });
    const c = makeController();
    await c.boot();
    c.identify({ name: 'Ada', phone: '+9647700000000' });
    await c.silentResume();
    const resume = server.requestsFor('/session').at(-1);
    expect(resume?.body?.resumeOnly).toBe(true);
    expect(resume?.body?.phone).toBe('+9647700000000');
    c.dispose();
  });

  it('persists the phone so it survives a cold start', async () => {
    // §4.1 seeds `phone` back out of the cached profile on boot, which only
    // works if the phone actually reaches the cache. (The Flutter reference
    // drops it when persisting after startSession; this port does not.)
    server.always('/session', { body: sessionBody() });
    const first = makeController();
    await first.boot();
    first.identify({ name: 'Ada', phone: '+9647700000000' });
    await first.startSession({ name: 'Ada', phone: '+9647700000000' }, { skipValidation: true });
    first.dispose();

    const cached = await storage.read(StorageKeys.profile);
    expect(cached).toContain('+9647700000000');

    // A fresh process, same storage, no identify() behind it.
    const second = makeController();
    await second.boot();
    await second.silentResume();
    expect(server.requestsFor('/session').at(-1)?.body?.phone).toBe('+9647700000000');
    second.dispose();
  });

  it('omits a blank phone entirely rather than sending an empty string', async () => {
    server.always('/session', { body: sessionBody() });
    const c = makeController();
    await c.boot();
    c.identify({ name: 'Ada', phone: '   ' });
    await c.silentResume();
    expect(server.requestsFor('/session').at(-1)?.body).not.toHaveProperty('phone');
    c.dispose();
  });

  it('is AUTHORITATIVE: a value no longer supplied is cleared, not merged', async () => {
    server.always('/session', { body: sessionBody() });
    const c = makeController();
    await c.boot();
    c.identify({ name: 'Ada', email: 'ada@example.com', phone: '+1' });
    // A second identify without the email must CLEAR it — otherwise an old,
    // or a previous user's, email leaks into the new session out of storage.
    c.identify({ name: 'Grace' });
    await c.silentResume();
    const body = server.requestsFor('/session').at(-1)?.body;
    expect(body?.name).toBe('Grace');
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('phone');
    c.dispose();
  });

  it('ignores a fully-empty identity (the visitor stays anonymous)', async () => {
    server.always('/session', { body: sessionBody() });
    const c = makeController();
    await c.boot();
    c.identify({ name: 'Ada' });
    c.identify({});
    await c.silentResume();
    expect(server.requestsFor('/session').at(-1)?.body?.name).toBe('Ada');
    c.dispose();
  });

  it('always sends historyScope: session', async () => {
    // A returning customer lands back in a conversation that can span months;
    // handing them all of it at once buries what they came back for.
    server.always('/session', { body: sessionBody() });
    const c = makeController();
    await c.boot();
    await c.silentResume();
    expect(server.requestsFor('/session').at(-1)?.body?.historyScope).toBe('session');
    c.dispose();
  });

  it('sends the protocol version header on every request', async () => {
    server.always('/session', { body: sessionBody() });
    const c = makeController();
    await c.boot();
    await c.loadConfig();
    for (const req of server.requests) {
      expect(req.headers['x-easylivechat-protocol-version']).toBe('1');
    }
    c.dispose();
  });
});
