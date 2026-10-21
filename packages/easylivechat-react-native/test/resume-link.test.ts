import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChat } from '../src/client';
import { resumeLinkToken } from '../src/internal/resume-link';
import { SessionController } from '../src/session-controller';
import { InMemoryStorage, StorageKeys } from '../src/storage';
import { configBody, fakeJwt, installFakeServer, messageRow, sessionBody, type FakeServer } from './fake-server';
import { createdSockets, resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * "Reply in the chat" from an email (apps/api/src/services/visitor-email.ts):
 * the link carries a token in its fragment; the web widget trades it with
 * `POST /resume-link` for the visitor id that reaches the conversation and
 * adopts it (apps/widget/src/lib/resume-link.ts, Embed.tsx `followResumeLink`),
 * so the ordinary resume opens that chat. `resumeFromLink` does the same — and
 * never lets a signed-in person take over someone else's chat.
 */
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ0ZW5hbnRJZCI6InQxIn0.c2lnbmF0dXJl';
const EMAIL_LINK = `https://shop.example.com/cart?x=1#elc_chat=${TOKEN}`;

const CONFIG = {
  apiBase: 'https://api.example.com',
  tenantSlug: 'acme',
  enableHeartbeat: false,
  enablePresenceSocket: false,
};

describe('resumeLinkToken', () => {
  it('reads the email’s link, our chat page’s, and the bare token', () => {
    expect(resumeLinkToken(EMAIL_LINK)).toBe(TOKEN);
    expect(resumeLinkToken(`https://acme.com/#elc_chat=${TOKEN}`)).toBe(TOKEN);
    expect(resumeLinkToken(`https://chat.livechattools.com/embed?tenant=acme#resume=${TOKEN}`)).toBe(TOKEN);
    expect(resumeLinkToken(`#identity=%7B%7D&resume=${TOKEN}`)).toBe(TOKEN);
    expect(resumeLinkToken(`myapp://chat#elc_chat=${encodeURIComponent(TOKEN)}`)).toBe(TOKEN);
    expect(resumeLinkToken(`  ${TOKEN}  `)).toBe(TOKEN);
  });

  it('ignores anything that is not a token of ours', () => {
    expect(resumeLinkToken('')).toBeNull();
    expect(resumeLinkToken(null)).toBeNull();
    expect(resumeLinkToken('https://shop.example.com/cart')).toBeNull();
    expect(resumeLinkToken('https://shop.example.com/#section-2')).toBeNull();
    expect(resumeLinkToken('#resume=')).toBeNull();
    expect(resumeLinkToken('#resume=<script>')).toBeNull();
    expect(resumeLinkToken('#noresume=a.b.c')).toBeNull();
    expect(resumeLinkToken('#elc_chat=only.two')).toBeNull();
    expect(resumeLinkToken('#elc_chat=%E0%A4%A')).toBeNull(); // malformed escape
    // The token travels in the fragment, never the query: a site's server
    // and analytics would see a query.
    expect(resumeLinkToken(`https://acme.com/?elc_chat=${TOKEN}`)).toBeNull();
  });
});

describe('resumeFromLink', () => {
  let server: FakeServer;
  let storage: InMemoryStorage;
  let controller: SessionController;

  const trades = () => server.requestsFor('/resume-link');
  const sessions = () => server.requestsFor('/session');

  beforeEach(async () => {
    resetFakeSockets();
    storage = new InMemoryStorage();
    await storage.write(StorageKeys.visitorId, 'v-device');
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/resume-link', { body: { visitorId: 'v-linked', conversationId: 'c9' } });
    server.always('/session', {
      body: sessionBody({ token: fakeJwt(), conversationId: 'c9', messages: [messageRow({ id: 'r1', conversationId: 'c9', body: 'We replied' })] }),
    });
    controller = new SessionController(CONFIG, storage);
    await controller.boot();
  });

  afterEach(() => {
    controller.dispose();
    server.restore();
  });

  it('trades the token, becomes that visitor, and resumes their chat', async () => {
    await storage.write(StorageKeys.profile, '{"name":"Someone before"}');
    await expect(controller.resumeFromLink(EMAIL_LINK)).resolves.toBe(true);

    const [trade] = trades();
    expect(trade?.method).toBe('POST');
    expect(trade?.path).toBe('/api/widget/acme/resume-link');
    expect(trade?.body).toEqual({ token: TOKEN });

    expect(controller.visitorId).toBe('v-linked');
    expect(await storage.read(StorageKeys.visitorId)).toBe('v-linked');
    // The cached profile was the previous visitor's.
    expect(await storage.read(StorageKeys.profile)).toBeNull();

    // The ordinary resume, as the visitor the link names.
    expect(sessions().at(-1)?.body).toMatchObject({ visitorId: 'v-linked', resumeOnly: true });
    expect(controller.phase.get()).toBe('chat');
    expect(controller.conversationId).toBe('c9');
    expect(controller.messages.get().map((m) => m.body)).toEqual(['We replied']);
  });

  it('answers false at once, with no request, for a link that is not ours', async () => {
    await expect(controller.resumeFromLink('https://shop.example.com/cart')).resolves.toBe(false);
    expect(server.requests).toEqual([]);
  });

  it('answers false and changes nothing when the server refuses the token', async () => {
    server.always('/resume-link', { status: 410, body: { error: 'LINK_INVALID' } });
    await expect(controller.resumeFromLink(EMAIL_LINK)).resolves.toBe(false);
    expect(controller.visitorId).toBe('v-device');
    expect(await storage.read(StorageKeys.visitorId)).toBe('v-device');
    expect(sessions()).toEqual([]);
  });

  it('answers false for a 2xx that names no visitor', async () => {
    server.always('/resume-link', { body: {} });
    await expect(controller.resumeFromLink(EMAIL_LINK)).resolves.toBe(false);
    expect(controller.visitorId).toBe('v-device');
  });

  it('moves a chat already on screen onto the linked one', async () => {
    server.reply('/session', { body: sessionBody({ token: fakeJwt(), conversationId: 'c1', messages: [messageRow({ body: 'Old chat' })] }) });
    await controller.open();
    const oldSocket = createdSockets.at(-1);
    expect(controller.conversationId).toBe('c1');

    await expect(controller.resumeFromLink(EMAIL_LINK)).resolves.toBe(true);
    expect(oldSocket?.disposed).toBe(true);
    expect(createdSockets.at(-1)).not.toBe(oldSocket);
    expect(controller.conversationId).toBe('c9');
    expect(controller.messages.get().map((m) => m.body)).toEqual(['We replied']);
  });

  it('resumes the device’s own visitor without adopting anything', async () => {
    server.always('/resume-link', { body: { visitorId: 'v-device', conversationId: 'c9' } });
    await expect(controller.resumeFromLink(EMAIL_LINK)).resolves.toBe(true);
    expect(controller.visitorId).toBe('v-device');
    expect(sessions().at(-1)?.body).toMatchObject({ visitorId: 'v-device', resumeOnly: true });
  });

  it('is already there when that visitor’s chat is the open session', async () => {
    server.always('/resume-link', { body: { visitorId: 'v-device', conversationId: 'c9' } });
    await controller.open();
    const before = sessions().length;
    await expect(controller.resumeFromLink(EMAIL_LINK)).resolves.toBe(true);
    expect(sessions()).toHaveLength(before);
  });

  it('keeps an identity the host declared without a userId, as the widget keeps its own', async () => {
    controller.identify({ name: 'Jo', email: 'jo@example.com' });
    await expect(controller.resumeFromLink(EMAIL_LINK)).resolves.toBe(true);
    expect(controller.visitorId).toBe('v-linked');
    expect(sessions().at(-1)?.body).toMatchObject({ visitorId: 'v-linked', name: 'Jo' });
  });

  describe('a signed-in person', () => {
    beforeEach(() => {
      controller.identify({ userId: 'user-ada', userHash: 'h' });
    });

    it('never takes over someone else’s chat', async () => {
      await expect(controller.resumeFromLink(EMAIL_LINK)).resolves.toBe(false);
      expect(controller.visitorId).toBe('v-device');
      await vi.waitFor(async () => expect(await storage.read(StorageKeys.visitorId)).toBe('v-device'));
      expect(sessions().filter((r) => r.body?.visitorId === 'v-linked')).toEqual([]);
    });

    it('still follows a link to the chat this device already holds', async () => {
      server.always('/resume-link', { body: { visitorId: 'v-device', conversationId: 'c9' } });
      await expect(controller.resumeFromLink(EMAIL_LINK)).resolves.toBe(true);
      expect(sessions().at(-1)?.body).toMatchObject({ visitorId: 'v-device', userId: 'user-ada' });
    });
  });

  it('reads a launch with nobody identified, after someone was, as their sign-out first', async () => {
    // A previous launch's signed-in visitor; this one declared nobody.
    const restarted = new SessionController(CONFIG, storage);
    await storage.write(StorageKeys.identifiedUserId, 'user-ada');
    await restarted.boot();
    await expect(restarted.resumeFromLink(EMAIL_LINK)).resolves.toBe(true);
    expect(restarted.visitorId).toBe('v-linked');
    expect(await storage.read(StorageKeys.identifiedUserId)).toBeNull();
    expect(sessions().at(-1)?.body?.userId).toBeUndefined();
    restarted.dispose();
  });
});

describe('the facade', () => {
  let server: FakeServer;

  beforeEach(() => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/resume-link', { body: { visitorId: 'v-linked', conversationId: 'c9' } });
    server.always('/session', { body: sessionBody({ token: fakeJwt(), conversationId: 'c9' }) });
  });

  afterEach(() => {
    EasyLiveChat.instance.shutdown();
    server.restore();
  });

  it('holds a link handed over before boot — the deep link that launched the app', async () => {
    const followed = EasyLiveChat.instance.resumeFromLink(EMAIL_LINK);
    expect(trades()).toEqual([]);
    await EasyLiveChat.instance.boot(CONFIG, { storage: new InMemoryStorage() });
    await expect(followed).resolves.toBe(true);
    expect(EasyLiveChat.instance.visitorId).toBe('v-linked');
    expect(EasyLiveChat.instance.conversationId).toBe('c9');
  });

  it('answers a link that is not ours at once, booted or not', async () => {
    await expect(EasyLiveChat.instance.resumeFromLink('https://acme.com/')).resolves.toBe(false);
    await EasyLiveChat.instance.boot(CONFIG, { storage: new InMemoryStorage() });
    await expect(EasyLiveChat.instance.resumeFromLink('https://acme.com/')).resolves.toBe(false);
    expect(server.requests.filter((r) => r.path.includes('/resume-link'))).toEqual([]);
  });

  it('drops a held link on reset() — it belonged to the person signing out', async () => {
    const followed = EasyLiveChat.instance.resumeFromLink(EMAIL_LINK);
    await EasyLiveChat.instance.reset({ storage: new InMemoryStorage() });
    await expect(followed).resolves.toBe(false);
  });

  function trades() {
    return server.requests.filter((r) => r.path.includes('/resume-link'));
  }
});
