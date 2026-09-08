import { type Socket, io } from 'socket.io-client';

import { type ChatMessage, parseChatMessage } from './models/chat-message';
import {
  type ProactiveMessage,
  type SendAck,
  parseProactiveMessage,
  parseSendAck,
} from './models/results';
import {
  type WorkspaceAvailability,
  parseWorkspaceAvailability,
} from './models/widget-config';

/** Bound the ack so a socket that drops between emit and ack still resolves. */
const SEND_ACK_TIMEOUT_MS = 20_000;
const END_CHAT_ACK_TIMEOUT_MS = 15_000;

export interface WidgetSocketHandlers {
  /** `message:new` — the raw Prisma row, already parsed leniently. */
  onMessageNew(message: ChatMessage): void;
  /**
   * `message:updated` — a media re-host swap or a delivery receipt. Replace by
   * id. The web client does NOT register this; we do.
   */
  onMessageUpdated(message: ChatMessage): void;
  /** `agent:typing` — requires an explicit `true`. */
  onAgentTyping(isTyping: boolean): void;
  /**
   * `workspace:availability` — the whole verdict, fired on connect and on
   * every change (a shift boundary, an admin editing the schedule).
   */
  onWorkspaceAvailability(availability: WorkspaceAvailability): void;
  /** `messages:read` — a WATERMARK instant, not a message id. */
  onMessagesRead(readAt: Date): void;
  /**
   * `conversation:closed`. NOTE: the server emits on ANY `*→CLOSED`
   * transition, not only OPEN→CLOSED — consumers must guard against re-firing
   * the post-chat step.
   */
  onConversationClosed(conversationId: string): void;
  /** `widget:proactive-message` — also delivered on the conversation room. */
  onProactive(message: ProactiveMessage): void;
  /** True on connect, false on disconnect. */
  onConnectionChange(connected: boolean): void;
  /**
   * `connect_error` — the error/code (e.g. `WIDGET_TOKEN_MISSING`, or a jose
   * verify failure) so the controller can decide whether to re-mint.
   */
  onConnectError(error: string): void;
}

/**
 * Socket.IO client for the `/widgets` namespace (full chat; JWT required).
 *
 * Handshake: the JWT goes in `auth.token` (NOT query, NOT header),
 * `withCredentials: false`, transports `['websocket', 'polling']`. The server
 * auto-joins `tenant:{id}:conv:{convId}` from the JWT — the client joins
 * nothing.
 *
 * The server is `socket.io@4.8.x` (Engine.IO v4), so the client major is
 * pinned to 4.x. A protocol mismatch fails the handshake SILENTLY, which is
 * why the dependency is pinned and integration-tested.
 */
export class WidgetSocket {
  private socket: Socket | null = null;
  private disposed = false;

  constructor(
    private readonly apiBase: string,
    private token: string,
    private readonly handlers: WidgetSocketHandlers,
  ) {}

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  get currentToken(): string {
    return this.token;
  }

  /** Open the socket with the current token and wire all handlers. */
  connect(): void {
    if (this.disposed) return;
    if (this.socket != null) {
      // Idempotent: an existing socket just gets the current auth and a
      // (re)connect.
      this.applyAuth();
      this.socket.connect();
      return;
    }

    const socket = io(`${this.apiBase}/widgets`, {
      transports: ['websocket', 'polling'],
      // Re-mintable JWT in the handshake auth payload (NOT query/header).
      auth: { token: this.token },
      // No cookies; the JWT is the only credential.
      withCredentials: false,
      forceNew: false,
      // The explicit connect() below is the single connection trigger.
      autoConnect: false,
      // Auto-reconnect with backoff: the mobile socket drops constantly
      // (cellular↔wifi, lock screen). The controller backfills the gap.
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });

    this.socket = socket;
    this.wire(socket);
    socket.connect();
  }

