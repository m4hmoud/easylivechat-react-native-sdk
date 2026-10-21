import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChat } from '../src/client';
import { EasyLiveChatPush } from '../src/push';
import { InMemoryStorage } from '../src/storage';
import { configBody, installFakeServer, sessionBody, type FakeServer } from './fake-server';
import { resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * `setPushToken` is a deprecated no-op.
 *
 * Workspaces no longer hand us their Firebase credentials, so the SDK has
 * nothing to register a device for: notifying the app's users is the tenant's
 * own server's job, driven by the `message.created` webhook. The call is kept
 * so an app that makes it keeps compiling — and must cost nothing: no request,
 * at any moment of the session, and nothing kept on the device that a later
 * session could act on.
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** InMemoryStorage that remembers every key written. */
class RecordingStorage extends InMemoryStorage {
  readonly written: string[] = [];

  override async write(key: string, value: string): Promise<void> {
    this.written.push(key);
    await super.write(key, value);
  }
}

describe('setPushToken (deprecated)', () => {
  let server: FakeServer;
  let storage: RecordingStorage;
  const config = {
    apiBase: 'https://api.example.test',
    tenantSlug: 'acme',
    enableHeartbeat: false,
    enablePresenceSocket: false,
  };

  const pushRequests = () => server.requests.filter((r) => r.path.includes('/push/'));

  beforeEach(() => {
    resetFakeSockets();
    storage = new RecordingStorage();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
    server.always('/push/register', { body: { ok: true, id: 'p1' } });
    server.always('/push/unregister', { body: { ok: true } });
  });

  afterEach(() => {
    EasyLiveChat.instance.shutdown();
    server.restore();
  });

  it('resolves at once before boot, and nothing is held for the first session', async () => {
    await expect(EasyLiveChat.instance.setPushToken('fcm-1', { platform: 'IOS' })).resolves.toBeUndefined();

    await EasyLiveChat.instance.boot(config, { storage });
    await EasyLiveChat.instance.open();
    await flush();

    expect(pushRequests()).toEqual([]);
  });

  it('sends nothing with a live session — a token, a rotation or a null', async () => {
    await EasyLiveChat.instance.boot(config, { storage });
    await EasyLiveChat.instance.open();
    const before = server.requests.length;

    await EasyLiveChat.instance.setPushToken('fcm-1', { platform: 'ANDROID', appVersion: '2.4.0' });
    await EasyLiveChat.instance.setPushToken('fcm-2', { platform: 'ANDROID' });
    await EasyLiveChat.instance.setPushToken(null, { platform: 'ANDROID' });
    await flush();

    // Not even a request to some other endpoint.
    expect(server.requests.length).toBe(before);
  });

  it('keeps nothing on the device', async () => {
    await EasyLiveChat.instance.boot(config, { storage });
    await EasyLiveChat.instance.open();
    const written = storage.written.length;

    await EasyLiveChat.instance.setPushToken('fcm-1', { platform: 'IOS' });
    expect(storage.written.slice(written)).toEqual([]);
  });

  it('leaves nothing for an identity switch or reset() to unregister', async () => {
    await EasyLiveChat.instance.setPushToken('fcm-1', { platform: 'IOS' });
    await EasyLiveChat.instance.boot(config, { storage });
    EasyLiveChat.instance.identify({ userId: 'u1', userHash: 'h1' });
    await EasyLiveChat.instance.open();
    EasyLiveChat.instance.identify({ userId: 'u2', userHash: 'h2' });
    await flush();
    await EasyLiveChat.instance.reset();
    await flush();

    expect(pushRequests()).toEqual([]);
  });

  describe('the deprecated EasyLiveChatPush alias', () => {
    it('says push is not something the SDK does', () => {
      expect(EasyLiveChatPush.isSupported).toBe(false);
    });

    it('does nothing either, with or without a platform', async () => {
      await EasyLiveChat.instance.boot(config, { storage });
      await EasyLiveChat.instance.open();
      await expect(
        EasyLiveChatPush.registerDeviceToken('fcm-1', { platform: 'ANDROID', appVersion: '1.0' }),
      ).resolves.toBeUndefined();
      await expect(EasyLiveChatPush.registerDeviceToken('fcm-1')).resolves.toBeUndefined();
      await expect(EasyLiveChatPush.unregisterDeviceToken()).resolves.toBeUndefined();
      await flush();
      expect(pushRequests()).toEqual([]);
    });
  });
});
