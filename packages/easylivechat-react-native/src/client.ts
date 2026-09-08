import type { EasyLiveChatConfig } from './config';
import { validateConfig } from './config';
import type { EasyLiveChatError } from './errors';
import { Emitter } from './internal/emitter';
import { ForwardingStore } from './internal/forwarding-store';
import type { ChatMessage } from './models/chat-message';
import type {
  FeedbackResult,
  MessagePage,
  ProactiveMessage,
  SendResult,
  UploadedFile,
} from './models/results';
import type {
  AvailabilityReason,
  VisitorMode,
  WidgetConfig,
} from './models/widget-config';
import type { UploadSource } from './rest-client';
import {
  type AppLifecycle,
  type ChatPhase,
  type ConnectionState,
  SessionController,
  type VisitorIdentity,
} from './session-controller';
import { type EasyLiveChatStorage, InMemoryStorage, StorageKeys } from './storage';
import type { ReadonlyStore } from './store';

const EMPTY_MESSAGES: readonly ChatMessage[] = Object.freeze([]);

/**
 * Public singleton facade.
 *
 * ```ts
 * await EasyLiveChat.instance.boot({
 *   apiBase: 'https://api.livechattools.com',
 *   tenantSlug: 'acme',
 * }, { storage: new SecureAsyncStorage() });
 * await EasyLiveChat.instance.open();
 * ```
 *
 * Every store below is created ONCE and survives boot/shutdown/reset, so a
 * component bound to one before `boot()` keeps working afterwards. See
 * {@link ForwardingStore}.
 */
export class EasyLiveChat {
  private static _instance: EasyLiveChat | null = null;

  static get instance(): EasyLiveChat {
    EasyLiveChat._instance ??= new EasyLiveChat();
    return EasyLiveChat._instance;
  }

  private constructor() {}

  private controller: SessionController | null = null;

  /** Fired whenever the controller is created, replaced or disposed. */
  private readonly lifecycleEmitter = new Emitter<void>();

  private get c(): SessionController {
    const c = this.controller;
    if (c == null) throw new Error('EasyLiveChat.boot() must be called before use.');
    return c;
  }

  get isBooted(): boolean {
    return this.controller != null;
  }

  // ── stores (imperative surface; hosts using Redux/Zustand bind these) ────

  /**
   * Every forwarding store, so a controller swap can re-point them all. They
   * are registered as they are constructed, which is the only way the list
   * cannot drift from the fields below.
   */
  private readonly forwardingStores: ForwardingStore<unknown>[] = [];

  private makeStore<T>(resolve: () => ReadonlyStore<T> | null, fallback: T): ReadonlyStore<T> {
    const store = new ForwardingStore<T>(resolve, fallback);
    this.forwardingStores.push(store as unknown as ForwardingStore<unknown>);
    return store;
  }

  readonly phase = this.makeStore<ChatPhase>(() => this.controller?.phase ?? null, 'idle');
  readonly widgetConfig = this.makeStore<WidgetConfig | null>(
    () => this.controller?.widgetConfig ?? null,
    null,
  );
  readonly isOpen = this.makeStore<boolean>(() => this.controller?.isOpen ?? null, true);
  readonly agentsAccepting = this.makeStore<boolean>(
    () => this.controller?.agentsAccepting ?? null,
    true,
  );
  readonly visitorMode = this.makeStore<VisitorMode>(
    () => this.controller?.visitorMode ?? null,
    'CHAT',
  );
  readonly availabilityReason = this.makeStore<AvailabilityReason>(
    () => this.controller?.availabilityReason ?? null,
    'OPEN',
  );
  readonly nextOpenAt = this.makeStore<Date | null>(
    () => this.controller?.nextOpenAt ?? null,
    null,
  );
  readonly nextOpenLocal = this.makeStore<string | null>(
    () => this.controller?.nextOpenLocal ?? null,
    null,
  );
  readonly workspaceTimezone = this.makeStore<string | null>(
    () => this.controller?.workspaceTimezone ?? null,
    null,
  );
  readonly closureLabel = this.makeStore<string | null>(
    () => this.controller?.closureLabel ?? null,
    null,
  );
  readonly connection = this.makeStore<ConnectionState>(
    () => this.controller?.connection ?? null,
    'disconnected',
  );
  readonly messages = this.makeStore<readonly ChatMessage[]>(
    () => this.controller?.messages ?? null,
    EMPTY_MESSAGES,
  );
  readonly agentTyping = this.makeStore<boolean>(() => this.controller?.agentTyping ?? null, false);
  readonly unreadCount = this.makeStore<number>(() => this.controller?.unreadCount ?? null, 0);
  readonly agentLastReadAt = this.makeStore<Date | null>(
    () => this.controller?.agentLastReadAt ?? null,
    null,
  );

  private rebindStores(): void {
    for (const s of this.forwardingStores) s.rebind();
    this.lifecycleEmitter.emit();
  }

