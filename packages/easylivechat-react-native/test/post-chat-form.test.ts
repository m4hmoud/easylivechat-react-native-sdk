import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChatError, EasyLiveChatErrorCode } from '../src/errors';
import {
  parsePostChatForm,
  postChatHasFields,
  validatePostChatField,
} from '../src/models/post-chat-form';
import { validatePreChatField } from '../src/models/pre-chat-form';
import { SessionController } from '../src/session-controller';
import { InMemoryStorage } from '../src/storage';
import { configBody, fakeJwt, installFakeServer, sessionBody, type FakeServer } from './fake-server';
import { fakeIo, resetFakeSockets } from './fake-socket';

// The factory is HOISTED above the imports, so the fake has to be pulled in
// from inside it — referencing a top-level import here is a ReferenceError.
vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * Port of `post_chat_form_test.dart`: id-keyed submission, validation codes,
 * and 409 as terminal rather than an error.
 */
describe('post-chat form model', () => {
  it('falls back to the built-in CSAT when disabled or empty', () => {
    // `enabled: false` OR an empty `fields` means fall back to the built-in
    // prompt, NOT to nothing — the same rule the web widget follows, so a
    // visitor's experience does not depend on which client they opened.
    expect(postChatHasFields(parsePostChatForm({ enabled: false, fields: [{ id: 'a' }] }))).toBe(
      false,
    );
    expect(postChatHasFields(parsePostChatForm({ enabled: true, fields: [] }))).toBe(false);
    expect(postChatHasFields(parsePostChatForm({ enabled: true, fields: [{ id: 'a' }] }))).toBe(
      true,
    );
    expect(postChatHasFields(null)).toBe(false);
  });

  it('parses the extra post-chat-only field types', () => {
    const form = parsePostChatForm({
      enabled: true,
      fields: [
        { id: 'r', label: 'Rate us', type: 'rating', required: true },
        { id: 'c', label: 'Follow up?', type: 'checkbox' },
      ],
    });
    expect(form.fields.map((f) => f.type)).toEqual(['rating', 'checkbox']);
    expect(form.fields[0]?.required).toBe(true);
  });

  it('validates each type against the server rules', () => {
    const field = (over: Record<string, unknown>) =>
      parsePostChatForm({ enabled: true, fields: [{ id: 'f', label: 'F', ...over }] }).fields[0]!;

    expect(validatePostChatField(field({ required: true }), '')).toBe(
      EasyLiveChatErrorCode.REQUIRED,
    );
    expect(validatePostChatField(field({ required: true }), '   ')).toBe(
      EasyLiveChatErrorCode.REQUIRED,
    );
    // Optional and blank is fine.
    expect(validatePostChatField(field({}), '')).toBeNull();

    expect(validatePostChatField(field({ type: 'email' }), 'nope')).toBe(
      EasyLiveChatErrorCode.INVALID_EMAIL,
    );
    expect(validatePostChatField(field({ type: 'email' }), 'a@b.co')).toBeNull();

    expect(validatePostChatField(field({ type: 'number' }), 'twelve')).toBe(
      EasyLiveChatErrorCode.INVALID_NUMBER,
    );
    expect(validatePostChatField(field({ type: 'number' }), '12.5')).toBeNull();

    const select = field({ type: 'select', options: ['a', 'b'] });
    expect(validatePostChatField(select, 'c')).toBe(EasyLiveChatErrorCode.INVALID_OPTION);
    expect(validatePostChatField(select, 'b')).toBeNull();

    const rating = field({ type: 'rating' });
    expect(validatePostChatField(rating, '0')).toBe(EasyLiveChatErrorCode.INVALID_RATING);
    expect(validatePostChatField(rating, '6')).toBe(EasyLiveChatErrorCode.INVALID_RATING);
    expect(validatePostChatField(rating, '3.5')).toBe(EasyLiveChatErrorCode.INVALID_RATING);
    expect(validatePostChatField(rating, '5')).toBeNull();
  });

  it('mirrors the pre-chat rules for the shared types', () => {
    const preField = { id: 'e', label: 'E', type: 'email' as const, required: true, options: [] };
    expect(validatePreChatField(preField, '')).toBe(EasyLiveChatErrorCode.REQUIRED);
    expect(validatePreChatField(preField, 'a@b')).toBe(EasyLiveChatErrorCode.INVALID_EMAIL);
    expect(validatePreChatField(preField, 'a@b.co')).toBeNull();
  });
});

describe('submitPostChat', () => {
  let server: FakeServer;
  let controller: SessionController;

  beforeEach(async () => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody({ token: fakeJwt() }) });
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

  it('submits keyed by field ID, never by label', () => {
    server.always('/post-chat', { body: { ok: true } });
    return controller.submitPostChat({ q1: '5', q2: 'Great' }).then(() => {
      const req = server.requestsFor('/post-chat').at(-1);
      expect(req?.body?.fields).toEqual({ q1: '5', q2: 'Great' });
      expect(req?.path).toBe('/api/widget/acme/conversations/c1/post-chat');
      expect(req?.headers.authorization).toMatch(/^Bearer /);
    });
  });

  it('sends the content locale so the survey is stored against a language', async () => {
    server.always('/post-chat', { body: { ok: true } });
    controller.applyConfig({
      apiBase: 'https://api.example.com',
      tenantSlug: 'acme',
      contentLocale: 'ckb',
      enableHeartbeat: false,
    });
    await controller.submitPostChat({ q1: '5' });
    expect(server.requestsFor('/post-chat').at(-1)?.body?.locale).toBe('ckb');
  });

  it('treats 409 ALREADY_SUBMITTED as terminal, not as a failure', async () => {
    server.always('/post-chat', { status: 409, body: { error: 'ALREADY_SUBMITTED' } });
    // Resolves rather than rejecting — someone already answered, which is a
    // finished state. Swallowed so the survey does not reappear on the next
    // close event.
    await expect(controller.submitPostChat({ q1: '5' })).resolves.toBeUndefined();
    // …and the session is finished: the socket is dropped and the conversation
    // let go of, so the visitor's next message starts a FRESH chat rather than
    // re-opening the closed one server-side.
    expect(controller.conversationId).toBeNull();
  });

  it('rethrows a genuine failure', async () => {
    server.always('/post-chat', { status: 500, body: { error: 'BOOM' } });
    await expect(controller.submitPostChat({ q1: '5' })).rejects.toBeInstanceOf(EasyLiveChatError);
  });

  it('refuses without a session token', async () => {
    const fresh = new SessionController(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      new InMemoryStorage(),
    );
    await fresh.boot();
    await expect(fresh.submitPostChat({ q1: '5' })).rejects.toMatchObject({
      code: EasyLiveChatErrorCode.NO_TOKEN,
    });
    fresh.dispose();
  });
});
