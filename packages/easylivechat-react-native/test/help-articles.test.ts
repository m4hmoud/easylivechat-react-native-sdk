import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChatError } from '../src/errors';
import { parseHelpArticle, parseHelpArticleList } from '../src/models/help-articles';
import { parseWidgetConfig } from '../src/models/widget-config';
import { SessionController } from '../src/session-controller';
import { InMemoryStorage, StorageKeys } from '../src/storage';
import { configBody, installFakeServer, type FakeServer } from './fake-server';
import { resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * Help articles: anonymous endpoints — no token, only a booted client. What
 * goes on the wire is the contract, so the REST client runs for real against
 * the recording fetch stub.
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const summary = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'a1',
  title: 'Returns',
  excerpt: 'You can send it back within 30 days.',
  category: 'Orders',
  updatedAt: '2026-10-01T09:00:00.000Z',
  ...overrides,
});

const article = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'a1',
  title: 'Returns',
  body: '# Returns\nSend it back.',
  category: 'Orders',
  locale: 'en',
  updatedAt: '2026-10-01T09:00:00.000Z',
  url: 'https://acme.livechattools.com/help/a1',
  ...overrides,
});

describe('help articles', () => {
  let server: FakeServer;
  let storage: InMemoryStorage;

  const controller = (contentLocale?: string): SessionController =>
    new SessionController(
      {
        apiBase: 'https://api.example.com/',
        tenantSlug: 'acme',
        enableHeartbeat: false,
        contentLocale,
      },
      storage,
    );

  beforeEach(() => {
    resetFakeSockets();
    storage = new InMemoryStorage();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
  });

  afterEach(() => server.restore());

  describe('listing and searching', () => {
    it('lists the top articles with no query, in the content locale', async () => {
      server.always('/help/articles', {
        body: { enabled: true, articles: [summary()], categories: ['Orders'] },
      });
      const c = controller('ckb');
      await c.boot();
      const list = await c.searchHelp('');

      const req = server.requestsFor('/help/articles')[0];
      expect(req?.method).toBe('GET');
      expect(req?.path).toBe('/api/widget/acme/help/articles');
      expect(req?.query.has('q')).toBe(false);
      expect(req?.query.get('locale')).toBe('ckb');
      expect(req?.headers.authorization).toBeUndefined();

      expect(list.enabled).toBe(true);
      expect(list.categories).toEqual(['Orders']);
      expect(list.articles).toEqual([
        {
          id: 'a1',
          title: 'Returns',
          excerpt: 'You can send it back within 30 days.',
          category: 'Orders',
          updatedAt: new Date('2026-10-01T09:00:00.000Z'),
        },
      ]);
      c.dispose();
    });

    it('searches with q, category and limit', async () => {
      server.always('/help/articles', { body: { enabled: true, articles: [], categories: [] } });
      const c = controller();
      await c.boot();
      await c.searchHelp('  refund policy ', { category: 'Billing', limit: 3 });
      const query = server.requestsFor('/help/articles')[0]?.query;
      expect(query?.get('q')).toBe('refund policy');
      expect(query?.get('category')).toBe('Billing');
      expect(query?.get('limit')).toBe('3');
      // No contentLocale configured → no locale parameter at all.
      expect(query?.has('locale')).toBe(false);
      c.dispose();
    });

    it('reads a workspace with the switch off', async () => {
      server.always('/help/articles', { body: { enabled: false, articles: [], categories: [] } });
      const c = controller();
      await c.boot();
      expect(await c.searchHelp('')).toEqual({ enabled: false, articles: [], categories: [] });
      c.dispose();
    });

    it('surfaces a refusal as a typed error', async () => {
      server.always('/help/articles', { status: 429, body: { error: 'RATE_LIMITED' } });
      const c = controller();
      await c.boot();
      const error = await c.searchHelp('refund').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(EasyLiveChatError);
      expect((error as EasyLiveChatError).code).toBe('RATE_LIMITED');
      expect((error as EasyLiveChatError).httpStatus).toBe(429);
      c.dispose();
    });
  });

  describe('reading one', () => {
    it('fetches the article and records the view with the visitor and session ids', async () => {
      server.always('/view', { body: { ok: true, counted: true } });
      server.always('/help/articles/', { body: { article: article({ id: 'a 1' }) } });
      const c = controller('ar');
      await c.boot();
      const got = await c.getHelpArticle('a 1');

      const get = server.requestsFor('/help/articles/')[0];
      expect(get?.method).toBe('GET');
      expect(get?.url).toContain('/api/widget/acme/help/articles/a%201?');
      expect(get?.query.get('locale')).toBe('ar');
      expect(got).toEqual({
        id: 'a 1',
        title: 'Returns',
        body: '# Returns\nSend it back.',
        category: 'Orders',
        locale: 'en',
        updatedAt: new Date('2026-10-01T09:00:00.000Z'),
        url: 'https://acme.livechattools.com/help/a1',
      });

      await flush();
      const view = server.requestsFor('/view')[0];
      expect(view?.method).toBe('POST');
      expect(view?.url).toContain('/api/widget/acme/help/articles/a%201/view');
      expect(view?.body).toEqual({ visitorId: c.visitorId, sessionId: c.helpSessionId });
      c.dispose();
    });

    it('never lets a failed view count cost the visitor the article', async () => {
      server.always('/view', { status: 400, body: { ok: false, error: 'INVALID_PAYLOAD' } });
      server.always('/help/articles/', { body: { article: article() } });
      const c = controller();
      await c.boot();
      await expect(c.getHelpArticle('a1')).resolves.toMatchObject({ id: 'a1' });
      await flush();
      expect(server.requestsFor('/view')).toHaveLength(1);
      c.dispose();
    });

    it('rejects NOT_FOUND for an article that is gone', async () => {
      server.always('/help/articles/', { status: 404, body: { error: 'NOT_FOUND' } });
      const c = controller();
      await c.boot();
      const error = await c.getHelpArticle('gone').catch((e: unknown) => e);
      expect((error as EasyLiveChatError).code).toBe('NOT_FOUND');
      await flush();
      expect(server.requestsFor('/view')).toHaveLength(0);
      c.dispose();
    });

    it('treats a 2xx without an article as a protocol error, not a crash', async () => {
      server.always('/help/articles/', { body: { nope: true } });
      const c = controller();
      await c.boot();
      const error = await c.getHelpArticle('a1').catch((e: unknown) => e);
      expect((error as EasyLiveChatError).code).toBe('UNKNOWN');
      c.dispose();
    });
  });

  describe('"was this helpful?"', () => {
    it('posts the answer under the same session id as the view', async () => {
      server.always('/feedback', { body: { ok: true } });
      server.always('/view', { body: { ok: true, counted: true } });
      server.always('/help/articles/', { body: { article: article() } });
      const c = controller();
      await c.boot();
      await c.getHelpArticle('a1');
      await c.rateHelpArticle('a1', false);
      await flush();

      const feedback = server.requestsFor('/feedback')[0];
      expect(feedback?.method).toBe('POST');
      expect(feedback?.path).toBe('/api/widget/acme/help/articles/a1/feedback');
      expect(feedback?.body).toEqual({
        visitorId: c.visitorId,
        sessionId: c.helpSessionId,
        helpful: false,
      });
      expect(server.requestsFor('/view')[0]?.body?.sessionId).toBe(c.helpSessionId);
      c.dispose();
    });

    it('keeps one session id per client, and a fresh one per boot', async () => {
      const first = controller();
      await first.boot();
      const id = first.helpSessionId;
      expect(id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(first.helpSessionId).toBe(id);
      first.dispose();

      const second = controller();
      await second.boot();
      expect(second.helpSessionId).not.toBe(id);
      // …while the visitor stays the same person.
      expect(second.visitorId).toBe(await storage.read(StorageKeys.visitorId));
      second.dispose();
    });

    it('rejects with a typed error when the answer is refused', async () => {
      server.always('/feedback', { status: 404, body: { ok: false, error: 'NOT_FOUND' } });
      const c = controller();
      await c.boot();
      const error = await c.rateHelpArticle('a1', true).catch((e: unknown) => e);
      expect((error as EasyLiveChatError).code).toBe('NOT_FOUND');
      c.dispose();
    });
  });

  describe('parsing', () => {
    it('ignores unknown fields and defaults missing ones', () => {
      const list = parseHelpArticleList({
        enabled: true,
        extra: 'ignored',
        articles: [
          { id: 'a1', title: 'T', surprise: 42 },
          { title: 'no id — nothing to open' },
          'not an object',
          null,
          summary({ id: 'a2', category: '  ', updatedAt: 'not a date' }),
        ],
        categories: ['Orders', '', 'Orders', 7, 'Billing'],
      });
      expect(list.articles).toEqual([
        { id: 'a1', title: 'T', excerpt: '', category: null, updatedAt: null },
        {
          id: 'a2',
          title: 'Returns',
          excerpt: 'You can send it back within 30 days.',
          category: null,
          updatedAt: null,
        },
      ]);
      expect(list.categories).toEqual(['Orders', 'Billing']);
    });

    it('reads an empty or malformed list as disabled and empty', () => {
      expect(parseHelpArticleList({})).toEqual({ enabled: false, articles: [], categories: [] });
      expect(parseHelpArticleList({ enabled: 'yes', articles: 'nope' })).toEqual({
        enabled: false,
        articles: [],
        categories: [],
      });
    });

    it('defaults an article', () => {
      expect(parseHelpArticle({ id: 'a1' })).toEqual({
        id: 'a1',
        title: '',
        body: '',
        category: null,
        locale: null,
        updatedAt: null,
        url: '',
      });
    });

    it('reads helpArticlesEnabled off the widget config, false when absent', () => {
      const raw = configBody().config as Record<string, unknown>;
      expect(parseWidgetConfig(raw).helpArticlesEnabled).toBe(false);
      expect(parseWidgetConfig({ ...raw, helpArticlesEnabled: true }).helpArticlesEnabled).toBe(true);
      expect(parseWidgetConfig({ ...raw, helpArticlesEnabled: 'true' }).helpArticlesEnabled).toBe(false);
    });
  });
});