  /** Fires when the SDK boots, re-boots or shuts down. For `useIsBooted`. */
  onLifecycleChange(fn: () => void): () => void {
    return this.lifecycleEmitter.subscribe(fn);
  }

  // ── derived getters ─────────────────────────────────────────────────────

  /**
   * True when the workspace is closed — outside working hours, or (for
   * WHEN_ACCEPTING tenants) nobody accepting.
   *
   * Presentational: show a notice. It never blocks writing, because a message
   * sent while closed still becomes a real conversation the team picks up.
   */
  get workspaceClosed(): boolean {
    return this.controller?.workspaceClosed ?? false;
  }

  /** True when the tenant chose to show a notice and take nothing. */
  get composerLocked(): boolean {
    return this.controller?.composerLocked ?? false;
  }

  /**
   * Whether the server says there is history behind the loaded page.
   *
   * A resumed thread opens on the visit the customer just started, so earlier
   * visits sit behind the cursor rather than on screen. Drives a host UI's
   * "load earlier" affordance — a brand-new conversation reports false.
   */
  get hasOlderHistory(): boolean {
    return this.controller?.hasOlderHistory ?? false;
  }

  get visitorId(): string {
    return this.c.visitorId;
  }

  get conversationId(): string | null {
    return this.controller?.conversationId ?? null;
  }

  /** The visitor's name, for resolving `%name%` in tenant copy. */
  get visitorName(): string | null {
    return this.controller?.visitorName ?? null;
  }

  // ── event streams ───────────────────────────────────────────────────────

  /**
   * Facade-owned, so a subscription survives boot/shutdown/reset the same way
   * the stores do. A component that subscribes before `boot()` — the launcher
   * bubble's chime is exactly this — would otherwise be handed a no-op
   * unsubscribe and never hear a single message.
   *
   * The controller's own emitters are bridged into these on boot and unbridged
   * on teardown.
   */
  private readonly messageEmitter = new Emitter<ChatMessage>();
  private readonly proactiveEmitter = new Emitter<ProactiveMessage>();
  private readonly errorEmitter = new Emitter<EasyLiveChatError>();

  /** Undoes the controller→facade bridges when the controller goes away. */
  private bridges: Array<() => void> = [];

  private bridgeController(controller: SessionController): void {
    this.unbridgeController();
    this.bridges = [
      controller.onMessage((m) => this.messageEmitter.emit(m)),
      controller.onProactiveMessage((p) => this.proactiveEmitter.emit(p)),
      controller.onError((e) => this.errorEmitter.emit(e)),
    ];
  }

  private unbridgeController(): void {
    for (const off of this.bridges) off();
    this.bridges = [];
  }

  onMessage(fn: (m: ChatMessage) => void): () => void {
    return this.messageEmitter.subscribe(fn);
  }

  onProactiveMessage(fn: (p: ProactiveMessage) => void): () => void {
    return this.proactiveEmitter.subscribe(fn);
  }

