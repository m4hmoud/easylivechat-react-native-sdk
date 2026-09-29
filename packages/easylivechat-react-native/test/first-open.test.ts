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
 * What `open()` costs before anything can be drawn.
 *
 * `boot()` is deliberately offline, so EVERY round trip the first open needs
 * is one the visitor waits through after tapping. There were three of them,
 * back to back, and one could not possibly have returned anything.
 */
describe('the round trips a first open pays for', () => {
  let server: FakeServer;
  let storage: InMemoryStorage;

  const controller = () =>
    new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      storage,
    );

  /** `POST /session` calls that are resume PROBES, not session creations. */
  const probes = () =>
    server.requestsFor('/session').filter((r) => r.body?.resumeOnly === true);

  beforeEach(() => {
    resetFakeSockets();
    storage = new InMemoryStorage();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
  });

  afterEach(() => server.restore());

  it('does not probe for a conversation under a visitor id it just minted', async () => {
    server.always('/session', { body: sessionBody({ hasActiveConversation: false }) });

    const c = controller();
    await c.boot();
    // The id did not exist before `boot()` ran, so nothing on the server can
    // be keyed to it. Asking is a guaranteed-empty round trip.
    expect(await storage.read(StorageKeys.visitorId)).not.toBeNull();

    await c.open();

    expect(probes()).toHaveLength(0);
    c.dispose();
  });

  it('still probes for a visitor id that came back from storage', async () => {
    await storage.write(StorageKeys.visitorId, 'returning-visitor');
    server.always('/session', { body: sessionBody() });

    const c = controller();
    await c.boot();
    await c.open();

    // This one has been here before: the probe is the only thing that can
    // find the conversation they left open.
    expect(probes()).toHaveLength(1);
    expect(probes()[0]!.body?.visitorId).toBe('returning-visitor');
    c.dispose();
  });

  it('probes again once a session exists under the new id', async () => {
    server.always('/session', { body: sessionBody() });

    const c = controller();
    await c.boot();
    await c.open();
    expect(probes()).toHaveLength(0);

    // The id is no longer fresh — there is a conversation behind it now, and
    // skipping the resume here would strand it and open a second one.
    await c.open();
    expect(probes()).toHaveLength(1);
    c.dispose();
  });

  it('overlaps the config and the resume instead of waiting for one then the other', async () => {
    await storage.write(StorageKeys.visitorId, 'returning-visitor');
    server.always('/session', { body: sessionBody() });

    // Hold `/config` open long enough that a serial `open()` could not have
    // issued anything else, and note whether it had finished when the probe
    // went out.
    let configSettled = false;
    let probeSawSettledConfig: boolean | null = null;
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/session')) probeSawSettledConfig ??= configSettled;
      const res = await inner(input, init);
      if (url.includes('/config')) {
        await new Promise((r) => setTimeout(r, 20));
        configSettled = true;
      }
      return res;
    }) as typeof fetch;

    const c = controller();
    await c.boot();
    await c.open();

    expect(probeSawSettledConfig).toBe(false);
    c.dispose();
  });
});
