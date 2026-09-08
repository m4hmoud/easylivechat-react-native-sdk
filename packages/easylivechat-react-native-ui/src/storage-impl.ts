import { type EasyLiveChatStorage, StorageKeys } from '@easylivechat/react-native';

/**
 * The durable {@link EasyLiveChatStorage} production apps should inject.
 *
 * Splits persistence by sensitivity:
 *  • the widget **JWT** (`StorageKeys.token`) and the cached **profile**
 *    (`StorageKeys.profile` — the visitor's name / email / pre-chat answers,
 *    i.e. PII) → `expo-secure-store` (Keychain / EncryptedSharedPreferences);
 *  • the durable **visitorId** and **conversationId** (opaque, non-sensitive)
 *    → `@react-native-async-storage/async-storage`.
 *
 * THE VISITOR ID MUST SURVIVE COLD STARTS. If it regenerates, every relaunch
 * creates a new server-side Contact and orphans prior conversations and CSAT.
 * AsyncStorage is the durable choice for it: `expo-secure-store` has a value
 * size limit and can fail outright on some devices, and a failed read there
 * would silently mint a new visitor.
 */
export class SecureAsyncStorage implements EasyLiveChatStorage {
  /** True for keys that must live in secure storage. */
  private isSecure(key: string): boolean {
    return key === StorageKeys.token || key === StorageKeys.profile;
  }

  async read(key: string): Promise<string | null> {
    try {
      if (this.isSecure(key)) return (await secureStore()).getItemAsync(key);
      return (await asyncStorage()).getItem(key);
    } catch {
      // A key we cannot read is a key we do not have. Throwing here would
      // break `boot()` on a device with a broken keychain, when carrying on
      // anonymously is a perfectly good outcome.
      return null;
    }
  }

  async write(key: string, value: string): Promise<void> {
    try {
      if (this.isSecure(key)) {
        await (await secureStore()).setItemAsync(key, value);
        return;
      }
      await (await asyncStorage()).setItem(key, value);
    } catch {
      // Same reasoning: a chat that refuses to open because the keychain is
      // unavailable is worse than one that cannot resume next launch.
    }
  }

  async delete(key: string): Promise<void> {
    try {
      if (this.isSecure(key)) {
        await (await secureStore()).deleteItemAsync(key);
        return;
      }
      await (await asyncStorage()).removeItem(key);
    } catch {
      // Deleting what is not there is success.
    }
  }
}

// ── lazy peers ────────────────────────────────────────────────────────────
//
// Imported dynamically so the module graph does not pull either native package
// in until a host actually uses this storage. A host with its own persistence
// (Keychain wrapper, MMKV, its own encrypted store) implements
// `EasyLiveChatStorage` and never loads these at all.

interface SecureStoreModule {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

interface AsyncStorageModule {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

let secureStorePromise: Promise<SecureStoreModule> | null = null;
let asyncStoragePromise: Promise<AsyncStorageModule> | null = null;

function secureStore(): Promise<SecureStoreModule> {
  secureStorePromise ??= import('expo-secure-store').then(
    (m) => m as unknown as SecureStoreModule,
  );
  return secureStorePromise;
}

function asyncStorage(): Promise<AsyncStorageModule> {
  asyncStoragePromise ??= import('@react-native-async-storage/async-storage').then(
    (m) => (m.default ?? m) as unknown as AsyncStorageModule,
  );
  return asyncStoragePromise;
}

/**
 * A UI-preference key/value pair, separate from {@link EasyLiveChatStorage}.
 *
 * Used for the composer's remembered writing direction. That is a DEVICE
 * preference, not part of the visitor's identity: it must not be swept by
 * `reset()` on logout, because the next person on a shared phone probably
 * writes the same language.
 */
export const UiPreferences = {
  async get(key: string): Promise<string | null> {
    try {
      return await (await asyncStorage()).getItem(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      await (await asyncStorage()).setItem(key, value);
    } catch {
      // A preference we cannot write just means we fall back a step further
      // next launch.
    }
  },
} as const;