  onError(fn: (e: EasyLiveChatError) => void): () => void {
    return this.errorEmitter.subscribe(fn);
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  /**
   * Initialize with `config`.
   *
   * Inject a durable `storage`; the default {@link InMemoryStorage} is NOT
   * durable, so production apps must provide a persistent implementation (the
   * one in `@easylivechat/react-native-ui` is the intended default).
   *
   * On an ALREADY-BOOTED instance this adopts whatever changed rather than
   * returning early. Hosts rebuild the config from the CURRENT app language on
   * every open, and returning early left the chat fetching tenant copy in
   * whatever language the app happened to be in the first time: a visitor who
   * opened in Kurdish, switched to Arabic and came back got Arabic SDK chrome
   * wrapped around Kurdish tenant copy, including a post-chat survey whose
   * questions were still Kurdish.
   */
  async boot(
    config: EasyLiveChatConfig,
    opts: { storage?: EasyLiveChatStorage } = {},
  ): Promise<void> {
    if (this.controller != null) {
      validateConfig(config);
      this.controller.applyConfig(config);
      return;
    }
    // Fail fast on a misconfigured apiBase/tenantSlug rather than deep in the
    // transport with an opaque error.
    validateConfig(config);
    const controller = new SessionController(config, opts.storage ?? new InMemoryStorage());
    this.controller = controller;
    this.bridgeController(controller);
    this.rebindStores();
    await controller.boot();
  }

  /**
   * Pre-identify a known (logged-in) visitor BEFORE {@link open}, which then
   * skips the pre-chat form and starts the session directly as this person.
   *
   * AUTHORITATIVE — it REPLACES the stored profile rather than merging, so a
   * value you no longer supply is cleared. A fully-empty identity is ignored.
   */
  identify(identity: VisitorIdentity): void {
    this.c.identify(identity);
  }

  loadConfig(): Promise<WidgetConfig> {
    return this.c.loadConfig();
  }

  open(): Promise<void> {
    return this.c.open();
  }

  /**
   * Re-read availability and re-gate the UI. Call whenever the chat becomes
   * visible again — reopening the screen, or the app returning to foreground.
   */
  refreshAvailability(): Promise<void> {
    return this.c.refreshAvailability();
  }

  silentResume(): Promise<boolean> {
    return this.c.silentResume();
  }

  startSession(identity: VisitorIdentity = {}): Promise<void> {
    return this.c.startSession(identity);
  }

  closeSession(): void {
    this.c.closeSession();
  }

  // ── messaging ───────────────────────────────────────────────────────────

  sendMessage(body: string, opts: { attachmentUrls?: string[] } = {}): SendResult {
    return this.c.sendMessage(body, opts);
  }

  /**
   * Re-send a message that previously failed (tap-to-retry). Returns null when
   * the message is not in a failed state.
   */
  resend(message: ChatMessage): SendResult | null {
    return this.c.resend(message);
  }

  setTyping(isTyping: boolean): void {
    this.c.setTyping(isTyping);
  }

  markRead(): void {
    this.controller?.markRead();
  }

  /**
   * End the conversation from the visitor's side, the same way the web
   * widget's × does. A later {@link open} starts a brand-new conversation
   * rather than resuming this one.
   *
   * Returns true when a post-chat step (survey or CSAT) will follow and the
   * chat should stay on screen for it; false when there is nothing more to
   * show — because this chat was already rated, was already closed, or there
   * was no live connection — and the caller should close the chat UI.
   */
  endChat(): Promise<boolean> {
    return this.c.endChat();
  }

  loadOlderMessages(): Promise<MessagePage> {
    return this.c.loadOlderMessages();
  }

  // ── attachments ─────────────────────────────────────────────────────────

  uploadBytes(args: {
    data: UploadSource;
    filename: string;
    contentType?: string;
    onProgress?: (progress: number) => void;
  }): Promise<UploadedFile> {
    return this.c.uploadBytes(args);
  }

  resolveUrl(relativeOrAbsolute: string): string {
    return this.controller?.resolveUrl(relativeOrAbsolute) ?? relativeOrAbsolute;
  }

  // ── offline + CSAT + survey ─────────────────────────────────────────────

  submitOfflineForm(args: { name?: string; email?: string; message: string }): Promise<string> {
    return this.c.submitOfflineForm(args);
  }

  submitFeedback(args: { rating: number; comment?: string }): Promise<FeedbackResult> {
    return this.c.submitFeedback(args);
  }

  /**
   * Submit the tenant's post-chat survey, keyed by field id. A conversation
   * that was already answered resolves normally — one-shot, not an error.
   */
  submitPostChat(fields: Record<string, string>): Promise<void> {
    return this.c.submitPostChat(fields);
  }

  // ── presence / lifecycle ────────────────────────────────────────────────

  setAppLifecycle(state: AppLifecycle): void {
    this.controller?.setAppLifecycle(state);
  }

  heartbeat(args: { currentUrl?: string; currentTitle?: string } = {}): void {
    this.controller?.heartbeat(args);
  }

  /** Tear everything down. After this you must {@link boot} again. */
  shutdown(): void {
    this.unbridgeController();
    this.controller?.dispose();
    this.controller = null;
    this.rebindStores();
  }

  /**
   * Forget who this visitor is. Call this from your app's LOGOUT path.
   *
   * {@link shutdown} only clears memory; the durable `visitorId` survives it,
   * so the next {@link boot} resolves the same server-side contact and resumes
   * the same conversation. That is right for a returning customer and wrong
   * for a signed-out one: the server keeps a name it already holds when a
   * client sends none, so the next person to open the chat on that device was
   * greeted by the previous person's name and carried on inside their
   * transcript. On a shared device — a restaurant tablet, a POS terminal —
   * that is somebody else's identity.
   *
   * This drops every key in `StorageKeys.identity`, then tears down. The next
   * boot mints a fresh `visitorId`, so the server sees a new contact with
   * nothing to resume: no history, no "load earlier" affordance, and the
   * greeting resolves against the workspace's own `defaultCustomerName`.
   *
   * The transcript is NOT deleted — this abandons the identity, not the
   * history.
   *
   * Safe to call when the SDK was NEVER BOOTED this session, which is the
   * common case for a logout that never opened the chat — pass the same
   * `storage` you pass to {@link boot} so the keys can still be cleared. When
   * it IS booted the controller's own storage is used and the argument is
   * ignored.
   */
  async reset(opts: { storage?: EasyLiveChatStorage } = {}): Promise<void> {
    const c = this.controller;
    if (c != null) {
      await c.resetVisitor();
      this.unbridgeController();
      c.dispose();
      this.controller = null;
      this.rebindStores();
      return;
    }
    const storage = opts.storage;
    if (storage == null) return;
    for (const key of StorageKeys.identity) {
      await storage.delete(key);
    }
  }
}

/** Convenience alias — `easylivechat.open()` reads better than the class path. */
export const easylivechat = EasyLiveChat.instance;
