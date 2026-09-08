import { type Socket, io } from 'socket.io-client';

import { type ProactiveMessage, parseProactiveMessage } from './models/results';
import { describeError } from './widget-socket';

export interface PresenceSocketHandlers {
  onProactive(message: ProactiveMessage): void;
  /**
   * `connect_error` — e.g. a bad tenantSlug/visitorId. Surfaced rather than
   * failing silently, but non-fatal: presence is receive-only outreach, so the
   * worst case is that pre-chat outreach does not arrive.
   */
  onConnectError(error: string): void;
}

/**
 * Socket.IO client for the `/widget-presence` namespace — receive-only, NO JWT.
 *
 * Handshake `query: { tenantSlug, visitorId }`; the server joins
 * `tenant:{id}:visitor:{vid}`. Used BEFORE a conversation/JWT exists, so
 * proactive agent outreach can reach a visitor who has not started chatting.
 *
 * Security note: `visitorId` is the only secret here (122 bits of UUID
 * entropy); anyone who knows it can subscribe. The namespace is receive-only
 * and low-value, which is why that is acceptable.
 */
export class PresenceSocket {
  private socket: Socket | null = null;
  private disposed = false;

  constructor(
    private readonly apiBase: string,
    private readonly tenantSlug: string,
    private readonly visitorId: string,
    private readonly handlers: PresenceSocketHandlers,
  ) {}

  /** Idempotent: a second connect() while already wired is a no-op. */
  connect(): void {
    if (this.disposed || this.socket != null) return;

    const socket = io(`${this.apiBase}/widget-presence`, {
      query: { tenantSlug: this.tenantSlug, visitorId: this.visitorId },
      transports: ['websocket', 'polling'],
      withCredentials: false,
      reconnection: true,
      reconnectionDelay: 1500,
    });
    this.socket = socket;

    socket.on('connect_error', (err: unknown) =>
      this.handlers.onConnectError(describeError(err)),
    );
    socket.on('error', (err: unknown) => this.handlers.onConnectError(describeError(err)));

    // Receive-only: the sole inbound event on this namespace.
    socket.on('widget:proactive-message', (data: unknown) => {
      if (data != null && typeof data === 'object' && !Array.isArray(data)) {
        this.handlers.onProactive(parseProactiveMessage(data as Record<string, unknown>));
      }
    });
  }

  /** Idempotent: teardown can be called from both the session adopt and dispose. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const socket = this.socket;
    this.socket = null;
    if (socket != null) {
      // Clear listeners BEFORE disconnecting, so no late proactive event can
      // land after the controller has let go of this object.
      socket.removeAllListeners();
      socket.disconnect();
    }
  }
}
