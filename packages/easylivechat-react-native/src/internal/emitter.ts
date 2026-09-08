/**
 * A minimal one-payload event source.
 *
 * The public `onMessage` / `onProactiveMessage` / `onError` surfaces are
 * events, not state: a host wants each arrival, not the latest value, so these
 * are deliberately NOT stores. Subscribing returns the unsubscribe function,
 * which is what a `useEffect` cleanup wants.
 */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();
  private closed = false;

  subscribe(fn: (value: T) => void): () => void {
    if (this.closed) return () => {};
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(value: T): void {
    if (this.closed) return;
    // Iterate a copy: a listener may unsubscribe (or subscribe) during
    // dispatch, and mutating the live Set mid-iteration would skip a listener.
    for (const fn of [...this.listeners]) {
      try {
        fn(value);
      } catch {
        // A throwing listener is the host's bug, not ours — it must not stop
        // the other listeners, and must never break the socket handler that
        // is emitting.
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }
}
