import type { PushPlatform } from './rest-client';

/**
 * The old background-push stub's name, kept so a host that wired it up keeps
 * compiling. Every member does nothing.
 *
 * The SDK no longer registers devices: notifications would need the
 * workspace's Firebase credentials on our servers, and workspaces no longer
 * hand those over. Your own server sends them, from the workspace's
 * `message.created` webhook — see `EasyLiveChat.setPushToken` and
 * "Notifications" in the README.
 *
 * @deprecated Remove the calls; notify your users from your own server.
 */
export const EasyLiveChatPush = {
  /**
   * False: the SDK does not notify visitors' devices.
   *
   * @deprecated There is nothing left to feature-detect.
   */
  get isSupported(): boolean {
    return false;
  },

  /**
   * Does nothing, and resolves at once.
   *
   * @deprecated Notify your users from your own server, driven by the
   * `message.created` webhook.
   */
  registerDeviceToken(
    token: string,
    options: { platform?: PushPlatform; appVersion?: string } = {},
  ): Promise<void> {
    void token;
    void options;
    return Promise.resolve();
  },

  /**
   * Does nothing, and resolves at once.
   *
   * @deprecated Notify your users from your own server, driven by the
   * `message.created` webhook.
   */
  unregisterDeviceToken(): Promise<void> {
    return Promise.resolve();
  },
} as const;
