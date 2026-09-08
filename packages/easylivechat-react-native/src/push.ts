/**
 * Background push notifications are a DOCUMENTED NON-GOAL of this SDK.
 *
 * "An agent replied while the app was closed" needs a server-side *visitor*
 * push registry and fan-out. The backend currently pushes to AGENTS only
 * (`apps/ios-tenant`, `apps/android-tenant` register device tokens; visitors
 * have nowhere to register one), and building it would require server changes
 * this SDK is explicitly forbidden from making.
 *
 * This stub exists so the shape of the eventual API is visible, and so a host
 * that calls it gets an honest answer instead of silence. Everything here is a
 * no-op today.
 *
 * What a host CAN do in the meantime:
 *  - Keep the app foregrounded flows working — the `/widgets` socket
 *    reconnects and backfills, so nothing is lost while the app is merely
 *    backgrounded and later resumed.
 *  - Use your own push infrastructure, and on tap call
 *    `EasyLiveChat.instance.open()` to land the visitor back in their thread.
 */
export const EasyLiveChatPush = {
  /** Always false. There is no visitor push registry to register against. */
  get isSupported(): boolean {
    return false;
  },

  /**
   * No-op. Kept so a host's wiring compiles today and starts working the day
   * the server grows a visitor push registry.
   */
  async registerDeviceToken(_token: string): Promise<void> {
    // Intentionally empty — see the module doc.
  },

  /** No-op counterpart to {@link registerDeviceToken}. */
  async unregisterDeviceToken(): Promise<void> {
    // Intentionally empty — see the module doc.
  },
} as const;
