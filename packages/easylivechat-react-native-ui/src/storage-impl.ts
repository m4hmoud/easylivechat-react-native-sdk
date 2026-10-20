import { type EasyLiveChatStorage, StorageKeys } from '@easylivechat/react-native';

/**
 * The durable {@link EasyLiveChatStorage} production apps should inject.
 *
 * Splits persistence by sensitivity:
 *  • the widget **JWT** (`StorageKeys.token`), the cached **profile**
 *    (`StorageKeys.profile` — the visitor's name / email / pre-chat answers,
 *    i.e. PII) and the host **user id** the visitor was identified as
 *    (`StorageKeys.identifiedUserId` — often an email or an account number)
 *    → `expo-secure-store` (Keychain / EncryptedSharedPreferences);
 *  • the durable **visitorId** and **conversationId** (opaque, non-sensitive)
 *    → `@react-native-async-storage/async-storage`.
 *
 * The same split as `SecurePrefsStorage` in `easylivechat_ui`.
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
    return (
      key === StorageKeys.token ||
      key === StorageKeys.profile ||
      key === StorageKeys.identifiedUserId
    );
  }

  async read(key: string): Promise<string | null> {
    // A key we cannot read is a key we do not have. Throwing here would break
    // `boot()` on a device with a broken keychain, when carrying on
    // anonymously is a perfectly good outcome.
    if (!this.isSecure(key)) {
      try {
        return await (await asyncStorage()).getItem(key);
      } catch {
        return null;
      }
    }
    let store: SecureStoreModule | null = null;
    let value: string | null = null;
    try {
      store = await secureStore();
      value = await store.getItemAsync(secureStoreKey(key));
    } catch {
      store = null;
    }
    if (value != null || key !== StorageKeys.identifiedUserId) return value;
    return this.adoptPlaintextUserId(store);
  }

  async write(key: string, value: string): Promise<void> {
    try {
      if (this.isSecure(key)) {
        await (await secureStore()).setItemAsync(secureStoreKey(key), value);
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
        await (await secureStore()).deleteItemAsync(secureStoreKey(key));
        // Signing out must not leave the plaintext copy an earlier build wrote.
        if (key === StorageKeys.identifiedUserId) await removePlaintext(key);
        return;
      }
      await (await asyncStorage()).removeItem(key);
    } catch {
      // Deleting what is not there is success.
    }
  }

  /**
   * Builds before this one kept the identified user id in AsyncStorage, in
   * plain text. Losing it would read the next `identify()` as "an anonymous
   * visitor signing in" rather than "the same person", so it is moved across
   * once — into the keychain, and out of AsyncStorage.
   */
  private async adoptPlaintextUserId(store: SecureStoreModule | null): Promise<string | null> {
    const key = StorageKeys.identifiedUserId;
    let legacy: string | null = null;
    try {
      legacy = await (await asyncStorage()).getItem(key);
    } catch {
      return null;
    }
    if (legacy == null || store == null) return legacy;
    try {
      await store.setItemAsync(secureStoreKey(key), legacy);
      await removePlaintext(key);
    } catch {
      // The keychain refused: leave the old copy where it is, and still
      // answer with it — the next launch tries the move again.
    }
    return legacy;
  }
}

/**
 * The name a key is stored under in `expo-secure-store`.
 *
 * Secure-store keys may hold only letters, digits, `.`, `-` and `_` — anything
 * else THROWS — and every key the core uses has a colon in it
 * (`easylivechat:widgetToken`). Before this mapping every secure read and
 * write failed into the catch below, so the cached profile never survived a
 * cold start. Each disallowed character becomes `_`, which is stable and
 * cannot collide among the core's keys.
 */
export function secureStoreKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function removePlaintext(key: string): Promise<void> {
  try {
    await (await asyncStorage()).removeItem(key);
  } catch {
    // Nothing there, or no AsyncStorage: nothing to clean.
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
