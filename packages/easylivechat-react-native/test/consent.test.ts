import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChat } from '../src/client';
import { EasyLiveChatError, EasyLiveChatErrorCode } from '../src/errors';
import { parsePostChatFieldType, parsePreChatFieldType } from '../src/models/enums';
import {
  type PreChatField,
  type PreChatForm,
  cleanPolicyUrl,
  parsePreChatField,
  validateConsents,
  validatePreChatConsent,
  validatePreChatField,
} from '../src/models/pre-chat-form';
import { RestClient } from '../src/rest-client';
import { resolveConfig } from '../src/config';
import { SessionController } from '../src/session-controller';
import { InMemoryStorage } from '../src/storage';
import { configBody, installFakeServer, sessionBody, type FakeServer } from './fake-server';
import { resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * Port of `consent_test.dart`.
 *
 * A consent field is a checkbox, not a value: its `label` is the sentence the
 * visitor agrees to, and what goes to the server is the list of ticked ids
 * beside the `consent` capability. The server only sends consent fields to a
 * client that asks (`?caps=consent`) and only demands them from one that
 * declares it (`capabilities: ['consent']`), so the invariants here are about
 * WHEN this SDK asks and declares — never over a form it did not draw — as
 * much as about what it sends.
 */

const CONSENT_FORM = {
  enabled: true,
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    {
      id: 'privacy',
      label: 'I agree to the privacy notice.',
      type: 'consent',
      required: true,
      policyUrl: 'https://example.com/privacy',
    },
  ],
};

describe('parsing', () => {
  it('reads a consent field and its policy link', () => {
    const f = parsePreChatField({
      id: 'privacy',
      label: 'I agree to the processing of my data.',
      type: 'consent',
      required: true,
      policyUrl: 'https://example.com/privacy',
    });
    expect(f.type).toBe('consent');
    expect(f.required).toBe(true);
    expect(f.policyUrl).toBe('https://example.com/privacy');
  });

  it('drops a policy link that is not http(s)', () => {
    for (const bad of [
      'javascript:alert(1)',
      'ftp://example.com/p',
      'https://localhost/p',
      'https://exa mple.com',
      'https://user@example.com/p',
      '',
      42,
    ]) {
      const f = parsePreChatField({ id: 'c', label: 'x', type: 'consent', policyUrl: bad });
      expect(f.policyUrl, String(bad)).toBeUndefined();
    }
  });

  it('keeps a link only on a consent field, and gives consent no placeholder', () => {
    expect(
      parsePreChatField({ id: 'n', label: 'N', type: 'text', policyUrl: 'https://example.com/p' })
        .policyUrl,
    ).toBeUndefined();
    expect(
      parsePreChatField({ id: 'c', label: 'x', type: 'consent', placeholder: 'p' }).placeholder,
    ).toBeUndefined();
  });

  it('an unknown type still reads as text', () => {
    expect(parsePreChatFieldType('signature')).toBe('text');
  });

  it('consent belongs to the pre-chat form only', () => {
    expect(parsePreChatFieldType('consent')).toBe('consent');
    expect(parsePostChatFieldType('consent')).toBe('text');
    expect(parsePostChatFieldType('checkbox')).toBe('checkbox');
  });
});

describe('cleanPolicyUrl matches the server', () => {
  it('accepts what the server stores', () => {
    for (const ok of [
      'https://example.com',
      'http://example.com/privacy',
      'HTTPS://Example.COM/a?b=c#d',
      '  https://example.com/privacy  ',
      'https://sub.example.co.uk/p/q',
    ]) {
      expect(cleanPolicyUrl(ok), ok).toBe(ok.trim());
    }
  });

  it('refuses an over-long link', () => {
    expect(cleanPolicyUrl(`https://example.com/${'a'.repeat(500)}`)).toBeNull();
  });
});

describe('validation', () => {
  const consent: PreChatField = {
    id: 'privacy',
    label: 'I agree',
    type: 'consent',
    required: true,
    options: [],
  };
  const optional: PreChatField = { ...consent, id: 'news', required: false };
  const name: PreChatField = { id: 'name', label: 'Name', type: 'text', required: true, options: [] };

  it('consent is never a value', () => {
    expect(validatePreChatField(consent, undefined)).toBeNull();
    expect(validatePreChatField(consent, '')).toBeNull();
  });

  it('a required consent must be ticked', () => {
    expect(validatePreChatConsent(consent, false)).toBe(EasyLiveChatErrorCode.CONSENT_REQUIRED);
    expect(validatePreChatConsent(consent, true)).toBeNull();
    expect(validatePreChatConsent(optional, false)).toBeNull();
    expect(validatePreChatConsent(name, false)).toBeNull();
  });

  it('validateConsents mirrors the server: first missing, else the accepted in form order', () => {
    const terms: PreChatField = { ...consent, id: 'terms' };
    const form: PreChatForm = { enabled: true, fields: [name, optional, consent, terms] };
    expect(validateConsents(form, [])).toEqual({
      ok: false,
      error: 'CONSENT_REQUIRED',
      fieldId: 'privacy',
    });
    expect(validateConsents(form, ['privacy'])).toMatchObject({ ok: false, fieldId: 'terms' });
    const ok = validateConsents(form, ['terms', 'privacy', 'news', 'unknown']);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.accepted.map((f) => f.id)).toEqual(['news', 'privacy', 'terms']);
  });

  it('a disabled form asks for nothing', () => {
    expect(validateConsents({ enabled: false, fields: [consent] }, []).ok).toBe(true);
  });
});

