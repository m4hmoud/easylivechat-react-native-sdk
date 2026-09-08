/**
 * The smallest observable that `useSyncExternalStore` can bind to.
 *
 * `get()` MUST be referentially stable between `set()` calls — React calls the
 * snapshot getter on every render and compares by reference, so a getter that
 * builds a fresh object each time re-renders forever. That is the classic bug
 * in this pattern, and the reason every piece of state here is stored as a
 * value rather than derived on read.
 */
export interface ReadonlyStore<T> {
  get(): T;
  subscribe(onChange: () => void): () => void;
}

export interface Store<T> extends ReadonlyStore<T> {
  /** No-op when `Object.is(next, current)`, so equal writes do not re-render. */
  set(next: T): void;
}

class StoreImpl<T> implements Store<T> {
  private value: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  // Bound properties, NOT prototype methods. `useSyncExternalStore` is called
  // as `useSyncExternalStore(store.subscribe, store.get)`, which detaches them
  // from the instance — a prototype method would lose `this` and read
  // `undefined.value` on the very first render.
  get = (): T => this.value;

  set = (next: T): void => {
    if (Object.is(next, this.value)) return;
    this.value = next;
    // Iterate a copy: a listener may unsubscribe during notification.
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch {
        // A throwing subscriber is the host's bug; it must not stop the rest,
        // and must never break the socket handler that triggered the write.
      }
    }
  };

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange);
    return () => {
      this.listeners.delete(onChange);
    };
  };
}

export function createStore<T>(initial: T): Store<T> {
  return new StoreImpl(initial);
}

/**
 * A store that never changes, for the pre-`boot()` window.
 *
 * Hooks must be safe before the SDK is booted — a launcher can mount first —
 * so they fall back to one of these rather than throwing. Subscribing is a
 * no-op because nothing can ever write to it.
 */
export function constantStore<T>(value: T): ReadonlyStore<T> {
  return {
    get: () => value,
    subscribe: () => () => {},
  };
}
