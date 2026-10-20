/**
 * React Native, for the Node test runner. See `README.md` beside this file.
 *
 * Two jobs, both done once per test file:
 *
 * 1. `react-native` resolves to `react-native-mock.ts` — for the SDK's own
 *    modules (ES imports, which `vi.mock` intercepts) AND for
 *    `@testing-library/react-native`, which is plain CommonJS loaded by Node
 *    and calls `require('react-native')` itself. `vi.mock` never sees a
 *    `require`, and the real package cannot load under Node, so that one call
 *    is answered by a `Module._load` hook. Both get the same object.
 *
 * 2. The OPTIONAL native peers are absent, deterministically. Every one of
 *    them is imported lazily inside a `try` and degrades when the import
 *    fails, so "not installed" is a state the SDK must handle anyway — and
 *    the real packages, which reach for native modules, would fail the same
 *    way only slower and noisier. A test that wants one present mocks it
 *    itself; its `vi.mock` replaces this one.
 */
import Module from 'node:module';

import { vi } from 'vitest';

vi.mock('react-native', async () => (await import('./react-native-mock')).reactNativeMock);

vi.mock('expo-image', () => {
  throw new Error('expo-image is not installed in tests');
});
vi.mock('expo-audio', () => {
  throw new Error('expo-audio is not installed in tests');
});
vi.mock('expo-file-system', () => {
  throw new Error('expo-file-system is not installed in tests');
});
vi.mock('expo-image-picker', () => {
  throw new Error('expo-image-picker is not installed in tests');
});
vi.mock('expo-document-picker', () => {
  throw new Error('expo-document-picker is not installed in tests');
});
vi.mock('expo-secure-store', () => {
  throw new Error('expo-secure-store is not installed in tests');
});
vi.mock('@react-native-async-storage/async-storage', () => {
  throw new Error('@react-native-async-storage/async-storage is not installed in tests');
});

const { reactNativeMock } = await import('./react-native-mock');

// Globals React Native's runtime defines and Node does not.
const runtime = globalThis as typeof globalThis & {
  requestAnimationFrame?: (cb: (t: number) => void) => unknown;
  cancelAnimationFrame?: (handle: unknown) => void;
};
runtime.requestAnimationFrame ??= (cb) => setTimeout(() => cb(Date.now()), 0);
runtime.cancelAnimationFrame ??= (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>);

type Load = (request: string, parent: unknown, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: Load };
const hooks = globalThis as typeof globalThis & {
  __elcReactNative?: unknown;
  __elcOriginalLoad?: Load;
};

// Re-pointed every file (each file gets a fresh module graph, so a fresh
// mock); the hook itself is installed once per process.
hooks.__elcReactNative = reactNativeMock;
if (hooks.__elcOriginalLoad == null) {
  const original = loader._load;
  hooks.__elcOriginalLoad = original;
  loader._load = function load(this: unknown, request, parent, isMain) {
    if (request === 'react-native') return hooks.__elcReactNative;
    return original.call(this, request, parent, isMain);
  };
}