describe('wire', () => {
  let server: FakeServer;
  let rest: RestClient;

  beforeEach(() => {
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
    server.always('/offline-form', { body: { conversationId: 'c2' } });
    rest = new RestClient(resolveConfig({ apiBase: 'https://api.example.com', tenantSlug: 'acme' }));
  });

  afterEach(() => server.restore());

  it('config asks for consent fields only when told to', async () => {
    await rest.getConfig();
    expect(server.requestsFor('/config').at(-1)?.query.has('caps')).toBe(false);
    await rest.getConfig({ consent: true });
    expect(server.requestsFor('/config').at(-1)?.query.get('caps')).toBe('consent');
  });

  it('a session sends the ticked ids with the capability, deduplicated', async () => {
    await rest.postSession({ visitorId: 'v1', consents: ['privacy', 'privacy', 'news'] });
    const body = server.requestsFor('/session').at(-1)?.body;
    expect(body?.capabilities).toEqual(['consent']);
    expect(body?.consents).toEqual(['privacy', 'news']);
  });

  it('an empty list still declares the capability', async () => {
    await rest.postSession({ visitorId: 'v1', consents: [] });
    const body = server.requestsFor('/session').at(-1)?.body;
    expect(body?.capabilities).toEqual(['consent']);
    expect(body?.consents).toEqual([]);
  });

  it('no consents, no capability — the request an older SDK made', async () => {
    await rest.postSession({ visitorId: 'v1', fields: { name: 'Ada' } });
    const body = server.requestsFor('/session').at(-1)?.body;
    expect(body).not.toHaveProperty('capabilities');
    expect(body).not.toHaveProperty('consents');
  });

  it('the offline form carries consents the same way', async () => {
    await rest.postOfflineForm({ message: 'hi', consents: ['privacy'] });
    expect(server.requestsFor('/offline-form').at(-1)?.body?.consents).toEqual(['privacy']);
    await rest.postOfflineForm({ message: 'hi' });
    expect(server.requestsFor('/offline-form').at(-1)?.body).not.toHaveProperty('capabilities');
  });

  it('CONSENT_REQUIRED decodes like any field error', async () => {
    server.reply('/session', {
      status: 400,
      body: { error: 'CONSENT_REQUIRED', fieldId: 'privacy' },
    });
    const err = await rest.postSession({ visitorId: 'v1', consents: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EasyLiveChatError);
    expect((err as EasyLiveChatError).code).toBe(EasyLiveChatErrorCode.CONSENT_REQUIRED);
    expect((err as EasyLiveChatError).fieldId).toBe('privacy');
    expect((err as EasyLiveChatError).httpStatus).toBe(400);
  });
});

describe('controller', () => {
  let server: FakeServer;
  let c: SessionController;

  const boot = async (
    opts: { supportsConsent?: boolean; form?: Record<string, unknown> } = {},
  ): Promise<SessionController> => {
    server.always('/config', {
      body: configBody({}, { preChatForm: opts.form ?? CONSENT_FORM }),
    });
    const controller = new SessionController(
      {
        apiBase: 'https://api.example.com',
        tenantSlug: 'acme',
        enableHeartbeat: false,
        enablePresenceSocket: false,
      },
      new InMemoryStorage(),
    );
    controller.supportsConsent = opts.supportsConsent ?? true;
    await controller.boot();
    return controller;
  };

  /** The session CREATE requests, not the passive resume probes. */
  const creates = () =>
    server.requestsFor('/session').filter((r) => r.body?.resumeOnly !== true);

  beforeEach(() => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/session', { body: sessionBody({ resumed: false }) });
    server.always('/offline-form', { body: { conversationId: 'c2' } });
  });

  afterEach(() => {
    c?.dispose();
    server.restore();
  });

  it('asks for consent fields when it can draw them', async () => {
    c = await boot();
    const cfg = await c.loadConfig();
    expect(server.requestsFor('/config').at(-1)?.query.get('caps')).toBe('consent');
    expect(cfg.preChatForm.fields.find((f) => f.type === 'consent')?.policyUrl).toBe(
      'https://example.com/privacy',
    );
  });

  it('does not ask when it cannot', async () => {
    c = await boot({ supportsConsent: false });
    await c.loadConfig();
    expect(server.requestsFor('/config').at(-1)?.query.has('caps')).toBe(false);
  });

  it('refreshAvailability asks the same way', async () => {
    c = await boot();
    await c.refreshAvailability();
    expect(server.requestsFor('/config').at(-1)?.query.get('caps')).toBe('consent');
  });

  it('a new chat declares the capability and the ticked ids', async () => {
    c = await boot();
    await c.loadConfig();
    await c.startSession({ fields: { name: 'Ada' }, consents: ['privacy'] });
    const body = creates().at(-1)?.body;
    expect(body?.capabilities).toEqual(['consent']);
    expect(body?.consents).toEqual(['privacy']);
    // Consent is not a value.
    expect(body?.fields).toEqual({ name: 'Ada' });
  });

  it('a required consent left unticked fails before the round trip', async () => {
    c = await boot();
    await c.loadConfig();
    const err = await c.startSession({ fields: { name: 'Ada' } }).catch((e: unknown) => e);
    expect((err as EasyLiveChatError).code).toBe('CONSENT_REQUIRED');
    expect((err as EasyLiveChatError).fieldId).toBe('privacy');
    expect(creates()).toHaveLength(0);
  });

  it('the value fields are checked first, as the server does', async () => {
    c = await boot();
    await c.loadConfig();
    const err = await c.startSession({ fields: {} }).catch((e: unknown) => e);
    expect((err as EasyLiveChatError).code).toBe('REQUIRED');
    expect((err as EasyLiveChatError).fieldId).toBe('name');
  });

  it('never declares over a form fetched without consent', async () => {
    c = await boot({ supportsConsent: false });
    await c.loadConfig();
    await c.startSession({ fields: { name: 'Ada' }, consents: ['privacy'] });
    const body = creates().at(-1)?.body;
    expect(body).not.toHaveProperty('capabilities');
    expect(body).not.toHaveProperty('consents');
  });

  it('a host-identified visitor saw no form and is asked nothing', async () => {
    c = await boot();
    c.identify({ name: 'Ada', email: 'ada@example.com' });
    await c.open();
    const body = creates().at(-1)?.body;
    expect(body).toBeDefined();
    expect(body).not.toHaveProperty('capabilities');
    expect(c.phase.get()).toBe('chat');
  });

  it('an anonymous start has no form to tick', async () => {
    c = await boot({ form: { enabled: false, fields: [] } });
    await c.open();
    const body = creates().at(-1)?.body;
    expect(body).toBeDefined();
    expect(body).not.toHaveProperty('capabilities');
  });

  it('an older server sends no consent field; nothing is demanded', async () => {
    // It ignores `caps` and its form has no consent field. The capability is
    // still declared — with nothing ticked, which nothing requires.
    c = await boot({
      form: { enabled: true, fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] },
    });
    await c.loadConfig();
    await c.startSession({ fields: { name: 'Ada' } });
    expect(creates().at(-1)?.body?.consents).toEqual([]);
    expect(c.phase.get()).toBe('chat');
  });

  it('the offline form checks and sends consents', async () => {
    c = await boot();
    await c.loadConfig();
    const err = await c.submitOfflineForm({ message: 'hi', consents: [] }).catch((e: unknown) => e);
    expect((err as EasyLiveChatError).code).toBe('CONSENT_REQUIRED');
    await c.submitOfflineForm({ message: 'hi', consents: ['privacy'] });
    expect(server.requestsFor('/offline-form').at(-1)?.body?.consents).toEqual(['privacy']);
    await c.submitOfflineForm({ message: 'hi' });
    expect(server.requestsFor('/offline-form').at(-1)?.body).not.toHaveProperty('capabilities');
  });
});

describe('facade', () => {
  let server: FakeServer;

  beforeEach(() => {
    resetFakeSockets();
    server = installFakeServer();
  });

  afterEach(() => {
    EasyLiveChat.instance.shutdown();
    EasyLiveChat.instance.supportsConsent = false;
    server.restore();
  });

  it('supportsConsent can be set before boot and reaches the config fetch', async () => {
    server.always('/config', { body: configBody({}, { preChatForm: CONSENT_FORM }) });
    expect(EasyLiveChat.instance.supportsConsent).toBe(false);
    EasyLiveChat.instance.supportsConsent = true;
    await EasyLiveChat.instance.boot(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      { storage: new InMemoryStorage() },
    );
    expect(EasyLiveChat.instance.supportsConsent).toBe(true);
    await EasyLiveChat.instance.loadConfig();
    expect(server.requestsFor('/config').at(-1)?.query.get('caps')).toBe('consent');
  });
});