  private wire(socket: Socket): void {
    socket.on('connect', () => this.handlers.onConnectionChange(true));
    socket.on('disconnect', () => this.handlers.onConnectionChange(false));
    socket.on('connect_error', (err: unknown) =>
      this.handlers.onConnectError(describeError(err)),
    );
    socket.on('error', (err: unknown) => this.handlers.onConnectError(describeError(err)));
    // Re-supply auth.token on every reconnect attempt — unlike a browser tab,
    // nothing here persists the handshake auth across reconnects for us.
    socket.io.on('reconnect_attempt', () => this.applyAuth());

    socket.on('message:new', (data: unknown) => {
      const m = asRecord(data);
      if (m != null) this.handlers.onMessageNew(parseChatMessage(m));
    });

    socket.on('message:updated', (data: unknown) => {
      const m = asRecord(data);
      if (m != null) this.handlers.onMessageUpdated(parseChatMessage(m));
    });

    socket.on('agent:typing', (data: unknown) => {
      // The server relays whatever the agent sent, `false` included. Require
      // an explicit `true` so a malformed or empty payload cannot show a
      // phantom "agent is typing"; the controller's timeout stays as a
      // backstop for a dropped stop event.
      const m = asRecord(data);
      this.handlers.onAgentTyping(m?.isTyping === true);
    });

    socket.on('workspace:availability', (data: unknown) => {
      const m = asRecord(data);
      // Older servers send only `isOpen`; the absent fields fall back to the
      // permissive defaults inside parseWorkspaceAvailability.
      if (m != null) this.handlers.onWorkspaceAvailability(parseWorkspaceAvailability(m));
    });

    socket.on('messages:read', (data: unknown) => {
      const m = asRecord(data);
      const raw = m?.readAt;
      // A malformed or missing timestamp is DROPPED rather than defaulted to
      // now: "now" would mark every message in the thread read on the strength
      // of a payload we could not read.
      if (typeof raw !== 'string') return;
      const ms = Date.parse(raw);
      if (Number.isNaN(ms)) return;
      this.handlers.onMessagesRead(new Date(ms));
    });

    socket.on('conversation:closed', (data: unknown) => {
      const m = asRecord(data);
      const convId = String(m?.conversationId ?? '');
      if (convId.length > 0) this.handlers.onConversationClosed(convId);
    });

    socket.on('widget:proactive-message', (data: unknown) => {
      const m = asRecord(data);
      if (m != null) this.handlers.onProactive(parseProactiveMessage(m));
    });
  }

  /** Swap the token (after a re-mint); takes effect on the NEXT connect. */
  updateToken(token: string): void {
    this.token = token;
    this.applyAuth();
  }

  /**
   * Force a fresh handshake carrying the current (re-minted) token.
   *
   * A LIVE socket does NOT re-read its handshake auth on a no-op `connect()`,
   * so a stale token would keep flowing until the next natural drop. Setting
   * the auth, disconnecting, then connecting re-handshakes with the new one.
   * `disconnect`/`connect` fire as usual, so the controller backfills the gap.
   */
  reconnectWithFreshAuth(): void {
    const socket = this.socket;
    if (socket == null) {
      this.connect();
      return;
    }
    this.applyAuth();
    socket.disconnect();
    socket.connect();
  }

  /**
   * Push the token into both the live socket's auth and the manager options,
   * so every reconnect handshake carries the current one.
   */
  private applyAuth(): void {
    const socket = this.socket;
    if (socket == null) return;
    const auth = { token: this.token };
    socket.auth = auth;
    try {
      // Belt and braces: the manager re-reads its own options on reconnect in
      // some versions, so keep them in sync too.
      (socket.io.opts as Record<string, unknown>).auth = auth;
    } catch {
      // The options shape varies across minors; `socket.auth` above is the
      // authoritative path.
    }
  }

