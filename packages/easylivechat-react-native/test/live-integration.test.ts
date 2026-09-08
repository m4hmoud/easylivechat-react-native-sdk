import { afterAll, describe, expect, it } from 'vitest';

import { SessionController } from '../src/session-controller';
import { InMemoryStorage } from '../src/storage';

/**
 * A LIVE round trip against a real server.
 *
 * A Socket.IO protocol mismatch fails the handshake **silently** — the client
 * simply never connects, no error is thrown, and every unit test in this
 * folder still passes because they all speak to a fake. Nothing else catches
 * it, which is why this exists.
 *
 * Skipped unless a workspace is supplied:
 *
 * ```sh
 * ELC_API_BASE=https://api.livechattools.com \
 * ELC_TENANT_SLUG=acme \
 *   bunx vitest run live-integration
 * ```
 *
 * It creates a real anonymous conversation in that workspace, so point it at a
 * test tenant.
 */
const API_BASE = process.env.ELC_API_BASE;
const TENANT_SLUG = process.env.ELC_TENANT_SLUG;
const LIVE = API_BASE != null && TENANT_SLUG != null;

const describeLive = LIVE ? describe : describe.skip;

describeLive('live widget protocol', () => {
  const controllers: SessionController[] = [];

  const makeController = (): SessionController => {
    const c = new SessionController(
      {
        apiBase: API_BASE!,
        tenantSlug: TENANT_SLUG!,
        // A live conversation is enough; do not also poke the presence
        // notifier on someone's real dashboard.
        enableHeartbeat: false,
        enablePresenceSocket: false,
      },
      new InMemoryStorage(),
    );
    controllers.push(c);
    return c;
  };

  afterAll(() => {
    for (const c of controllers) c.dispose();
  });

  /**
   * Open, and complete the pre-chat form when the workspace has one.
   *
   * `open()` deliberately stops at `prechat` rather than auto-starting a
   * session — that is the contract. A live test that only called `open()` and
   * then waited for a socket therefore proved nothing on any workspace with a
   * form configured, which is most of them.
   */
  const openAndStart = async (c: SessionController): Promise<void> => {
    const config = await c.loadConfig();
    await c.open();
    if (c.phase.get() !== 'prechat') return;
    const fields: Record<string, string> = {};
    for (const field of config.preChatForm.fields) {
      fields[field.id] =
        field.type === 'email'
          ? 'sdk-integration@example.com'
          : field.type === 'number'
            ? '1'
            : field.type === 'select'
              ? (field.options[0] ?? '')
              : 'SDK integration test';
    }
    await c.startSession({ fields });
  };

  it('fetches a real widget config', async () => {
    const c = makeController();
    await c.boot();
    const config = await c.loadConfig();
    expect(config.id).toBeTruthy();
    expect(config.tenantId).toBeTruthy();
    // The theme fields the UI binds must all be present and parseable.
    expect(config.primaryColor).toMatch(/^#?[0-9a-f]{3,8}$/i);
    expect(['ltr', 'rtl']).toContain(config.direction);
  }, 30_000);

  it('mints a JWT and CONNECTS the /widgets namespace', async () => {
    const c = makeController();
    await c.boot();
    await openAndStart(c);

    // The whole point: the Engine.IO handshake actually completed.
    await waitFor(() => c.connection.get() === 'connected', 20_000);
    expect(c.connection.get()).toBe('connected');
    expect(c.conversationId).toBeTruthy();
    expect(c.phase.get()).toBe('chat');
  }, 40_000);

  it('round-trips a message: optimistic → ack → server row', async () => {
    const c = makeController();
    await c.boot();
    await openAndStart(c);
    await waitFor(() => c.connection.get() === 'connected', 20_000);

    const body = `sdk integration test ${Date.now()}`;
    const { optimistic, serverMessageId } = c.sendMessage(body);
    expect(optimistic.id).toMatch(/^tmp-/);

    const serverId = await serverMessageId;
    expect(serverId).toBeTruthy();
    // Reconciled in place: exactly one row with that body, carrying a real id.
    const rows = c.messages.get().filter((m) => (m.body ?? '') === body);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toMatch(/^tmp-/);
    expect(rows[0]?.isOptimistic).toBe(false);
  }, 60_000);

  it('resumes the same conversation from the same visitorId', async () => {
    const storage = new InMemoryStorage();
    const first = new SessionController(
      { apiBase: API_BASE!, tenantSlug: TENANT_SLUG!, enableHeartbeat: false, enablePresenceSocket: false },
      storage,
    );
    controllers.push(first);
    await first.boot();
    await openAndStart(first);
    await waitFor(() => first.connection.get() === 'connected', 20_000);
    const conversationId = first.conversationId;
    first.dispose();

    const second = new SessionController(
      { apiBase: API_BASE!, tenantSlug: TENANT_SLUG!, enableHeartbeat: false, enablePresenceSocket: false },
      storage,
    );
    controllers.push(second);
    await second.boot();
    await expect(second.silentResume()).resolves.toBe(true);
    expect(second.conversationId).toBe(conversationId);
  }, 60_000);
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}
