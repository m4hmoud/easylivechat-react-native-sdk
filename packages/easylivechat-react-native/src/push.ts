import { EasyLiveChat } from './client';
import { EasyLiveChatError, EasyLiveChatErrorCode } from './errors';
import type { PushPlatform } from './rest-client';

/**
 * The old background-push stub, kept as a thin alias so a host that wired it
 * up keeps compiling.
 *
 * It said push was a non-goal because the server had nowhere for a VISITOR to
 * register a device. That stopped being true: the server has
 * `POST /api/widget/:slug/push/register` (and the matching unregister), and
 * `EasyLiveChat.instance.setPushToken()` drives it — held until a session can
 * authenticate it, moved on token rotation, dropped on an identity switch and
 * on `reset()`. Everything here forwards to that.
 *
 * @deprecated Use `EasyLiveChat.instance.setPushToken(token, { platform })`.
 */
export const EasyLiveChatPush = {
  /**
   * True: visitors can be notified now.
   *
   * @deprecated There is nothing left to feature-detect.
   */
  get isSupported(): boolean {
    return true;
  },

  /**
   * Forwards to `EasyLiveChat.instance.setPushToken(token, options)`.
   *
   * The registration needs the device's platform, which the old stub never
   * asked for — and the core never imports `react-native`, so it cannot look
   * `Platform.OS` up itself. Called without one it REJECTS with a message
   * saying so, rather than resolving as if a device had been registered: a
   * call that silently does nothing is what this stub used to be.
   *
   * @deprecated Use `EasyLiveChat.instance.setPushToken(token, { platform })`.
   */
  registerDeviceToken(
    token: string,
    options: { platform?: PushPlatform; appVersion?: string } = {},
  ): Promise<void> {
    const platform = options.platform;
    if (platform == null) {
      return Promise.reject(
        new EasyLiveChatError(EasyLiveChatErrorCode.UNKNOWN, {
          message:
            "EasyLiveChatPush.registerDeviceToken(token) needs { platform: 'IOS' | 'ANDROID' } " +
            'now that visitor push is supported — or call ' +
            'EasyLiveChat.instance.setPushToken(token, { platform }).',
        }),
      );
    }
    return EasyLiveChat.instance.setPushToken(token, {
      platform,
      appVersion: options.appVersion,
    });
  },

  /**
   * Forwards to `EasyLiveChat.instance.setPushToken(null, …)`: stop notifying
   * this device.
   *
   * @deprecated Use `EasyLiveChat.instance.setPushToken(null, { platform })`.
   */
  unregisterDeviceToken(): Promise<void> {
    // The platform describes a token being registered; with none it is unread.
    return EasyLiveChat.instance.setPushToken(null, { platform: 'ANDROID' });
  },
} as const;
