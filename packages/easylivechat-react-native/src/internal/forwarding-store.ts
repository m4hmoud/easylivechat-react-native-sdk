import type { ReadonlyStore } from '../store';

/**
 * A store whose backing store can be swapped underneath its subscribers.
 *
 * Hooks must be safe BEFORE `boot()` — a launcher bubble can mount before the
 * host has booted the SDK — and must start reflecting real state the moment it
 * boots, without the component re-mounting. A hook bound directly to the
 * controller's stores could do neither: there is no controller to bind to yet,
 * and `boot()` creates a brand-new set.
 *
 * So the facade exposes one of these per piece of state, created once and
 * never replaced. It reads through to whichever controller store exists right
 * now, falls back to a sane default when there is none, and re-wires every
 * subscriber when the controller is created, replaced or disposed.
 *
 * `get` and `subscribe` are bound properties, not methods: `useSyncExternalStore`
 * re-subscribes whenever the `subscribe` identity changes, so they have to be
 * stable for the life of the object.
 */
export class ForwardingStore<T> implements ReadonlyStore<T> {
  private listeners = new Set<() => void>();
  private unsubscribeInner: (() => void) | null = null;

  constructor(
    private readonly resolve: () => ReadonlyStore<T> | null,
    private readonly fallback: T,
  ) {}

  get = (): T => {
    const inner = this.resolve();
    return inner != null ? inner.get() : this.fallback;
  };

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange);
    if (this.listeners.size === 1) this.attach();
    return () => {
      this.listeners.delete(onChange);
      if (this.listeners.size === 0) this.detach();
    };
  };

  /**
   * Called by the facade when the controller changes. Re-points at the new
   * inner store and notifies, so every bound hook re-reads.
   */
  rebind(): void {
    if (this.listeners.size === 0) return;
    this.detach();
    this.attach();
    this.notify();
  }

  private attach(): void {
    const inner = this.resolve();
    if (inner == null) return;
    this.unsubscribeInner = inner.subscribe(() => this.notify());
  }

  private detach(): void {
    this.unsubscribeInner?.();
    this.unsubscribeInner = null;
  }

  private notify(): void {
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch {
        // A throwing subscriber must not stop the rest.
      }
    }
  }
}
