/**
 * A stand-in for one `socket.io-client` socket.
 *
 * Tests drive the real {@link WidgetSocket} / {@link PresenceSocket} against
 * this, rather than mocking those classes: the handler wiring (which payload
 * shape maps to which controller callback, the `!== false` defaults, the ack
 * timeout) is exactly the part worth covering, and a mocked socket class would
 * skip all of it.
 */
export class FakeSocket {
  readonly handlers = new Map<string, Array<(payload: unknown, ack?: unknown) => void>>();
  readonly managerHandlers = new Map<string, Array<() => void>>();
  readonly emitted: Array<{ event: string; payload: unknown }> = [];

  connected = false;
  auth: unknown = undefined;
  disposed = false;
  connectCount = 0;

  /**
   * Set by a test to answer `emitWithAck` calls synchronously. Returning
   * undefined leaves the ack UNANSWERED and parks its callback in
   * {@link pendingAcks}, so a test can answer it later — which is how the
   * "echo beat the ack" race is reproduced.
   */
  ackResponder: ((event: string, payload: unknown) => unknown) | null = null;

  /** Acks emitted but not yet answered, oldest first. */
  readonly pendingAcks: Array<{
    event: string;
    payload: unknown;
    respond: (raw: unknown) => void;
  }> = [];

  readonly io = {
    opts: {} as Record<string, unknown>,
    on: (event: string, fn: () => void): void => {
      const list = this.managerHandlers.get(event) ?? [];
      list.push(fn);
      this.managerHandlers.set(event, list);
    },
    off: (event: string): void => {
      this.managerHandlers.delete(event);
    },
  };

  constructor(
    readonly url: string,
    readonly opts: Record<string, unknown>,
  ) {}

  on(event: string, fn: (payload: unknown, ack?: unknown) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, payload?: unknown, ack?: (raw: unknown) => void): this {
    this.emitted.push({ event, payload });
    if (ack == null) return this;
    const response = this.ackResponder?.(event, payload);
    if (response !== undefined) {
      ack(response);
      return this;
    }
    this.pendingAcks.push({ event, payload, respond: ack });
    return this;
  }

  connect(): this {
    this.connectCount++;
    this.connected = true;
    this.fire('connect', undefined);
    return this;
  }

  disconnect(): this {
    this.connected = false;
    this.fire('disconnect', undefined);
    return this;
  }

  removeAllListeners(): this {
    this.handlers.clear();
    this.disposed = true;
    return this;
  }

  /** Deliver a server event to whatever the SDK registered for it. */
  fire(event: string, payload: unknown): void {
    for (const fn of this.handlers.get(event) ?? []) fn(payload);
  }

  /** Deliver a manager-level event (`reconnect_attempt`). */
  fireManager(event: string): void {
    for (const fn of this.managerHandlers.get(event) ?? []) fn();
  }

  /** Every payload emitted for one event name. */
  emitsOf(event: string): unknown[] {
    return this.emitted.filter((e) => e.event === event).map((e) => e.payload);
  }
}

/** Every socket the mocked `io()` has handed out, newest last. */
export const createdSockets: FakeSocket[] = [];

export function resetFakeSockets(): void {
  createdSockets.length = 0;
}

/** The mocked `io()` factory. Wire it with `vi.mock('socket.io-client', …)`. */
export function fakeIo(url: string, opts: Record<string, unknown>): FakeSocket {
  const socket = new FakeSocket(url, opts);
  createdSockets.push(socket);
  return socket;
}

/** The most recently created socket for a namespace suffix (`/widgets`). */
export function latestSocket(namespace?: string): FakeSocket {
  const matches =
    namespace == null
      ? createdSockets
      : createdSockets.filter((s) => s.url.endsWith(namespace));
  const socket = matches[matches.length - 1];
  if (socket == null) throw new Error(`no fake socket created for ${namespace ?? 'any namespace'}`);
  return socket;
}
