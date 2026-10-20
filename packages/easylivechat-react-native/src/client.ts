import type { EasyLiveChatConfig } from './config';
import { validateConfig } from './config';
import type { EasyLiveChatError } from './errors';
import { Emitter } from './internal/emitter';
import { ForwardingStore } from './internal/forwarding-store';
import type { ChatMessage } from './models/chat-message';
import type { HelpArticle, HelpArticleList } from './models/help-articles';
import type {
  DeletedMessage,
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
import type { PushPlatform, UploadSource } from './rest-client';
import {
  type AppLifecycle,
  type ChatPhase,
  type ConnectionState,
  type PreChatSubmission,
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

  private consentSupported = false;

  /**
   * Whether this app draws the workspace's consent checkboxes — a pre-chat
   * field of type `'consent'`: a checkbox, the tenant's sentence beside it,
   * and its privacy-policy link.
   *
   * Off by default, and the prebuilt `@easylivechat/react-native-ui` screens
   * turn it on themselves. A host that builds its OWN pre-chat form turns it
   * on once it renders consent fields — it may be set before {@link boot}:
   *
   * ```ts
   * EasyLiveChat.instance.supportsConsent = true;
   * // … then pass the ticked ids:
   * await EasyLiveChat.instance.startSession({ fields: values, consents: ticked });
   * ```
   *
   * While it is off the config is requested without consent fields — the
   * server leaves them out for a client that does not ask, rather than have it
   * draw a text box labelled "I agree to…" — and no consent is asked of the
   * visitor, exactly as before consent existed. Takes effect at the next config
   * fetch ({@link open}, {@link loadConfig}, {@link refreshAvailability}).
   */
  get supportsConsent(): boolean {
    return this.consentSupported;
  }

  set supportsConsent(value: boolean) {
    this.consentSupported = value;
    if (this.controller != null) this.controller.supportsConsent = value;
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

  /**
   * True while the typing in {@link agentTyping} is the AI assistant composing
   * a reply — label the typing row for the assistant rather than implying a
   * person is there. `agentTyping` is true alongside it, so a UI that only
   * binds that one still shows the row.
   */
  readonly assistantTyping = this.makeStore<boolean>(
    () => this.controller?.assistantTyping ?? null,
    false,
  );

  /**
   * Whether the AI assistant answers a message sent right now, from
   * `GET /config` and every `workspace:availability` push. While it does,
   * "we're closed, leave a message" is untrue — swap the closed/busy notice
   * for "our assistant can help in the meantime".
   */
  readonly assistantCovers = this.makeStore<boolean>(
    () => this.controller?.assistantCovers ?? null,
    false,
  );
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
  private readonly deletedEmitter = new Emitter<DeletedMessage>();
  private readonly proactiveEmitter = new Emitter<ProactiveMessage>();
  private readonly errorEmitter = new Emitter<EasyLiveChatError>();

  /** Undoes the controller→facade bridges when the controller goes away. */
  private bridges: Array<() => void> = [];

  private bridgeController(controller: SessionController): void {
    this.unbridgeController();
    this.bridges = [
      controller.onMessage((m) => this.messageEmitter.emit(m)),
      controller.onMessageDeleted((d) => this.deletedEmitter.emit(d)),
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

  /**
   * A message an agent unsent, once per id.
   *
   * Fires for the live `message:deleted`, and for every id a history response
   * lists in `unsentIds` the first time this session hears of it — so it can
   * name a message this client never displayed, such as one that only reached
   * the device as a push notification. Use it to withdraw anything you derived
   * from the message yourself (a notification, a cached preview); `messages`
   * already drops it. Returns the unsubscribe.
   */
  onMessageDeleted(fn: (d: DeletedMessage) => void): () => void {
    return this.deletedEmitter.subscribe(fn);
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
    controller.supportsConsent = this.consentSupported;
    this.controller = controller;
    this.bridgeController(controller);
    this.rebindStores();
    await controller.boot();
    // An identify()/clearIdentity() made before boot, now that there is a
    // stored visitor to line it up against.
    const pending = this.pendingIdentity;
    this.pendingIdentity = null;
    pending?.(controller);
    // The device's push token, handed over before this controller existed —
    // before boot, or to one that was shut down or reset since.
    const push = this.heldPush;
    if (push != null) void controller.setPushToken(push.token, push.options);
  }

  /** identify()/clearIdentity() called before {@link boot}, applied by it. */
  private pendingIdentity: ((c: SessionController) => void) | null = null;

  /**
   * The device's push token, kept for the life of the process. It belongs to
   * the device rather than to a visitor, so it outlives a controller: after a
   * `reset()` (which drops the signed-out person's registration) the next
   * person's first session registers it again, exactly as an identity switch
   * does.
   */
  private heldPush: {
    token: string;
    options: { platform: PushPlatform; appVersion?: string };
  } | null = null;

  /**
   * Pre-identify a known (logged-in) visitor BEFORE {@link open}, which then
   * skips the pre-chat form and starts the session directly as this person.
   *
   * AUTHORITATIVE — it REPLACES the stored profile rather than merging, so a
   * value you no longer supply is cleared. A fully-empty identity is ignored.
   *
   * **Identity verification.** Pass `userId` (your own id for the signed-in
   * user) and `userHash` — `HMAC_SHA256(identitySecret, userId)` as hex,
   * computed by YOUR BACKEND and handed to the app; the secret must never ship
   * in the app. Both go on every session call. When the workspace ENFORCES
   * verification, a missing or wrong hash fails the session with
   * `IDENTITY_NOT_VERIFIED` (`isIdentityNotVerified(e)`, `e.reason`), on
   * {@link onError} and from {@link open}/{@link startSession}.
   *
   * ```ts
   * const { userId, userHash } = await myBackend.chatIdentity();
   * EasyLiveChat.instance.identify({ name, email, userId, userHash });
   * await EasyLiveChat.instance.open();
   * ```
   *
   * **The same person, or somebody else?** The `userId` is remembered on the
   * device. An anonymous visitor who signs in keeps their conversation; a
   * DIFFERENT `userId`, or an identity without one after one was set (an empty
   * `identify({})` included — that is a sign-out), forgets the stored visitor
   * so the next person never resumes the previous one's conversation. Call
   * this on every launch, before `open()`: the hash is not
   * stored, and a chat opened with no identify() behind it while a `userId` is
   * on record is treated as signed out — the same rule as the web widget.
   * `reset()` remains the full logout; {@link clearIdentity} is the sign-out
   * that keeps the SDK booted.
   *
   * Safe to call BEFORE `boot()` — it is held and applied once boot has read
   * the stored visitor, which is also what makes the usual un-awaited
   * `boot(); identify(…)` pair safe.
   */
  identify(identity: VisitorIdentity): void {
    const c = this.controller;
    if (c == null) {
      this.pendingIdentity = (ctl) => ctl.identify(identity);
      return;
    }
    c.identify(identity);
  }

  /**
   * The signed-in user signed out: drop the identity passed to
   * {@link identify} without tearing the SDK down.
   *
   * A name/email-only identity (no `userId`) is simply cleared — the visitor
   * keeps their visitorId and conversation, as an anonymous visitor would, and
   * the cached profile goes so the name is not resent on the next resume.
   * When this device's visitor had been identified with a `userId`, the
   * visitor is forgotten as well — a fresh visitorId, no conversation to
   * resume, its push registration dropped — and a chat on screen restarts as
   * an anonymous visitor. {@link reset} is the full logout that abandons the
   * visitorId in every case.
   *
   * Before `boot()` it drops an identify() still waiting; the first session
   * call lines up "nobody signed in" by itself.
   */
  clearIdentity(): void {
    const c = this.controller;
    if (c == null) {
      this.pendingIdentity = null;
      return;
    }
    c.clearIdentity();
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

  /**
   * Start a new chat from the pre-chat form: `fields` keyed by field id, and
   * `consents` — the ids of the consent fields the visitor ticked.
   *
   * Consent is not a value, so it never goes in `fields`. `consents` only
   * matters with {@link supportsConsent} on; a required consent field left out
   * of it fails with `CONSENT_REQUIRED` (its `fieldId` set), locally first and
   * then from the server, as other field errors do.
   */
  startSession(submission: PreChatSubmission = {}): Promise<void> {
    return this.c.startSession(submission);
  }

  closeSession(): void {
    this.c.closeSession();
  }

  // ── messaging ───────────────────────────────────────────────────────────

  sendMessage(body: string, opts: { attachmentUrls?: string[] } = {}): SendResult {
    return this.c.sendMessage(body, { attachmentUrls: opts.attachmentUrls });
  }

  /**
   * Answer a reply button under `message` — one of its `botButtonsOf` buttons,
   * or a reply button on one of its cards. `label` goes as the visitor's own
   * message (it shows and ticks like anything typed) with the button's id
   * beside it, so the server records which one was meant; the agents read
   * "Chose: …".
   *
   * Offer it only while `buttonsOpen(messages, message.id)` says the question
   * is still open. For a card's reply button pass `replyLabel(...)`: on a
   * carousel it names the card ("Blue shirt · Buy").
   */
  answerButton(message: ChatMessage, button: { buttonId: string; label: string }): SendResult {
    return this.c.sendMessage(button.label, { reply: { messageId: message.id, buttonId: button.buttonId } });
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

  /**
   * Leave a message for the team. `consents` are the consent fields the
   * visitor ticked on your form, as for {@link startSession}; omit them and
   * nothing about consent is sent.
   */
  submitOfflineForm(args: {
    name?: string;
    email?: string;
    message: string;
    consents?: readonly string[];
  }): Promise<string> {
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

  // ── help articles ───────────────────────────────────────────────────────

  /**
   * Search the workspace's published help articles. Anonymous — no session
   * needed, only `boot()`.
   *
   * Two or more characters run a ranked search (default 5 results, at most
   * 20); fewer list the top articles instead (see {@link helpArticles}).
   * Articles are returned in the config's `contentLocale` when the workspace
   * wrote them in it. Resolves `{ enabled: false, articles: [] }` when the
   * workspace's "Show help articles" switch is off — check
   * `widgetConfig.helpArticlesEnabled` before offering help at all.
   */
  searchHelp(
    q: string,
    options: { category?: string; limit?: number } = {},
  ): Promise<HelpArticleList> {
    return this.c.searchHelp(q, options);
  }

  /** The top articles in the workspace's own order (default 20, at most 50). */
  helpArticles(options: { category?: string; limit?: number } = {}): Promise<HelpArticleList> {
    return this.c.searchHelp('', options);
  }

  /**
   * One article in full; `body` is help-markdown — draw it with
   * `parseHelpMarkdown`, never as HTML. Also records the view (fire-and-forget;
   * a failed count is swallowed). Rejects `NOT_FOUND` for an article that is
   * unpublished or gone, or when the workspace switched help off.
   */
  getHelpArticle(id: string): Promise<HelpArticle> {
    return this.c.getHelpArticle(id);
  }

  /**
   * "Was this helpful?" Answering again in the same app session changes the
   * answer rather than adding a second one.
   */
  rateHelpArticle(id: string, helpful: boolean): Promise<void> {
    return this.c.rateHelpArticle(id, helpful);
  }

  // ── presence / lifecycle ────────────────────────────────────────────────

  setAppLifecycle(state: AppLifecycle): void {
    this.controller?.setAppLifecycle(state);
  }

  heartbeat(args: { currentUrl?: string; currentTitle?: string } = {}): void {
    this.controller?.heartbeat(args);
  }

  /**
   * The device to notify when an agent replies and the app is closed.
   *
   * Hand over the FCM registration token your app already receives
   * (`@react-native-firebase/messaging`'s `getToken()`, or Expo's
   * `getDevicePushTokenAsync()` on Android) — the SDK brings no push
   * dependency of its own, so your project keeps one Firebase setup and one
   * notification permission prompt. The server sends through FCM on iOS too.
   *
   * ```ts
   * await EasyLiveChat.instance.setPushToken(token, {
   *   platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
   *   appVersion: '2.4.0',
   * });
   * ```
   *
   * Call it as soon as you have a token — even before `boot()`, and before the
   * visitor opens a chat: a registration can only be authenticated with a
   * session token, so it is held and sent the moment one exists. Call it again
   * when the token rotates — the old registration is dropped first. `null`
   * stops the notifications. An identity switch and {@link reset} drop the
   * previous person's registration by themselves; the token is kept for the
   * next person's session.
   *
   * Nothing is suppressed server-side, on purpose: a connected socket is not a
   * person looking at the screen. Skip the notification in your own handler
   * when the chat is already on screen — your app is the only thing that
   * knows. Its `data` carries `type: 'visitor.message'`, `conversationId`,
   * `messageId` and `tenantId`.
   *
   * Resolves once the registration has gone out or been held; never rejects.
   */
  setPushToken(
    pushToken: string | null,
    options: { platform: PushPlatform; appVersion?: string },
  ): Promise<void> {
    const next = pushToken == null ? null : pushToken.trim();
    if (next != null && next.length === 0) return Promise.resolve();
    this.heldPush = next == null ? null : { token: next, options: { ...options } };
    return this.controller?.setPushToken(next, options) ?? Promise.resolve();
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
   * The device's push registration for the signed-out visitor is dropped too
   * (best effort, without waiting on the network), so their replies stop
   * reaching this device; a token given to {@link setPushToken} is kept and
   * registered again for whoever opens the chat next.
   *
   * Safe to call when the SDK was NEVER BOOTED this session, which is the
   * common case for a logout that never opened the chat — pass the same
   * `storage` you pass to {@link boot} so the keys can still be cleared. When
   * it IS booted the controller's own storage is used and the argument is
   * ignored. Unbooted there is no API base to reach, so a push registration
   * cannot be dropped then — boot first if you have one to stop.
   */
  async reset(opts: { storage?: EasyLiveChatStorage } = {}): Promise<void> {
    // An identity declared before boot belongs to the person signing out.
    this.pendingIdentity = null;
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
