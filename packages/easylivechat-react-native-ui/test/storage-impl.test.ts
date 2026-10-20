import { StorageKeys } from '@easylivechat/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SecureAsyncStorage, secureStoreKey } from '../src/storage-impl';

/**
 * Where each key lives, and that it actually gets there.
 *
 * The stand-in secure store enforces `expo-secure-store`'s own key rule —
 * letters, digits, `.`, `-` and `_`, anything else THROWS — because that rule
 * is the whole story of the bug this file pins: every key the core uses has a
 * colon in it, every secure write threw into a swallowing catch, and the
 * visitor's profile never survived a cold start.
 */
const stores = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  plain: new Map<string, string>(),
  secureFails: false,
}));

vi.mock('expo-secure-store', () => {
  const check = (key: string) => {
    if (!/^[\w.-]+$/.test(key)) {
      throw new Error(
        'Invalid key provided to SecureStore. Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".',
      );
    }
    if (stores.secureFails) throw new Error('keychain unavailable');
  };
  return {
    getItemAsync: async (key: string) => {
      check(key);
      return stores.secure.get(key) ?? null;
    },
    setItemAsync: async (key: string, value: string) => {
      check(key);
      stores.secure.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      check(key);
      stores.secure.delete(key);
    },
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => stores.plain.get(key) ?? null,
    setItem: async (key: string, value: string) => void stores.plain.set(key, value),
    removeItem: async (key: string) => void stores.plain.delete(key),
  },
}));

describe('SecureAsyncStorage', () => {
  let storage: SecureAsyncStorage;

  beforeEach(() => {
    stores.secure.clear();
    stores.plain.clear();
    stores.secureFails = false;
    storage = new SecureAsyncStorage();
  });

  it('keeps the token, the profile and the identified user id in the keychain', async () => {
    await storage.write(StorageKeys.token, 'jwt');
    await storage.write(StorageKeys.profile, '{"email":"a@b.c"}');
    await storage.write(StorageKeys.identifiedUserId, 'user-42@acme.com');

    expect(stores.plain.size).toBe(0);
    expect([...stores.secure.keys()].sort()).toEqual(
      [StorageKeys.token, StorageKeys.profile, StorageKeys.identifiedUserId].map(secureStoreKey).sort(),
    );
  });

  it('…and reads them back — the round trip that never worked with a colon in the key', async () => {
    await storage.write(StorageKeys.profile, '{"name":"Rêber"}');
    await storage.write(StorageKeys.identifiedUserId, 'user-42');
    expect(await storage.read(StorageKeys.profile)).toBe('{"name":"Rêber"}');
    expect(await storage.read(StorageKeys.identifiedUserId)).toBe('user-42');

    await storage.delete(StorageKeys.identifiedUserId);
    expect(await storage.read(StorageKeys.identifiedUserId)).toBeNull();
  });

  it('keeps the opaque ids in AsyncStorage, where a failing keychain cannot lose them', async () => {
    await storage.write(StorageKeys.visitorId, 'v-1');
    await storage.write(StorageKeys.conversationId, 'c-1');
    expect(stores.plain.get(StorageKeys.visitorId)).toBe('v-1');
    expect(stores.plain.get(StorageKeys.conversationId)).toBe('c-1');
    expect(stores.secure.size).toBe(0);
  });

  it('moves a user id an earlier build left in plain text into the keychain, once', async () => {
    stores.plain.set(StorageKeys.identifiedUserId, 'user-42');
    expect(await storage.read(StorageKeys.identifiedUserId)).toBe('user-42');
    expect(stores.plain.has(StorageKeys.identifiedUserId)).toBe(false);
    expect(stores.secure.get(secureStoreKey(StorageKeys.identifiedUserId))).toBe('user-42');
    // Signing out clears both places.
    stores.plain.set(StorageKeys.identifiedUserId, 'stale');
    await storage.delete(StorageKeys.identifiedUserId);
    expect(stores.plain.has(StorageKeys.identifiedUserId)).toBe(false);
    expect(await storage.read(StorageKeys.identifiedUserId)).toBeNull();
  });

  it('a broken keychain never throws: reads are empty, writes are dropped', async () => {
    stores.secureFails = true;
    await expect(storage.write(StorageKeys.token, 'jwt')).resolves.toBeUndefined();
    await expect(storage.read(StorageKeys.token)).resolves.toBeNull();
    await expect(storage.delete(StorageKeys.token)).resolves.toBeUndefined();
    // The plain-text user id is still answered, and left for the next try.
    stores.plain.set(StorageKeys.identifiedUserId, 'user-42');
    expect(await storage.read(StorageKeys.identifiedUserId)).toBe('user-42');
    expect(stores.plain.get(StorageKeys.identifiedUserId)).toBe('user-42');
  });

  it('every core key maps to a distinct secure-store key', () => {
    const all = (Object.values(StorageKeys) as unknown[]).filter((v): v is string => typeof v === 'string');
    const mapped = all.map(secureStoreKey);
    expect(new Set(mapped).size).toBe(all.length);
    for (const key of mapped) expect(key).toMatch(/^[\w.-]+$/);
  });
});
