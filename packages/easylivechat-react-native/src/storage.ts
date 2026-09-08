/**
 * Pluggable key/value persistence for the durable `visitorId`, the cached
 * profile, and the widget JWT.
 *
 * The core ships {@link InMemoryStorage} (NON-durable, for tests); apps should
 * inject a real implementation — `@easylivechat/react-native-ui` provides an
 * `expo-secure-store` + AsyncStorage adapter.
 *
 * IMPORTANT: the `visitorId` MUST persist across cold starts. If it
 * regenerates, every relaunch creates a NEW server-side Contact and orphans
 * prior conversations + CSAT.
 */
export interface EasyLiveChatStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Canonical storage keys.
 *
 * The `livechattools:` prefixes are NOT a mistake and must not be "fixed":
 * they deliberately reuse the legacy web widget's key names so one person is
 * the same visitor across web and native within a tenant, and renaming them
 * resets every installed user. See the Brand section of the repo's CLAUDE.md.
 */
export const StorageKeys = {
  visitorId: 'livechattools:visitorId',
  profile: 'livechattools:visitorProfile',
  token: 'easylivechat:widgetToken',
  conversationId: 'easylivechat:conversationId',

  /**
   * Everything that says WHO this visitor is, in the order it should be
   * dropped — the `visitorId` last, because it is the one the server keys the
   * contact on and the others are meaningless without it.
   *
   * Used by `EasyLiveChat.reset()`. Kept here so the list cannot drift from
   * the keys above: a new durable key added and not listed would survive a
   * logout and quietly re-identify the next person on the device.
   */
  identity: [
    'easylivechat:widgetToken',
    'easylivechat:conversationId',
    'livechattools:visitorProfile',
    'livechattools:visitorId',
  ],
} as const;

/**
 * Ephemeral, process-lifetime storage. Do NOT use in production — the
 * `visitorId` will not survive an app restart.
 */
export class InMemoryStorage implements EasyLiveChatStorage {
  private readonly map = new Map<string, string>();

  async read(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async write(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}
