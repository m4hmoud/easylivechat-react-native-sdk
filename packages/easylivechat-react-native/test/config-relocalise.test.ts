import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChat } from '../src/client';
import { SessionController } from '../src/session-controller';
import { InMemoryStorage } from '../src/storage';
import { configBody, installFakeServer, sessionBody, type FakeServer } from './fake-server';
import { resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * Port of `config_relocalise_test.dart`.
 *
 * A re-`boot()` with a new `contentLocale` must SWAP the REST client. The host
 * rebuilds its config from the CURRENT app language on every open, and
 * returning early left the chat fetching tenant copy in whatever language the
 * app happened to be in the first time: a visitor who opened in Kurdish,
 * switched to Arabic and came back got Arabic SDK chrome wrapped around
 * Kurdish tenant copy, including a post-chat survey whose questions were still
 * Kurdish.
 */
describe('applyConfig', () => {
  let server: FakeServer;
  let controller: SessionController;

  beforeEach(async () => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
    controller = new SessionController(
      {
        apiBase: 'https://api.example.com',
        tenantSlug: 'acme',
        contentLocale: 'ckb',
        enableHeartbeat: false,
      },
      new InMemoryStorage(),
    );
    await controller.boot();
  });

  afterEach(() => {
    controller.dispose();
    server.restore();
  });

  it('rebuilds the REST client when contentLocale changes', async () => {
    const before = controller.rest;
    await controller.loadConfig();
    expect(server.requestsFor('/config').at(-1)?.query.get('locale')).toBe('ckb');

    controller.applyConfig({
      apiBase: 'https://api.example.com',
      tenantSlug: 'acme',
      contentLocale: 'ar',
      enableHeartbeat: false,
    });
    expect(controller.rest).not.toBe(before);

    await controller.loadConfig();
    expect(server.requestsFor('/config').at(-1)?.query.get('locale')).toBe('ar');
  });

  it('rebuilds on apiBase, tenantSlug, locale or channel changes', () => {
    const rebuiltFor = (next: Record<string, unknown>): boolean => {
      const before = controller.rest;
      controller.applyConfig({
        apiBase: 'https://api.example.com',
        tenantSlug: 'acme',
        contentLocale: 'ckb',
        enableHeartbeat: false,
        ...next,
      });
      const changed = controller.rest !== before;
      // Put it back so each case starts from the same place.
      controller.applyConfig({
        apiBase: 'https://api.example.com',
        tenantSlug: 'acme',
        contentLocale: 'ckb',
        enableHeartbeat: false,
      });
      return changed;
    };

    expect(rebuiltFor({ apiBase: 'https://other.example.com' })).toBe(true);
    expect(rebuiltFor({ tenantSlug: 'beta' })).toBe(true);
    expect(rebuiltFor({ locale: 'Kurdish (Sorani)' })).toBe(true);
    expect(rebuiltFor({ channel: 'rider' })).toBe(true);
    // Nothing relevant changed: keep the client (it holds no per-call state,
    // but rebuilding it on every open would churn for no reason).
    expect(rebuiltFor({ heartbeatIntervalMs: 60_000 })).toBe(false);
  });

  it('sends the channel on the CONFIG call, not only on the session call', async () => {
    // The server resolves per-channel overrides from exactly this parameter.
    // Omitting it means the app gets workspace defaults for the welcome
    // screen, the queue and offline text, and the pre-chat form, while the
    // dashboard shows an inbox configured differently.
    controller.applyConfig({
      apiBase: 'https://api.example.com',
      tenantSlug: 'acme',
      channel: 'rider',
      contentLocale: 'ckb',
      enableHeartbeat: false,
    });
    await controller.loadConfig();
    expect(server.requestsFor('/config').at(-1)?.query.get('channel')).toBe('rider');

    await controller.silentResume();
    expect(server.requestsFor('/session').at(-1)?.body?.channel).toBe('rider');
  });

  it('omits `origin` on native so the allowedOrigins gate is skipped', async () => {
    await controller.loadConfig();
    expect(server.requestsFor('/config').at(-1)?.query.has('origin')).toBe(false);
  });

  it('sends `locale` and `contentLocale` as two different things', async () => {
    // `locale` is free-form — hosts put a readable language NAME there because
    // it is what agents see in the dashboard. `contentLocale` is the CODE that
    // selects the translation of the tenant's own copy.
    controller.applyConfig({
      apiBase: 'https://api.example.com',
      tenantSlug: 'acme',
      locale: 'Kurdish (Sorani)',
      contentLocale: 'ckb',
      enableHeartbeat: false,
    });
    await controller.silentResume();
    const body = server.requestsFor('/session').at(-1)?.body;
    expect(body?.locale).toBe('Kurdish (Sorani)');
    expect(body?.contentLocale).toBe('ckb');
  });
});

describe('EasyLiveChat.boot on an already-booted instance', () => {
  let server: FakeServer;

  beforeEach(() => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
  });

  afterEach(async () => {
    EasyLiveChat.instance.shutdown();
    server.restore();
  });

  it('adopts the new config instead of returning early', async () => {
    const elc = EasyLiveChat.instance;
    await elc.boot(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', contentLocale: 'ckb', enableHeartbeat: false },
      { storage: new InMemoryStorage() },
    );
    await elc.loadConfig();
    expect(server.requestsFor('/config').at(-1)?.query.get('locale')).toBe('ckb');

    await elc.boot({
      apiBase: 'https://api.example.com',
      tenantSlug: 'acme',
      contentLocale: 'ar',
      enableHeartbeat: false,
    });
    await elc.loadConfig();
    expect(server.requestsFor('/config').at(-1)?.query.get('locale')).toBe('ar');
  });

  it('validates the config before adopting it', async () => {
    const elc = EasyLiveChat.instance;
    await elc.boot(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      { storage: new InMemoryStorage() },
    );
    await expect(elc.boot({ apiBase: 'api.example.com', tenantSlug: 'acme' })).rejects.toThrow(
      /http\(s\):\/\//,
    );
    await expect(elc.boot({ apiBase: '', tenantSlug: 'acme' })).rejects.toThrow(/apiBase/);
    await expect(
      elc.boot({ apiBase: 'https://api.example.com', tenantSlug: '  ' }),
    ).rejects.toThrow(/tenantSlug/);
  });
});
