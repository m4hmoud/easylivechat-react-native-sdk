/**
 * A v4 UUID for the durable `visitorId`.
 *
 * This has to be a REAL v4 (122 bits of entropy), not a `Math.random()`
 * lookalike: the `visitorId` is the only credential on the
 * `/widget-presence` namespace, so anyone who can guess one can subscribe to
 * that visitor's proactive outreach. It is also the key the server's Contact
 * is resolved by.
 *
 * Sources, in order:
 *   1. a generator the host injected with {@link setUuidGenerator};
 *   2. Web Crypto (`crypto.randomUUID` / `crypto.getRandomValues`), which is
 *      what `react-native-get-random-values` installs and what newer runtimes
 *      have natively;
 *   3. `Math.random()`, with a loud warning — a chat that refuses to open is
 *      worse than a weak id, but the host must fix this.
 *
 * There is deliberately NO `require('expo-crypto')` here. Metro resolves
 * `require` STATICALLY at bundle time: a literal specifier would make
 * `expo-crypto` a hard build-time dependency for every host (breaking the
 * bundle for anyone who skipped an optional peer), and a computed one — which
 * is what this file used to do to keep TypeScript happy — never resolves at
 * runtime at all. That silently degraded every React Native host to
 * `Math.random()`, which is exactly the failure this comment exists to
 * prevent. Injection is explicit, has no bundler failure mode, and lets a host
 * use whatever random source it already trusts.
 */
let cached: (() => string) | null = null;
let injected: (() => string) | null = null;

/**
 * Supply the random source. Call this ONCE, before `boot()`.
 *
 * ```ts
 * import * as Crypto from 'expo-crypto';
 * setUuidGenerator(Crypto.randomUUID);
 * ```
 *
 * Not needed if your app already polyfills Web Crypto — importing
 * `react-native-get-random-values` at your entry point is enough, and this
 * module picks it up on its own.
 *
 * Pass `null` to clear (tests).
 */
export function setUuidGenerator(fn: (() => string) | null): void {
  injected = fn;
  // Drop the memoised resolution so the next call re-evaluates the sources.
  cached = null;
}

function fromBytes(bytes: Uint8Array): string {
  // RFC 4122 §4.4: version 4 in the high nibble of byte 6, variant 10x in the
  // two high bits of byte 8.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push((bytes[i] ?? 0).toString(16).padStart(2, '0'));
  return (
    `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-` +
    `${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
  );
}

type WebCryptoish = {
  randomUUID?: () => string;
  getRandomValues?: (a: Uint8Array) => Uint8Array;
};

function resolveGenerator(): () => string {
  if (injected != null) {
    const fn = injected;
    return () => fn();
  }

  const webCrypto = (globalThis as { crypto?: WebCryptoish }).crypto;
  if (typeof webCrypto?.randomUUID === 'function') {
    return () => webCrypto.randomUUID!();
  }
  if (typeof webCrypto?.getRandomValues === 'function') {
    return () => fromBytes(webCrypto.getRandomValues!(new Uint8Array(16)));
  }

  // Nothing cryptographic is available. Say so loudly and name the fix — this
  // is the one thing the host must act on.
  // eslint-disable-next-line no-console
  console.warn(
    '[EasyLiveChat] No cryptographic random source found; falling back to ' +
      'Math.random() for the visitor id, which is NOT secure. Fix with either:\n' +
      "  import 'react-native-get-random-values';   // at your entry point\n" +
      'or\n' +
      "  import * as Crypto from 'expo-crypto';\n" +
      '  setUuidGenerator(Crypto.randomUUID);       // before boot()',
  );
  return () => {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    return fromBytes(bytes);
  };
}

export function uuidV4(): string {
  cached ??= resolveGenerator();
  return cached();
}

/** Test seam: force a specific generator and bypass memoisation. */
export function __setUuidGenerator(fn: (() => string) | null): void {
  setUuidGenerator(fn);
}
