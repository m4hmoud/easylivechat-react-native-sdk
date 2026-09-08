import { vi } from 'vitest';

/**
 * A recording `fetch` stub.
 *
 * The REST client is exercised for real against this rather than mocked out,
 * so the tests actually assert what goes ON THE WIRE — `historyScope`, the
 * `channel` query parameter on `/config`, whether the resume path carries a
 * phone. Those are the invariants; a mocked `RestClient` would prove none of
 * them.
 */
export interface RecordedRequest {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

export interface FakeServer {
  requests: RecordedRequest[];
  /** Queue one response for the next request matching `path` (a substring). */
  reply(path: string, response: { status?: number; body: unknown }): void;
  /** A standing response used whenever no queued reply matches. */
  always(path: string, response: { status?: number; body: unknown }): void;
  requestsFor(path: string): RecordedRequest[];
  restore(): void;
}

export function installFakeServer(): FakeServer {
  const requests: RecordedRequest[] = [];
  const queued = new Map<string, Array<{ status?: number; body: unknown }>>();
  const standing = new Map<string, { status?: number; body: unknown }>();
  const original = globalThis.fetch;

  const findResponse = (path: string): { status?: number; body: unknown } | null => {
    for (const [key, list] of queued) {
      if (path.includes(key) && list.length > 0) return list.shift() ?? null;
    }
    for (const [key, response] of standing) {
      if (path.includes(key)) return response;
    }
    return null;
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url);
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = null;
      }
    }
    requests.push({
      method: init?.method ?? 'GET',
      url,
      path: parsed.pathname,
      query: parsed.searchParams,
      headers: normalizeHeaders(init?.headers),
      body,
    });

    const response = findResponse(parsed.pathname) ?? { status: 404, body: { error: 'NOT_FOUND' } };
    const status = response.status ?? 200;
    return new Response(JSON.stringify(response.body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return {
    requests,
    reply(path, response) {
      const list = queued.get(path) ?? [];
      list.push(response);
      queued.set(path, list);
    },
    always(path, response) {
      standing.set(path, response);
    },
    requestsFor(path) {
      return requests.filter((r) => r.path.includes(path));
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers == null) return out;
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) out[k.toLowerCase()] = v;
    return out;
  }
  if (headers instanceof Headers) {
    headers.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = String(v);
  return out;
}

/** A minimal but complete `GET /config` body. */
export function configBody(
  overrides: Record<string, unknown> = {},
  configOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    tenantId: 't1',
    isOpen: true,
    agentsAccepting: true,
    chatAvailabilityMode: 'ALWAYS',
    asyncEnabled: false,
    visitorMode: 'CHAT',
    reason: 'OPEN',
    config: {
      id: 'w1',
      tenantId: 't1',
      primaryColor: '#2563EB',
      backgroundColor: '#FFFFFF',
      textColor: '#0F172A',
      welcomeTitle: 'Chat with us',
      welcomeSubtitle: "We're here to help",
      offlineMessage: "We're offline",
      position: 'bottom-right',
      locale: 'en',
      direction: 'ltr',
      soundEnabled: true,
      showAgentAvatars: true,
      showAgentNames: true,
      collectEmailPreChat: false,
      preChatForm: { enabled: false, fields: [] },
      postChatForm: { enabled: false, fields: [] },
      allowedOrigins: [],
      ...configOverrides,
    },
    ...overrides,
  };
}

/**
 * A JWT whose payload decodes but whose signature is meaningless — the SDK
 * never verifies one, it only reads `exp`.
 */
export function fakeJwt(expiresInSeconds = 24 * 3600): string {
  const payload = {
    conversationId: 'c1',
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  };
  const b64 = (o: unknown): string =>
    Buffer.from(JSON.stringify(o))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

/** A `POST /session` body describing an active, resumable conversation. */
export function sessionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    token: fakeJwt(),
    conversationId: 'c1',
    nextCursor: null,
    resumed: true,
    hasActiveConversation: true,
    messages: [],
    ...overrides,
  };
}

/** A server message row, in the trimmed REST shape. */
export function messageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm1',
    conversationId: 'c1',
    body: 'hello',
    senderType: 'AGENT',
    contentType: 'TEXT',
    attachmentUrls: [],
    deliveryStatus: 'SENT',
    createdAt: new Date('2026-09-01T10:00:00.000Z').toISOString(),
    ...overrides,
  };
}