  /**
   * Emit `message:send { body, attachmentUrls?, contentType? }` and await the
   * ack.
   *
   * `contentType` is omitted so the server infers FILE for an
   * attachment-only/empty body and TEXT otherwise.
   */
  async sendMessage(args: {
    body: string;
    attachmentUrls?: string[];
    contentType?: string;
  }): Promise<SendAck> {
    const socket = this.socket;
    if (socket == null) return { ok: false, error: 'NOT_CONNECTED' };
    const payload: Record<string, unknown> = { body: args.body };
    if (args.attachmentUrls != null && args.attachmentUrls.length > 0) {
      payload.attachmentUrls = args.attachmentUrls;
    }
    if (args.contentType != null) payload.contentType = args.contentType;
    return this.emitWithAck(socket, 'message:send', payload, SEND_ACK_TIMEOUT_MS);
  }

  /** Emit `typing { isTyping }` (the caller debounces). */
  setTyping(isTyping: boolean): void {
    this.socket?.emit('typing', { isTyping });
  }

  /**
   * Tell the server the visitor is looking at the thread.
   *
   * Turns the agent's ticks green. Every other channel learns this from a
   * provider receipt webhook; a native SDK has no provider, so it reports
   * directly. Fire and forget — the server throttles and no-ops once the
   * thread is fully read, so callers can be generous.
   */
  reportSeen(): void {
    this.socket?.emit('messages:seen');
  }

  /**
   * Ask the server to close this conversation on the visitor's behalf.
   *
   * The server marks it CLOSED, tells the agents' inboxes, and echoes
   * `conversation:closed` back down this socket — which is what moves the
   * visitor to the post-chat step. It echoes even when the thread was already
   * closed agent-side, so the survey still appears rather than the visitor
   * tapping "end" and seeing nothing happen.
   */
  async endChat(): Promise<SendAck> {
    const socket = this.socket;
    if (socket == null) return { ok: false, error: 'NOT_CONNECTED' };
    return this.emitWithAck(socket, 'conversation:end', {}, END_CHAT_ACK_TIMEOUT_MS);
  }

  /**
   * Emit with an ack bounded by a timeout, so a socket that drops between emit
   * and ack yields a terminal failure (the optimistic bubble flips to *failed*,
   * tap-to-retry) instead of hanging forever.
   */
  private emitWithAck(
    socket: Socket,
    event: string,
    payload: unknown,
    timeoutMs: number,
  ): Promise<SendAck> {
    return new Promise<SendAck>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: 'ACK_TIMEOUT' });
      }, timeoutMs);
      try {
        socket.emit(event, payload, (raw: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(parseSendAck(raw));
        });
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: describeError(e) });
      }
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
  }

  /** Idempotent: teardown can race a re-mint failure path and dispose. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const socket = this.socket;
    this.socket = null;
    if (socket != null) {
      socket.removeAllListeners();
      socket.io.off('reconnect_attempt');
      socket.disconnect();
    }
  }
}

function asRecord(data: unknown): Record<string, unknown> | null {
  return data != null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

/**
 * Turn a `connect_error`/ack error (Error, map, or string) into a stable
 * code/message string. The server passes `WIDGET_TOKEN_MISSING` and jose
 * verify messages as the Error's `message`.
 */
export function describeError(err: unknown): string {
  if (err == null) return 'UNKNOWN';
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    // Socket.IO attaches server-sent middleware data on `err.data`.
    const data = (err as Error & { data?: unknown }).data;
    if (typeof data === 'string' && data.length > 0) return `${err.message} ${data}`;
    if (data != null && typeof data === 'object') {
      const code = (data as Record<string, unknown>).code ?? (data as Record<string, unknown>).error;
      if (code != null) return `${err.message} ${String(code)}`;
    }
    return err.message;
  }
  if (typeof err === 'object') {
    const m = err as Record<string, unknown>;
    const code = m.code ?? m.message ?? m.type ?? m.error;
    if (code != null) return String(code);
  }
  return String(err);
}
