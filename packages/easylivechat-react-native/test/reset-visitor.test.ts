import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChat } from '../src/client';
import { SessionController } from '../src/session-controller';
import { InMemoryStorage, StorageKeys } from '../src/storage';
import { configBody, installFakeServer, sessionBody, type FakeServer } from './fake-server';
import { resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * Port of `reset_visitor_test.dart`.
 *
 * `reset()` is the LOGOUT path and is not the same as `shutdown()`. Shutdown
 * only clears memory; the durable `visitorId` survives it, so the next boot
 * resolves the SAME server-side contact and resumes the SAME conversation.
 * That is right for a returning customer and wrong for a signed-out one: on a
 * shared device — a restaurant tablet, a POS terminal — the next person would
 * inherit the last one's identity.
 */
describe('resetVisitor', () => {
  let server: FakeServer;
  let storage: InMemoryStorage;

  beforeEach(() => {
    resetFakeSockets();
    storage = new InMemoryStorage();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
  });

  afterEach(() => server.restore());

  it('drops EVERY key in StorageKeys.identity', async () => {
    const c = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      storage,
    );
    await c.boot();
    c.identify({ name: 'Ada', email: 'ada@example.com', phone: '+1' });
    await c.startSession({ name: 'Ada' }, { skipValidation: true });

    // Everything that says WHO this visitor is, written.
    for (const key of StorageKeys.identity) {
      expect(await storage.read(key)).not.toBeNull();
    }

    await c.resetVisitor();

    for (const key of StorageKeys.identity) {
      expect(await storage.read(key)).toBeNull();
    }
    c.dispose();
  });

  it('lists every durable key the SDK writes', () => {
    // The guardrail: a new durable key added and not listed would survive a
    // logout and quietly re-identify the next person on the device.
    const durable = [
      StorageKeys.token,
      StorageKeys.conversationId,
      StorageKeys.profile,
      StorageKeys.visitorId,
    ];
    expect([...StorageKeys.identity].sort()).toEqual([...durable].sort());
    // …and the visitorId is dropped LAST, since it is the one the server keys
    // the contact on and the others are meaningless without it.
    expect(StorageKeys.identity.at(-1)).toBe(StorageKeys.visitorId);
  });

  it('does NOT rename the legacy web-widget keys', () => {
    // They deliberately reuse the legacy names so one person is the same
    // visitor across web and native within a tenant; renaming resets every
    // installed user. See the Brand section of the repo's CLAUDE.md.
    expect(StorageKeys.visitorId).toBe('livechattools:visitorId');
    expect(StorageKeys.profile).toBe('livechattools:visitorProfile');
  });

  it('mints a fresh visitorId on the next boot, so there is nothing to resume', async () => {
    const first = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      storage,
    );
    await first.boot();
    const before = first.visitorId;
    await first.resetVisitor();
    first.dispose();

    const second = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      storage,
    );
    await second.boot();
    expect(second.visitorId).not.toBe(before);
    expect(second.visitorId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    second.dispose();
  });

  it('keeps the visitorId across a plain shutdown', async () => {
    // The other half of the contract: shutdown() is NOT logout.
    const first = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      storage,
    );
    await first.boot();
    const id = first.visitorId;
    first.dispose();

    const second = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      storage,
    );
    await second.boot();
    expect(second.visitorId).toBe(id);
    second.dispose();
  });

  it('works from the facade when the SDK was NEVER booted this session', async () => {
    // The common case for a logout that never opened the chat.
    await storage.write(StorageKeys.visitorId, 'v-old');
    await storage.write(StorageKeys.token, 'jwt');
    await storage.write(StorageKeys.profile, '{"name":"Ada"}');
    await storage.write(StorageKeys.conversationId, 'c1');

    expect(EasyLiveChat.instance.isBooted).toBe(false);
    await EasyLiveChat.instance.reset({ storage });

    for (const key of StorageKeys.identity) {
      expect(await storage.read(key)).toBeNull();
    }
  });

  it('ignores a corrupt profile cache rather than throwing', async () => {
    await storage.write(StorageKeys.profile, 'not json{');
    const c = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      storage,
    );
    await expect(c.boot()).resolves.toBeUndefined();
    expect(c.visitorName).toBeNull();
    c.dispose();
  });
});
