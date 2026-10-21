import { type EasyLiveChatConfig, type ResolvedConfig, resolveConfig } from './config';
import {
  EasyLiveChatError,
  EasyLiveChatErrorCode,
  toEasyLiveChatError,
} from './errors';
import { Emitter } from './internal/emitter';
import {
  type HelpArticle,
  type HelpArticleList,
} from './models/help-articles';
import { isTokenExpiring } from './internal/jwt';
import { uuidV4 } from './internal/uuid';
import {
  type ChatMessage,
  isFromAgent,
  isFromAssistant,
  isFromCustomer,
  isLocalTemp,
  optimisticMessage,
  parseChatMessage,
  systemI18nKey,
  withIdentityFrom,
  withReactionsFrom,
} from './models/chat-message';
import {
  REACTION_EMOJI_MAX_LENGTH,
  canReactTo,
  sameReactions,
  withMyReaction,
} from './models/reactions';
import {
  type PreChatField,
  validateConsents,
  validatePreChatField,
} from './models/pre-chat-form';
import {
  type DeletedMessage,
  type FeedbackResult,
  type MessagePage,
  type ProactiveMessage,
  type QueueStatus,
  type QueueUpdate,
  type ReactionsUpdate,
  type SendResult,
  type SessionResult,
  type StoredProfile,
  type TranscriptResult,
  type UploadedFile,
  type VisitorEmailResult,
  type VisitorEmailState,
  parseStoredProfile,
  serializeStoredProfile,
} from './models/results';
import {
  type AvailabilityReason,
  type VisitorMode,
  type WidgetConfig,
  type WorkspaceAvailability,
  isWorkspaceClosed,
} from './models/widget-config';
import { PresenceSocket } from './presence-socket';
import { RestClient, type UploadSource } from './rest-client';
import { resumeLinkToken } from './internal/resume-link';
import { type Store, createStore } from './store';
import { type EasyLiveChatStorage, StorageKeys } from './storage';
import { WidgetSocket } from './widget-socket';

/** High-level UI phase. */
export type ChatPhase =
  | 'idle'
  | 'loading'
  | 'offline'
  | 'resuming'
  | 'prechat'
  | 'chat'
  | 'feedback';

/** Realtime connection state (derived from the `/widgets` socket). */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** App foreground/background, fed by the host (drives heartbeat + presence). */
export type AppLifecycle = 'resumed' | 'paused';

/** The visitor identity a host can declare, or a pre-chat form can capture. */
export interface VisitorIdentity {
  name?: string;
  email?: string;
  phone?: string;
  fields?: Record<string, string>;
  /**
   * Your application's OWN id for the signed-in user, for identity
   * verification. Sent on every session call as `userId`.
   *
   * Also decides whether this is still the same person on this device: a
   * DIFFERENT `userId` than last time — or an identity without one after one
   * was set — starts a new visitor, so the next person never resumes the
   * previous one's conversation. An anonymous visitor who signs in keeps
   * their conversation. See `EasyLiveChat.identify`.
   */
  userId?: string;
  /**
   * `HMAC_SHA256(identitySecret, userId)` as hex, computed by your BACKEND —
   * the secret must never ship in the app. Sent on every session call as
   * `userHash`. With verification ENFORCED a missing or wrong hash makes the
   * session fail with `IDENTITY_NOT_VERIFIED` (see `isIdentityNotVerified`).
   */
  userHash?: string;
}

/**
 * How a newly declared identity relates to the one this device's visitor was
 * last identified as.
 *
 * - `same` — nothing to do.
 * - `upgraded` — an anonymous visitor signed in: keep their conversation and
 *   attach the identity.
 * - `switched` — a different person, or a signed-in person signed out: the
 *   stored visitor must not be reused.
 */
export type VisitorChange = 'same' | 'upgraded' | 'switched';

/**
 * The person-change rule, shared with the web widget (`reconcileVisitor`).
 *
 * `stored` is the user id the device's visitor was last identified as, `next`
 * the one now declared; null means anonymous.
 */
export function visitorChangeFor(stored: string | null, next: string | null): VisitorChange {
  if (next != null && stored === next) return 'same';
  if (next == null && stored == null) return 'same';
  if (next != null && stored == null) return 'upgraded';
  return 'switched';
}

function cleanClaim(v: string | undefined): string | undefined {
  if (v == null) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * What the pre-chat form captured: the identity and field values, plus the
 * consent checkboxes the visitor ticked.
 */
export interface PreChatSubmission extends VisitorIdentity {
  /**
   * The ids of the consent fields the visitor ticked. Consent is not a value,
   * so it never goes in `fields`. Only matters with
   * {@link SessionController.supportsConsent} on.
   */
  consents?: readonly string[];
}

/** The marker whose i18n key opens a new visit inside an existing thread. */
const SESSION_START_MARKER = 'conversation.session.started';

/** Bound the reconnect backfill so a pathological gap cannot loop forever. */
const MAX_BACKFILL_PAGES = 20;

/** The server only ever sends `isTyping: true`; clear it ourselves after this. */
const TYPING_AUTO_CLEAR_MS = 4000;

/**
 * The assistant's typing has no short clear: it sends an explicit stop when
 * its reply is ready, and a reply can take ten seconds or more. This is only
 * the backstop for a stop lost to a dropped connection.
 */
const ASSISTANT_TYPING_BACKSTOP_MS = 45_000;

/**
 * React Native defines `__DEV__`; Node/Vitest define `process.env.NODE_ENV`.
 * Both are probed through `globalThis` so neither needs an ambient type.
 */
const IS_DEV = (() => {
  const g = globalThis as {
    __DEV__?: boolean;
    process?: { env?: Record<string, string | undefined> };
  };
  if (typeof g.__DEV__ === 'boolean') return g.__DEV__;
  return g.process?.env?.NODE_ENV !== 'production';
})();

/**
 * The brain.
 *
 * Owns the protocol clients, the {@link ChatPhase} state machine, the reactive
 * stores, optimistic-send + reconcile, reconnect + gap-safe backfill, and
 * token re-mint. UI binds the stores; it never touches the transport directly.
 */
export class SessionController {
  /**
   * Not readonly: the host re-boots with a fresh config whenever the app
   * language changes, and {@link applyConfig} swaps it in.
   */
  config: ResolvedConfig;
  rest: RestClient;

  constructor(
    config: EasyLiveChatConfig,
    readonly storage: EasyLiveChatStorage,
  ) {
    this.config = resolveConfig(config);
    this.rest = new RestClient(this.config);
  }

  // ── reactive state ──────────────────────────────────────────────────────

  readonly phase: Store<ChatPhase> = createStore<ChatPhase>('idle');
  readonly widgetConfig: Store<WidgetConfig | null> = createStore<WidgetConfig | null>(null);
  readonly isOpen: Store<boolean> = createStore(true);

  /**
   * Whether any agent is accepting chats. Only gates the UI for tenants
   * running `chatAvailabilityMode = WHEN_ACCEPTING`.
   */
  readonly agentsAccepting: Store<boolean> = createStore(true);

  /** The server's decision: `CHAT`, `LEAVE_MESSAGE` or `NOTICE_ONLY`. */
  readonly visitorMode: Store<VisitorMode> = createStore<VisitorMode>('CHAT');
  readonly availabilityReason: Store<AvailabilityReason> =
    createStore<AvailabilityReason>('OPEN');
  readonly nextOpenAt: Store<Date | null> = createStore<Date | null>(null);

  /**
   * When the workspace reopens, as `HH:mm` on the BUSINESS's clock, formatted
   * server-side. Never compute this on the device — see
   * {@link WorkspaceAvailability.nextOpenLocal}.
   */
  readonly nextOpenLocal: Store<string | null> = createStore<string | null>(null);
  readonly workspaceTimezone: Store<string | null> = createStore<string | null>(null);
  readonly closureLabel: Store<string | null> = createStore<string | null>(null);

  readonly connection: Store<ConnectionState> = createStore<ConnectionState>('disconnected');
  readonly messages: Store<readonly ChatMessage[]> = createStore<readonly ChatMessage[]>(
    Object.freeze([]) as readonly ChatMessage[],
  );
  readonly agentTyping: Store<boolean> = createStore(false);

  /**
   * True while the typing shown in {@link agentTyping} is the AI assistant
   * composing a reply, so the UI can say "Assistant is typing" rather than
   * implying a person is there. `agentTyping` is true alongside it.
   */
  readonly assistantTyping: Store<boolean> = createStore(false);

  /**
   * Whether the AI assistant answers a message sent right now. Bind it to
   * replace "we're offline, leave a message" with "our assistant can help in
   * the meantime" — the first is untrue while the assistant is answering.
   */
  readonly assistantCovers: Store<boolean> = createStore(false);
  readonly unreadCount: Store<number> = createStore(0);

  /**
   * Where the visitor stands while they wait for a person, or null when they
   * are not waiting. From the session response, then `queue:update`; cleared
   * the moment anyone from the team is there — the chat assigned, a team
   * message, someone (or the assistant) typing — as the web widget does. The
   * conversation stays usable underneath it the whole time.
   */
  readonly queue: Store<QueueStatus | null> = createStore<QueueStatus | null>(null);

  /**
   * Whether the workspace offers "Email me this chat", from `GET /config`.
   * See {@link emailTranscript}.
   */
  readonly transcriptEmailEnabled: Store<boolean> = createStore(false);

  /**
   * Whether the workspace offers "Get the reply by email", from `GET /config`:
   * ask the visitor for an address once they have written while nobody can
   * answer, and their contact has none. See {@link setVisitorEmail}.
   */
  readonly replyEmailEnabled: Store<boolean> = createStore(false);

  /**
   * How far into the thread an agent has read: everything the visitor sent at
   * or before this instant has been seen.
   *
   * Server time, not device time — it arrives on `messages:read` and is seeded
   * from the read flags on history. It ONLY EVER MOVES FORWARD, because the
   * events are per-agent: a second agent opening the thread reports the moment
   * *they* read it, which can be earlier than a colleague's, and taking that
   * literally would un-read messages the visitor has already watched turn read.
   */
  readonly agentLastReadAt: Store<Date | null> = createStore<Date | null>(null);

  private readonly messageEmitter = new Emitter<ChatMessage>();
  private readonly deletedEmitter = new Emitter<DeletedMessage>();
  private readonly proactiveEmitter = new Emitter<ProactiveMessage>();
  private readonly errorEmitter = new Emitter<EasyLiveChatError>();

  onMessage(fn: (m: ChatMessage) => void): () => void {
    return this.messageEmitter.subscribe(fn);
  }

  /** A message an agent unsent, once per id — see `EasyLiveChat.onMessageDeleted`. */
  onMessageDeleted(fn: (d: DeletedMessage) => void): () => void {
    return this.deletedEmitter.subscribe(fn);
  }

  onProactiveMessage(fn: (p: ProactiveMessage) => void): () => void {
    return this.proactiveEmitter.subscribe(fn);
  }

  onError(fn: (e: EasyLiveChatError) => void): () => void {
    return this.errorEmitter.subscribe(fn);
  }

  // ── internal state ──────────────────────────────────────────────────────

  private visitorIdValue: string | null = null;
  private profile: StoredProfile | null = null;

  /**
   * True when {@link boot} MINTED this visitor id rather than reading one back.
   *
   * A resume is keyed on the visitor id server-side, so an id that did not
   * exist a moment ago cannot have a conversation behind it: the probe is a
   * guaranteed-empty round trip, and it sat in front of the first paint. Set
   * only by `boot`, and cleared by {@link adoptSession} the instant a session
   * exists under this id — otherwise reopening the chat would skip the resume
   * that is now the whole point and start a second conversation.
   */
  private freshVisitor = false;

  /**
   * Host-supplied identity for a known (logged-in) visitor. When set,
   * {@link open} skips the pre-chat form and starts directly as this person.
   */
  private hasIdentity = false;
  private identityName?: string;
  private identityEmail?: string;
  private phone?: string;
  private identityFields?: Record<string, string>;

  /**
   * The identity-verification claim declared for THIS controller — sent on
   * every session call. Never persisted: the hash is the host backend's to
   * hand over each launch.
   */
  private claimUserId?: string;
  private claimUserHash?: string;

  /**
   * The user id this device's visitor was last identified as, mirrored from
   * `StorageKeys.identifiedUserId`. Updated in memory the moment a decision is
   * made, so a second identify() in the same tick is judged against the first.
   */
  private storedUserId: string | null = null;

  /**
   * Whether this controller has lined the stored visitor up with the declared
   * identity yet. `identify()` does it; otherwise the first session call does,
   * as "nobody is signed in" — the same moment the web widget reconciles, its
   * boot. See {@link settleIdentity}.
   */
  private identitySettled = false;

  /**
   * Storage work an identity change queued (forgetting the old visitor,
   * recording the new user id). Every session call waits for it, so a request
   * can never go out under a visitor id that is being forgotten.
   */
  private identityChain: Promise<void> = Promise.resolve();

  /**
   * Bumped whenever the visitor is switched. A session request that was in
   * flight across a switch belongs to the previous person, and its answer is
   * dropped rather than adopted.
   */
  private identityEpoch = 0;

  /** Set once {@link boot} has read storage — see {@link pendingIdentityOp}. */
  private booted = false;

  /**
   * An identify()/clearIdentity() that arrived before {@link boot} finished,
   * applied as its last step.
   *
   * Both are judged against the user id {@link boot} reads back from storage.
   * Applied before that read — the ordinary `void boot(); identify(…)` with
   * nothing awaited — a returning user looked anonymous: a DIFFERENT person
   * was then "an anonymous visitor signing in" and resumed the last one's
   * conversation, and boot's own profile read clobbered the identity just
   * declared. Only the latest call matters, as with the host's own state.
   */
  private pendingIdentityOp: (() => void) | null = null;

  /**
   * The running {@link open}, and the identity epoch it runs under. A second
   * call joins it — two overlapping opens would each find nothing to resume
   * and start two sessions — unless the visitor was switched since, in which
   * case that open belongs to the previous person and bails out by itself.
   */
  private openInFlight: { run: Promise<void>; epoch: number } | null = null;

  /** One random id per controller, for the help-article view/feedback counts. */
  private helpSessionIdValue: string | null = null;

  private token: string | null = null;
  private conversationIdValue: string | null = null;

  /**
   * The conversation that just ended and the token minted for it, kept after
   * {@link finishEndedSession} lets the session go — what "Email me this chat"
   * and the address on file are asked with on the screen after the chat.
   * Dropped when a session starts again or the visitor changes.
   */
  private endedSession: { conversationId: string; token: string } | null = null;

  /**
   * Which conversation the LIVE socket handshook with. The server binds that
   * at connect time, so this is the only way to notice the socket is now
   * pointed at a conversation we have since moved on from.
   */
  private socketConversationId: string | null = null;

  /**
   * Oldest-message cursor for {@link loadOlderMessages} (the id of the oldest
   * known message; null ⇒ no more history / not yet loaded).
   */
  private oldestCursor: string | null = null;

  /**
   * Distinguishes the two meanings of a null {@link oldestCursor}: "never
   * asked" (fetch the newest page) from "reached the beginning" (stop).
   */
  private historyLoadedOnce = false;

  private socket: WidgetSocket | null = null;
  private presence: PresenceSocket | null = null;

  /**
   * Messages an agent unsent while this controller was listening.
   *
   * Remembered so nothing brings one back: a `message:updated` for it (the
   * visitor's own read receipt fans one out seconds after a reply lands, and it
   * travels a slower path than the delete), or a backfill page fetched just
   * before it went. Ids are never reused, so the set needs no expiry.
   */
  private readonly unsentIds = new Set<string>();

  /**
   * Agent replies counted in {@link unreadCount} since the visitor last looked,
   * so one unsent before they did can be taken back off the badge.
   */
  private readonly unreadIds = new Set<string>();

  /**
   * True once the chat socket has connected at least once this session — used
   * to skip a redundant backfill on the FIRST connect (the session payload
   * already seeded the newest page) and only backfill on real reconnects.
   */
  private hasConnectedOnce = false;

  private lifecycle: AppLifecycle = 'resumed';
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private typingTimer: ReturnType<typeof setTimeout> | null = null;

  /** Single-flight guards. */
  private remintInFlight: Promise<boolean> | null = null;
  private silentResumeInFlight: Promise<boolean> | null = null;

  /**
   * Conversations whose post-chat prompt has already been shown — guards
   * against a `conversation:closed` re-fire (the server emits on ANY `*→CLOSED`
   * PATCH).
   */
  private readonly closedHandled = new Set<string>();

  /**
   * Conversations whose post-chat step is finished — rated, surveyed, or
   * terminal. One set for both, because the visitor only ever sees one of the
   * two and neither should reappear once it is done.
   *
   * Cleared for a conversation when a NEW SESSION opens inside it — see
   * {@link noteSessionBoundary}.
   */
  private readonly ratedConversations = new Set<string>();

  /** Tenant gating rules, captured from `GET /config`. */
  private chatAvailabilityMode = 'ALWAYS';
  private asyncEnabled = false;

  /** The session marker the current post-chat state belongs to. */
  private sessionMarkerId: string | null = null;

  private disposed = false;

  /**
   * Whether this client draws the workspace's consent checkboxes — see
   * `EasyLiveChat.supportsConsent`. Read at each config fetch.
   */
  supportsConsent = false;

  /**
   * Whether the config in {@link widgetConfig} was asked for WITH consent
   * fields. Only then can the visitor have been shown them, so only then does
   * a new chat declare the capability — declaring it over a form fetched
   * without would make the server demand boxes nobody drew.
   */
  private configHasConsent = false;

  // ── accessors ───────────────────────────────────────────────────────────

  get visitorId(): string {
    const v = this.visitorIdValue;
    if (v == null) throw new Error('SessionController.boot() must run before visitorId.');
    return v;
  }

  get conversationId(): string | null {
    return this.conversationIdValue;
  }

  /**
   * The visitor's name as the UI should show it — what the host passed to
   * {@link identify}, else what the pre-chat form captured. Read by views to
   * resolve `%name%` in tenant copy that arrives unsubstituted.
   */
  get visitorName(): string | null {
    return this.identityName ?? this.profile?.name ?? null;
  }

  /**
   * True when the tenant chose "show a notice only" — the composer must be
   * DISABLED, not hidden: an input that vanishes reads as breakage, whereas a
   * disabled one under the notice explains itself.
   */
  get composerLocked(): boolean {
    return this.visitorMode.get() === 'NOTICE_ONLY';
  }

  /**
   * True when either availability gate says the workspace is unavailable:
   * outside working hours, or (for WHEN_ACCEPTING tenants) nobody accepting.
   *
   * Presentational only — bind it to show a notice. It never blocks writing,
   * because a message sent while closed is still a real conversation the team
   * picks up when they are back.
   */
  get workspaceClosed(): boolean {
    return isWorkspaceClosed({
      isOpen: this.isOpen.get(),
      chatAvailabilityMode: this.chatAvailabilityMode,
      agentsAccepting: this.agentsAccepting.get(),
      asyncEnabled: this.asyncEnabled,
    });
  }

  /**
   * Whether the server says there is history behind the loaded page.
   *
   * The cursor is the only authority: a thread opened on the current session
   * has earlier visits behind it, a brand-new conversation does not, and the
   * client cannot tell the two apart by looking at what it holds. Drives the
   * "load earlier" affordance.
   */
  get hasOlderHistory(): boolean {
    return this.oldestCursor != null || !this.historyLoadedOnce;
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  /**
   * Adopt a fresh config on an already-booted controller.
   *
   * The host builds a config from its CURRENT app language every time it opens
   * the chat, but `boot()` is a singleton and used to return early once booted
   * — so `contentLocale` stayed at whatever it was the first time. A visitor
   * who opened the chat in Kurdish, switched the app to Arabic and came back
   * got Arabic SDK chrome wrapped around Kurdish tenant copy: a Kurdish
   * greeting, and a post-chat survey whose questions were still Kurdish,
   * because both are fetched with that stale locale.
   *
   * The REST client is rebuilt because it bakes in the base URL and headers.
   */
  applyConfig(next: EasyLiveChatConfig): void {
    const resolved = resolveConfig(next);
    if (
      resolved.apiBase === this.config.apiBase &&
      resolved.tenantSlug === this.config.tenantSlug &&
      resolved.locale === this.config.locale &&
      resolved.contentLocale === this.config.contentLocale &&
      resolved.channel === this.config.channel
    ) {
      return;
    }
    this.config = resolved;
    this.rest = new RestClient(resolved);
  }

  /**
   * Load (or generate) the durable visitorId + cached profile. NO NETWORK.
   *
   * A corrupt profile cache is ignored, not thrown.
   */
  async boot(): Promise<void> {
    let vid = await this.storage.read(StorageKeys.visitorId);
    if (vid == null || vid.trim().length === 0) {
      vid = uuidV4();
      await this.storage.write(StorageKeys.visitorId, vid);
      this.freshVisitor = true;
    }
    this.visitorIdValue = vid;

    const storedUser = await this.storage.read(StorageKeys.identifiedUserId);
    this.storedUserId = storedUser != null && storedUser.trim().length > 0 ? storedUser : null;

    const rawProfile = await this.storage.read(StorageKeys.profile);
    if (rawProfile != null && rawProfile.length > 0) {
      try {
        const decoded: unknown = JSON.parse(rawProfile);
        if (decoded != null && typeof decoded === 'object' && !Array.isArray(decoded)) {
          this.profile = parseStoredProfile(decoded as Record<string, unknown>);
          // A cold start has no identify() behind it yet; the cached profile
          // is the only thing that knows who this visitor is.
          this.phone ??= this.profile.phone;
        }
      } catch {
        // Corrupt cache — treat as no profile.
      }
    }

    this.booted = true;
    const pending = this.pendingIdentityOp;
    this.pendingIdentityOp = null;
    pending?.();
  }

  /**
   * Pre-identify a known (logged-in) visitor. Call before {@link open}, which
   * then skips the pre-chat form and starts directly as this person.
   *
   * A fully-empty identity is ignored (the visitor stays anonymous).
   *
   * AUTHORITATIVE, and deliberately not a merge: the host is declaring the
   * full visitor identity for this session, so a value it no longer supplies
   * (an email, say) must be CLEARED — otherwise an old, or a previous user's,
   * email leaks into the new session out of secure storage.
   *
   * `userId` + `userHash` are the identity-verification claim, sent on every
   * session call from now on. The `userId` is also compared with the one this
   * device's visitor was last identified as ({@link visitorChangeFor}):
   *
   * - anonymous → identified keeps the visitor, so the conversation they are
   *   in continues with the identity attached (re-sent at once when a session
   *   is live);
   * - a DIFFERENT `userId`, or an identity WITHOUT one after one was set —
   *   including an otherwise empty identity, which then means "signed out" —
   *   forgets the stored visitor (id, profile, token) and continues as a new
   *   one. A live session is torn down, and the chat re-opens as the new
   *   person if it was open.
   *
   * The `userId` survives restarts (`StorageKeys.identifiedUserId`); the hash
   * does not, so call this on every launch BEFORE `open()`. A session that
   * starts with no identify() behind it while a
   * `userId` is on record is treated as signed out, exactly as the web widget
   * treats a page that boots without an identity.
   *
   * Called before {@link boot} has finished, it is held and applied by boot,
   * once the stored user id it is judged against has been read.
   */
  identify(identity: VisitorIdentity): void {
    if (!this.booted) {
      this.pendingIdentityOp = () => this.identify(identity);
      return;
    }
    const userId = cleanClaim(identity.userId);
    const userHash = cleanClaim(identity.userHash);
    const hasAny =
      (identity.name != null && identity.name.trim().length > 0) ||
      (identity.email != null && identity.email.trim().length > 0) ||
      (identity.phone != null && identity.phone.trim().length > 0) ||
      (identity.fields != null && Object.keys(identity.fields).length > 0) ||
      userId != null;
    if (!hasAny) {
      // Ignored as before — unless a verified user is on record, in which case
      // an empty identity is that person signing out.
      if (this.claimUserId == null && this.storedUserId == null) return;
      if (this.declareClaim(undefined, undefined, { reopen: true })) this.reopenAfterSwitch();
      return;
    }
    // First, because a switch clears the previous person's identity — and must
    // not clear the one being declared now.
    const reopen = this.declareClaim(userId, userHash, { reopen: true });
    this.hasIdentity = true;
    this.identityName = identity.name;
    this.identityEmail = identity.email;
    this.phone = identity.phone;
    this.identityFields = identity.fields;
    this.profile = {
      name: identity.name,
      email: identity.email,
      phone: identity.phone,
      preChat: identity.fields,
    };
    // After the new identity is in place, so the re-open starts as this person.
    if (reopen) this.reopenAfterSwitch();
  }

  /**
   * Declare that nobody is signed in any more, without tearing the SDK down.
   *
   * Drops the identity passed to {@link identify} — name, email, phone, fields
   * and the verification claim — and the cached profile, in memory and in
   * storage. That is the whole job for a visitor never identified with a
   * `userId`: they keep their visitorId and conversation, as an anonymous
   * visitor would, which is what a name/email-only host needs when its user
   * signs out and `reset()` would be too much.
   *
   * When this device's visitor WAS identified with a `userId`, the visitor is
   * forgotten as well — a fresh visitorId, no conversation to resume —
   * because the next person to
   * open the chat may be someone else ({@link visitorChangeFor}); a chat on
   * screen restarts as an anonymous visitor. `EasyLiveChat.reset()` remains
   * the full logout that also abandons the visitorId in every case.
   *
   * Held until {@link boot} has finished, like identify().
   */
  clearIdentity(): void {
    if (!this.booted) {
      this.pendingIdentityOp = () => this.clearIdentity();
      return;
    }
    this.hasIdentity = false;
    this.identityName = undefined;
    this.identityEmail = undefined;
    this.phone = undefined;
    this.identityFields = undefined;
    this.profile = null;
    // Otherwise the next cold start reads it back and the signed-out person's
    // name rides along on the next resume.
    this.enqueueStorage(() => this.storage.delete(StorageKeys.profile));
    if (this.declareClaim(undefined, undefined, { reopen: true })) this.reopenAfterSwitch();
  }

  // ── identity verification + the person-change rule ─────────────────────

  /**
   * Adopt `userId`/`userHash` as this controller's claim and line the stored
   * visitor up with it ({@link visitorChangeFor}).
   *
   * Returns true when the visitor was switched out of a chat that was open and
   * `reopen` was asked for — the caller re-opens once the new identity is in
   * place, so the chat comes back as the new person rather than going blank.
   */
  private declareClaim(
    userId: string | undefined,
    userHash: string | undefined,
    options: { reopen: boolean },
  ): boolean {
    this.identitySettled = true;
    const next = userId ?? null;
    const change = visitorChangeFor(this.storedUserId, next);
    this.claimUserId = userId;
    this.claimUserHash = userId != null ? userHash : undefined;
    if (change === 'same') return false;

    this.storedUserId = next;
    if (change === 'upgraded') {
      // The same visitor, now known: their conversation continues.
      this.enqueueStorage(() => this.storage.write(StorageKeys.identifiedUserId, next as string));
      // Attach the identity to a conversation already under way NOW, not at
      // the next token re-mint hours later — a resume carries the claim.
      if (this.token != null) void this.identityChain.then(() => this.remintToken());
      return false;
    }

    const wasOpen = this.switchVisitor();
    // After the forget switchVisitor queued: a crash between the two can only
    // lose the old visitor, never hand them to the new person.
    this.enqueueStorage(() =>
      next != null
        ? this.storage.write(StorageKeys.identifiedUserId, next)
        : this.storage.delete(StorageKeys.identifiedUserId),
    );
    return options.reopen && wasOpen;
  }

  /**
   * A different person: drop everything the previous one left in memory and
   * continue as a brand-new visitor.
   *
   * Without this, a second person signing in on the same device opened the
   * first person's conversation — and, once the assistant can look up account
   * data, would be answered about the first person's account.
   *
   * Returns whether a chat was open (any phase but idle).
   */
  private switchVisitor(): boolean {
    const wasOpen = this.dropVisitorSession();

    // The previous person's identity goes with them.
    this.hasIdentity = false;
    this.identityName = undefined;
    this.identityEmail = undefined;
    this.phone = undefined;
    this.identityFields = undefined;
    this.profile = null;

    const vid = uuidV4();
    this.visitorIdValue = vid;
    // Nothing can be resumed under an id that did not exist a moment ago.
    this.freshVisitor = true;
    this.enqueueStorage(async () => {
      for (const key of StorageKeys.identity) await this.storage.delete(key);
      await this.storage.write(StorageKeys.visitorId, vid);
    });

    if (wasOpen) this.setPhase('idle');
    return wasOpen;
  }

  /**
   * Let go of everything the current visitor's session left in memory — the
   * socket, the conversation, the thread — and bump the identity epoch, so a
   * session request still in flight for them is dropped rather than adopted.
   * The identity and the visitor id are the caller's to replace.
   *
   * Returns whether a chat was open (any phase but idle).
   */
  private dropVisitorSession(): boolean {
    this.identityEpoch++;
    const wasOpen = this.phase.get() !== 'idle';

    this.stopHeartbeat();
    this.teardownSocket();
    this.teardownPresence();
    if (this.typingTimer != null) clearTimeout(this.typingTimer);
    this.typingTimer = null;

    this.token = null;
    this.conversationIdValue = null;
    this.socketConversationId = null;
    this.oldestCursor = null;
    this.historyLoadedOnce = false;
    this.sessionMarkerId = null;
    this.closedHandled.clear();
    this.ratedConversations.clear();
    this.unreadIds.clear();
    this.messages.set(Object.freeze([]) as readonly ChatMessage[]);
    this.unreadCount.set(0);
    this.agentTyping.set(false);
    this.assistantTyping.set(false);
    this.agentLastReadAt.set(null);
    this.queue.set(null);
    this.connection.set('disconnected');
    this.endedSession = null;
    return wasOpen;
  }

  /** Re-run the open flow as the visitor who just replaced the last one. */
  private reopenAfterSwitch(): void {
    if (this.disposed) return;
    this.open().catch((e: unknown) => this.emitError(e));
  }

  /** Queue identity storage work. The chain never rejects. */
  private enqueueStorage(op: () => Promise<void>): void {
    this.identityChain = this.identityChain.then(op).catch(() => {
      // Storage refused. Nothing persisted, but memory already holds the right
      // visitor for this session — the same trade the web widget makes.
    });
  }

  /**
   * Make sure the stored visitor has been lined up with the declared identity
   * before anything uses the visitor id, then wait for the storage work.
   *
   * When identify() was never called on this controller, "nobody is signed
   * in" is what was declared: a `userId` still on record from an earlier
   * launch then means its person signed out, and their visitor is forgotten.
   */
  private settleIdentity(): Promise<void> {
    if (!this.identitySettled) {
      this.identitySettled = true;
      if (this.storedUserId != null) this.declareClaim(undefined, undefined, { reopen: false });
    }
    return this.identityChain;
  }

  /**
   * True while a signed-in visitor is on record and nobody has said yet
   * whether they are still the one using the app. Background traffic keyed on
   * the visitor id (heartbeat, presence) waits until then.
   */
  private get identityPending(): boolean {
    return !this.identitySettled && this.storedUserId != null;
  }

  /**
   * `GET /config`. Sets the config + every availability store.
   *
   * Deliberately does NOT set `phase = 'offline'` when the workspace is shut.
   * A visitor who arrives out of hours continues into the ordinary chat and
   * simply sees a notice (bind {@link workspaceClosed}) — their message
   * becomes a PENDING conversation that is auto-assigned when the team
   * returns. The old behaviour dropped them onto a ticket form, a dead end
   * whose submissions never became conversations.
   */
  async loadConfig(): Promise<WidgetConfig> {
    this.setPhase('loading');
    const askConsent = this.supportsConsent;
    const res = await this.guardAuth(() => this.rest.getConfig({ consent: askConsent }));
    this.configHasConsent = askConsent;
    this.widgetConfig.set(res.config);
    this.isOpen.set(res.isOpen);
    this.agentsAccepting.set(res.agentsAccepting);
    // Remember the tenant's gating rules so a later `workspace:availability`
    // push is judged by exactly the rules this first decision used.
    this.chatAvailabilityMode = res.chatAvailabilityMode;
    this.asyncEnabled = res.asyncEnabled;
    this.visitorMode.set(res.visitorMode);
    this.availabilityReason.set(res.reason);
    this.nextOpenAt.set(res.nextOpenAt);
    this.closureLabel.set(res.closureLabel ?? null);
    this.nextOpenLocal.set(res.nextOpenLocal ?? null);
    this.workspaceTimezone.set(res.timezone ?? null);
    this.assistantCovers.set(res.assistantCovers);
    this.transcriptEmailEnabled.set(res.transcriptEmailEnabled);
    this.replyEmailEnabled.set(res.replyEmailEnabled);
    return res.config;
  }

  /**
   * Full orchestration: config → presence → silentResume → (prechat |
   * anonymous start) → connect `/widgets`.
   *
   * ALWAYS re-fetches the config. This used to be
   * `widgetConfig ?? await loadConfig()`, so reopening the chat within one app
   * session reused the config captured at startup: `isOpen` was frozen at
   * whatever it was then, and no amount of server-side correctness could reach
   * the UI.
   *
   * The config and the resume run CONCURRENTLY. They were serial, so every
   * open cost two full round trips back to back before anything could be
   * drawn, and nothing warmed either of them — `boot` is deliberately
   * offline. They are independent: the only thing the resume reads from the
   * config is {@link idlePhase}, and `open` sets the final phase itself
   * afterwards regardless. On a genuine first open the resume is skipped
   * outright (see {@link freshVisitor}), which takes the tap down to one.
   *
   * SINGLE-FLIGHT: a call while one is running joins it. Two overlapping runs
   * — the host opening the chat while an identity change re-opens it, or a
   * launcher and a deep link both calling it — would each find nothing to
   * resume and start two sessions. The one exception is a run that began
   * before the visitor was switched: it belongs to the previous person and
   * bails out at its next epoch check, so the new person gets a run of their
   * own rather than joining one that will do nothing for them.
   */
  open(): Promise<void> {
    const inflight = this.openInFlight;
    if (inflight != null && inflight.epoch === this.identityEpoch) return inflight.run;
    // Read the epoch AFTER starting: the run settles the identity synchronously
    // before its first await, and a switch it makes there is its own.
    const run = this.openImpl();
    const entry = { run, epoch: this.identityEpoch };
    this.openInFlight = entry;
    const clear = (): void => {
      if (this.openInFlight === entry) this.openInFlight = null;
    };
    run.then(clear, clear);
    return run;
  }

  private async openImpl(): Promise<void> {
    // Line the stored visitor up with whoever is (or is not) signed in before
    // anything reads the visitor id.
    await this.settleIdentity();
    const epoch = this.identityEpoch;

    // Both started BEFORE either is awaited, so the requests overlap. Config
    // goes first so it is the one that sets `loading`, and because it is the
    // one the first paint is actually waiting on. `silentResume` resolves
    // rather than rejects on failure, so the pending probe cannot surface as
    // an unhandled rejection if the config load throws first.
    const loading = this.loadConfig();
    const resuming = this.freshVisitor ? Promise.resolve(false) : this.silentResume();

    const cfg = await loading;
    // The visitor changed while the config loaded; that switch re-opens as the
    // new person, and this open belongs to the previous one.
    if (epoch !== this.identityEpoch) return;

    // The receive-only presence socket, for pre-chat proactive outreach.
    if (this.config.enablePresenceSocket) this.connectPresence();

    if (this.composerLocked) {
      // NOTICE_ONLY: the tenant takes nothing new. But an existing
      // conversation is still worth showing — a visitor reopening after hours
      // is usually coming back to read the reply they were promised, and
      // hiding it behind a notice loses them their own history. Sending stays
      // blocked either way: the composer is locked, and the server refuses the
      // write regardless of what the client renders.
      // Joins the probe already in flight — `silentResume` is single-flight.
      const resumedWhileLocked = await resuming;
      if (!resumedWhileLocked) this.setPhase('offline');
      return;
    }

    const resumed = await resuming;
    if (resumed || epoch !== this.identityEpoch) return;

    if (this.hasIdentity) {
      // Known (logged-in) visitor: skip the pre-chat form and start directly
      // as this person. The host vouches for the identity, so do not
      // re-validate it against the server's form fields.
      await this.startSession(
        {
          name: this.identityName,
          email: this.identityEmail,
          phone: this.phone,
          fields: this.identityFields,
        },
        { skipValidation: true },
      );
    } else if (!cfg.preChatForm.enabled) {
      await this.startSession();
    } else {
      this.setPhase('prechat');
    }
  }

  /**
   * Re-read availability and re-gate the UI.
   *
   * Cheap and safe to call whenever the chat becomes visible. {@link open}
   * only runs its full flow from an idle-ish phase, so reopening the screen on
   * a singleton still sitting in `chat` used to refresh nothing at all — the
   * visitor kept whatever availability was true when they first opened it,
   * which could be hours and several shift boundaries earlier.
   *
   * Deliberately does NOT touch the conversation, socket or messages: this is
   * about whether the workspace is open, not about restarting the session.
   */
  async refreshAvailability(): Promise<void> {
    if (this.disposed) return;
    try {
      const askConsent = this.supportsConsent;
      const res = await this.rest.getConfig({ consent: askConsent });
      if (this.disposed) return;
      this.configHasConsent = askConsent;
      this.widgetConfig.set(res.config);
      this.isOpen.set(res.isOpen);
      this.agentsAccepting.set(res.agentsAccepting);
      this.visitorMode.set(res.visitorMode);
      this.availabilityReason.set(res.reason);
      this.nextOpenAt.set(res.nextOpenAt);
      this.closureLabel.set(res.closureLabel ?? null);
      this.nextOpenLocal.set(res.nextOpenLocal ?? null);
      this.workspaceTimezone.set(res.timezone ?? null);
      this.assistantCovers.set(res.assistantCovers);
      this.transcriptEmailEnabled.set(res.transcriptEmailEnabled);
      this.replyEmailEnabled.set(res.replyEmailEnabled);
      this.chatAvailabilityMode = res.chatAvailabilityMode;
      this.asyncEnabled = res.asyncEnabled;

      // The tenant takes no messages now. Showing the notice is the honest
      // thing to do — the server would refuse a send anyway. The rating screen
      // is left alone; it has no composer, and replacing it loses the rating.
      const p = this.phase.get();
      if (this.composerLocked && p !== 'offline' && p !== 'feedback') {
        this.setPhase('offline');
      }
    } catch {
      // Availability is a refinement of what we already show; a failed refresh
      // must never break a working chat.
    }
  }

  /**
   * `POST /session { resumeOnly: true }`.
   *
   * SINGLE-FLIGHT: {@link open} awaits it while an incoming proactive message
   * also fires it fire-and-forget, and two concurrent resumes adopt two
   * sessions (duplicate sockets, clobbered conversation state).
   *
   * Returns true and adopts the session only when an active conversation AND a
   * token come back — never connect a socket without a token. On false it
   * restores a sensible phase so the controller never strands at `resuming`.
   */
  silentResume(): Promise<boolean> {
    const inflight = this.silentResumeInFlight;
    if (inflight != null) return inflight;
    const p = this.silentResumeImpl().finally(() => {
      this.silentResumeInFlight = null;
    });
    this.silentResumeInFlight = p;
    return p;
  }

  private async silentResumeImpl(): Promise<boolean> {
    await this.settleIdentity();
    const epoch = this.identityEpoch;
    this.setPhase('resuming');
    let res: SessionResult;
    try {
      res = await this.guardAuth(() =>
        this.rest.postSession({
          visitorId: this.visitorId,
          userId: this.claimUserId,
          userHash: this.claimUserHash,
          name: this.profile?.name,
          email: this.profile?.email,
          // The resume path MUST send the phone. The create path always did;
          // this one did not, so a visitor who already had a live conversation
          // when the host identified them — opening the chat from a login
          // screen, signing in, coming back — handed the agent a name and no
          // phone number. The server adopts whatever a resume carries
          // (`adoptIdentityOnResume`); it can only adopt what is sent.
          phone: this.phone ?? this.profile?.phone,
          locale: this.effectiveLocale,
          resumeOnly: true,
        }),
      );
    } catch (e) {
      if (epoch !== this.identityEpoch) return false;
      this.emitError(e);
      this.setPhase(this.idlePhase());
      return false;
    }

    // Asked as the previous person; the switch re-opens as the new one.
    if (epoch !== this.identityEpoch) return false;

    if (res.hasActiveConversation && res.token != null) {
      await this.adoptSession(res);
      return true;
    }
    this.setPhase(this.idlePhase());
    return false;
  }

  /**
   * The phase to fall back to when there is no active conversation: prechat
   * when a form is configured, else idle.
   */
  private idlePhase(): ChatPhase {
    const cfg = this.widgetConfig.get();
    return cfg != null && cfg.preChatForm.enabled ? 'prechat' : 'idle';
  }

  /**
   * `POST /session` with optional pre-chat `fields`.
   *
   * Validates client-side for UX; the server's `400 { fieldId }` stays the
   * authority. Persists the (possibly enriched) profile, then adopts.
   *
   * `consents` are the ids of the consent fields the visitor ticked. They are
   * sent — with the `consent` capability — whenever the form the visitor
   * filled in could have shown consent fields: it is enabled and was fetched
   * with {@link supportsConsent} on. Unset then means none ticked, so a
   * required one fails here with `CONSENT_REQUIRED` before the server says the
   * same. Otherwise nothing about consent is sent and the server asks for
   * none: a host-identified visitor (`skipValidation`) never saw a form, and
   * an anonymous start has no form to see.
   */
  async startSession(
    identity: PreChatSubmission = {},
    options: { skipValidation?: boolean } = {},
  ): Promise<void> {
    // A claim passed here is declared just as identify() would declare it;
    // without one, the claim identify() set stands (this call merges, it does
    // not replace).
    const claimedId = cleanClaim(identity.userId);
    const claimedHash = cleanClaim(identity.userHash);
    if (claimedId != null && (claimedId !== this.claimUserId || claimedHash !== this.claimUserHash)) {
      this.declareClaim(claimedId, claimedHash, { reopen: false });
    }
    await this.settleIdentity();
    const epoch = this.identityEpoch;

    const cfg = this.widgetConfig.get();
    const fields = identity.fields;
    if (
      options.skipValidation !== true &&
      cfg != null &&
      cfg.preChatForm.enabled &&
      fields != null
    ) {
      for (const field of cfg.preChatForm.fields as PreChatField[]) {
        const err = validatePreChatField(field, fields[field.id]);
        if (err != null) {
          throw this.surface(new EasyLiveChatError(err, { fieldId: field.id }));
        }
      }
    }
    // After the values, as the server checks them.
    const consents =
      options.skipValidation !== true &&
      this.configHasConsent &&
      cfg != null &&
      cfg.preChatForm.enabled
        ? [...(identity.consents ?? [])]
        : undefined;
    if (consents != null && cfg != null) {
      const check = validateConsents(cfg.preChatForm, consents);
      if (!check.ok) {
        throw this.surface(new EasyLiveChatError(check.error, { fieldId: check.fieldId }));
      }
    }

    this.setPhase('loading');
    let res: SessionResult;
    try {
      res = await this.guardAuth(() =>
        this.rest.postSession({
          visitorId: this.visitorId,
          userId: this.claimUserId,
          userHash: this.claimUserHash,
          name: identity.name ?? this.profile?.name,
          email: identity.email ?? this.profile?.email,
          phone: identity.phone ?? this.phone ?? this.profile?.phone,
          locale: this.effectiveLocale,
          fields,
          consents,
        }),
      );
    } catch (e) {
      if (epoch === this.identityEpoch) {
        this.setPhase(cfg?.preChatForm.enabled === true ? 'prechat' : 'idle');
      }
      throw this.surface(e);
    }

    // Started as the previous person — neither their profile nor their
    // session may land on the new visitor.
    if (epoch !== this.identityEpoch) return;

    // Persist the (possibly enriched) profile for future silent-resume calls.
    // `phone` is included deliberately: the Flutter reference drops it here,
    // which is why a phone captured by identify() never survived a cold start
    // even though §4.1 seeds it back out of this cache.
    await this.persistProfile({
      name: identity.name ?? this.profile?.name,
      email: identity.email ?? this.profile?.email,
      phone: identity.phone ?? this.phone ?? this.profile?.phone,
      preChat: fields ?? this.profile?.preChat,
    });

    if (res.token != null) await this.adoptSession(res);
  }

  /**
   * Adopt a freshly-minted/resumed session: store the JWT and conversation id,
   * seed the messages, connect the `/widgets` socket, move to `chat`.
   */
  private async adoptSession(res: SessionResult): Promise<void> {
    // There is a conversation under this visitor id now, so the next open has
    // something real to resume.
    this.freshVisitor = false;
    this.token = res.token ?? null;
    this.conversationIdValue = res.conversationId ?? null;
    this.oldestCursor = res.nextCursor ?? null;
    // The payload IS the newest page, so the next fetch continues from its
    // cursor — or stops, when the whole conversation already arrived.
    this.historyLoadedOnce = true;
    if (res.token != null) await this.storage.write(StorageKeys.token, res.token);
    if (res.conversationId != null) {
      await this.storage.write(StorageKeys.conversationId, res.conversationId);
    }
    // A live session again: the chat that ended before it is no longer the
    // one "Email me this chat" means.
    this.endedSession = null;

    // Cleared BEFORE the seed, not after: the watermark only ever moves
    // forward, so one carried over from a previous conversation would outrank
    // anything this thread's history has to say and show its first messages as
    // already read.
    this.agentLastReadAt.set(null);
    // The queue as the session states it — a resume that finds the visitor
    // still waiting puts the notice straight back, rather than leaving it to
    // the next `queue:update`, which may be minutes away.
    this.queue.set(res.queue);
    this.forgetUnsent(res.unsentIds, res.conversationId);
    this.setMessages(dedupSort(res.messages.filter((m) => !this.unsentIds.has(m.id))));
    this.connectSocket();
    // Presence (`/widget-presence`) is the PRE-chat proactive channel. Once
    // the full chat socket is up, `/widgets` delivers proactive too — keeping
    // presence open would double-deliver outreach and waste a socket.
    this.teardownPresence();
    this.setPhase('chat');
    this.startHeartbeat();
  }

  /** Tear down sockets + heartbeat; keep the reactive state for the UI. */
  closeSession(): void {
    this.stopHeartbeat();
    this.teardownSocket();
    this.teardownPresence();
    this.connection.set('disconnected');
  }

  // ── messaging ───────────────────────────────────────────────────────────

  /**
   * Optimistically append a `tmp-` message and emit `message:send`.
   *
   * The returned `serverMessageId` resolves to the server id on ack, or
   * rejects with an {@link EasyLiveChatError} on `ok: false` / no socket. The
   * ack itself is bounded by the socket's 20s timeout, so a socket that drops
   * between emit and ack yields a terminal failure (the bubble flips to
   * *failed*, tap-to-retry) instead of hanging forever.
   */
  sendMessage(
    body: string,
    options: { attachmentUrls?: string[]; reply?: { messageId: string; buttonId: string } } = {},
  ): SendResult {
    const attachmentUrls = options.attachmentUrls ?? [];
    const tempId = `tmp-${uuidV4()}`;
    const optimistic = optimisticMessage({
      tempId,
      conversationId: this.conversationIdValue ?? '',
      body,
      attachmentUrls,
      createdAt: new Date(),
    });
    this.appendMessage(optimistic);

    const socket = this.socket;
    if (socket == null) {
      this.failOptimistic(tempId);
      const err = new EasyLiveChatError(EasyLiveChatErrorCode.NO_TOKEN, {
        message: 'No active socket — call open()/startSession() first.',
      });
      this.emitError(err);
      return { optimistic, serverMessageId: Promise.reject(err) };
    }

    const serverMessageId = socket
      .sendMessage({ body, attachmentUrls, reply: options.reply })
      .then((ack) => {
        if (!ack.ok) {
          this.failOptimistic(tempId);
          const err = new EasyLiveChatError(EasyLiveChatErrorCode.SEND_REJECTED, {
            message: ack.error,
          });
          this.emitError(err);
          throw err;
        }
        const serverId = ack.messageId;
        if (serverId != null) {
          this.reconcileOptimistic(tempId, serverId);
          return serverId;
        }
        // Ack'd but with no id — leave the optimistic row in place and mark it
        // sent. It keeps its `tmp-` id, which is exactly why the echo matcher
        // keys on that rather than on `isOptimistic`.
        this.markSent(tempId);
        return tempId;
      })
      .catch((e: unknown) => {
        const err = toEasyLiveChatError(e);
        if (err.code !== EasyLiveChatErrorCode.SEND_REJECTED) {
          // A transport-level throw has not been reflected yet.
          this.failOptimistic(tempId);
          this.emitError(err);
        }
        throw err;
      });

    return { optimistic, serverMessageId };
  }

  /**
   * Re-send a previously failed message (tap-to-retry). Drops the failed row
   * and re-sends its body + attachments as a fresh optimistic message. Returns
   * null when the message is not in a failed state.
   */
  resend(message: ChatMessage): SendResult | null {
    if (!message.failed) return null;
    this.removeMessage(message.id);
    return this.sendMessage(message.body ?? '', { attachmentUrls: message.attachmentUrls });
  }

  /** Emit `typing { isTyping }` (the caller debounces). */
  setTyping(isTyping: boolean): void {
    this.socket?.setTyping(isTyping);
  }

  /**
   * End this conversation on the visitor's behalf.
   *
   * Returns whether a POST-CHAT STEP WILL FOLLOW — i.e. whether the caller
   * should keep the chat on screen for the survey (or CSAT prompt), or has
   * nothing left to show and should just leave.
   *
   * That answer cannot be inferred from the phase afterwards. The phase is
   * driven by the server's `conversation:closed` echo, and
   * {@link handleConversationClosed} deliberately ignores the echo for a
   * conversation already closed or already rated — which is right (the server
   * re-emits on any `*→CLOSED` transition, and nobody should be asked to rate
   * the same chat twice) but means "end" can legitimately change nothing at
   * all. A caller that waited for a phase change in that case waited forever:
   * the visitor confirmed leaving and stayed put.
   *
   * Decided BEFORE the socket call, because the echo can arrive while we are
   * still awaiting it and would otherwise flip the very sets being read.
   */
  async endChat(): Promise<boolean> {
    const socket = this.socket;
    const id = this.conversationIdValue;
    const willShowPostChat =
      id != null && !this.closedHandled.has(id) && !this.ratedConversations.has(id);
    if (socket == null) return false;
    await socket.endChat();
    // The stored conversation is dropped either way: the server only ever
    // resumes an OPEN/PENDING thread, so reopening starts a fresh conversation
    // and a stale local copy would only disagree. The IN-MEMORY id and token
    // stay put so the post-chat submission can still reach the conversation it
    // belongs to.
    await this.storage.delete(StorageKeys.conversationId);
    await this.storage.delete(StorageKeys.token);
    if (!willShowPostChat) this.finishEndedSession();
    return willShowPostChat;
  }

  /** Page older history via `GET /messages?cursor=` (walks backward in time). */
  async loadOlderMessages(): Promise<MessagePage> {
    const token = this.token;
    if (token == null) return { messages: [], nextCursor: null, unsentIds: [] };
    // A null cursor after a load means the session payload already reached the
    // start of the conversation. Passing it to the API would re-fetch the
    // NEWEST page instead — harmless (the merge dedupes) but a wasted round
    // trip on every short thread, and it happens unprompted now that loading
    // is automatic.
    if (this.oldestCursor == null && this.historyLoadedOnce) {
      return { messages: [], nextCursor: null, unsentIds: [] };
    }
    this.historyLoadedOnce = true;
    const page = await this.guardAuth(() =>
      this.rest.getMessages({ token, cursor: this.oldestCursor, limit: 50 }),
    );
    this.forgetUnsent(page.unsentIds);
    if (page.messages.length > 0) this.mergeMessages(page.messages);
    this.oldestCursor = page.nextCursor;
    return page;
  }

  /**
   * The thread is on screen: clear the unread badge AND tell the server.
   *
   * The badge half is local. The server half turns the agent's delivery ticks
   * green — without it a message to an SDK visitor sat on a permanent single
   * check and no agent could tell read from ignored. Safe to call often; the
   * server throttles and no-ops once the thread is fully read.
   */
  markRead(): void {
    this.unreadIds.clear();
    if (this.unreadCount.get() !== 0) this.unreadCount.set(0);
    this.socket?.reportSeen();
  }

  // ── reactions ───────────────────────────────────────────────────────────

  /**
   * React to one of the team's messages with `emoji`, or take the visitor's
   * reaction back (`null`). One reaction per message: another emoji replaces
   * theirs. `toggledReaction(message, emoji)` says which a tap on a chip
   * means.
   *
   * Shown at once and put back if the server says no — the web widget's
   * `handleReact`. Resolves true once the server holds it; false (with the
   * thread as it was) when it refused, the socket is down, or the message
   * cannot take a reaction (`canReactTo`): the visitor's own, a system
   * notice, one still being sent. Never rejects.
   */
  async react(messageId: string, emoji: string | null): Promise<boolean> {
    const socket = this.socket;
    if (socket == null || !socket.isConnected) return false;
    if (emoji != null && (emoji.length === 0 || emoji.length > REACTION_EMOJI_MAX_LENGTH)) return false;
    const held = this.messages.get().find((m) => m.id === messageId);
    if (held == null || !canReactTo(held)) return false;
    const before = held.reactions;
    this.setReactions(messageId, withMyReaction(before, emoji));
    const ack = await socket.react(messageId, emoji);
    if (this.disposed) return false;
    if (ack.ok) {
      // The server's word is final — it may hold a reaction from another of
      // the visitor's devices that this one has not heard of yet.
      if (ack.reactions !== undefined) this.setReactions(messageId, ack.reactions);
      return true;
    }
    this.setReactions(messageId, before ?? []);
    return false;
  }

  /** `message:reactions` — the message's whole list after a change. */
  private handleReactions(update: ReactionsUpdate): void {
    if (
      update.conversationId.length > 0 &&
      this.conversationIdValue != null &&
      update.conversationId !== this.conversationIdValue
    ) {
      return;
    }
    this.setReactions(update.messageId, update.reactions);
  }

  /** Replace one held message's reactions; a message not held is left alone. */
  private setReactions(messageId: string, reactions: ChatMessage['reactions']): void {
    const list = this.messages.get();
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const held = list[idx] as ChatMessage;
    if (held.reactions !== undefined && sameReactions(held.reactions, reactions)) return;
    const next = [...list];
    next[idx] = { ...held, reactions };
    this.setMessages(next);
  }

  // ── the queue ───────────────────────────────────────────────────────────

  private handleQueueUpdate(update: QueueUpdate): void {
    if (update.assigned) {
      this.queue.set(null);
      return;
    }
    this.queue.set({ position: update.position, minutes: update.minutes, text: update.text });
  }

  /** Someone from the team is here now: the wait is over. */
  private leaveQueue(): void {
    if (this.queue.get() != null) this.queue.set(null);
  }

  // ── email to the visitor ────────────────────────────────────────────────
  //
  // The web widget's "Email me this chat" and "Get the reply by email", over
  // the same endpoints. Each needs a widget token: the live session's, or —
  // on the screen after a chat — the one minted for the conversation that just
  // ended. Addresses come back masked; the device may not be the visitor's own.

  /**
   * "Email me this chat": the server sends this conversation — or the one
   * that just ended — to `email`, or, with none given, to the address the
   * visitor's contact already has (the pre-chat form's, a saved one, an
   * `identify()`'d one).
   *
   * Offer it only while {@link transcriptEmailEnabled} is true. Rejects with
   * an `EasyLiveChatError`: `NO_CONTACT_EMAIL` when no address was given and
   * none is on file (ask for one), `INVALID_EMAIL`, `EMAIL_UNSUBSCRIBED`,
   * `TRANSCRIPT_RATE_LIMITED`, `TRANSCRIPT_DISABLED`, `NO_TOKEN` before there
   * is any conversation, or a transport failure. Resolves with the address it
   * went to, masked by the server.
   */
  async emailTranscript(options: { email?: string } | string = {}): Promise<TranscriptResult> {
    const typed = (typeof options === 'string' ? options : options.email)?.trim();
    const email = typed != null && typed.length > 0 ? typed : undefined;
    const conversationId = this.conversationIdValue;
    if (this.token != null && conversationId != null) {
      return this.guardAuth(() =>
        this.rest.postTranscript({
          // Read again inside: `guardAuth` re-runs this after a re-mint.
          token: this.token ?? '',
          conversationId,
          email,
        }),
      );
    }
    const ended = this.endedSession;
    if (ended != null) {
      // Not through `guardAuth`: its re-mint is a resume, and resuming a
      // closed conversation re-opens it.
      return this.rest.postTranscript({
        token: ended.token,
        conversationId: ended.conversationId,
        email,
      });
    }
    throw new EasyLiveChatError(EasyLiveChatErrorCode.NO_TOKEN, {
      message: 'No conversation to email — call open()/startSession() first.',
    });
  }

  /**
   * The address on the visitor's contact — masked (`a•••@example.com`), or
   * null when there is none — and what the workspace offers: the state the
   * two email offers are decided from. "Get the reply by email" is only worth
   * asking someone with no address on file.
   *
   * Rejects with `NO_TOKEN` before there is a conversation.
   */
  async visitorEmail(): Promise<VisitorEmailState> {
    if (this.token != null) {
      return this.guardAuth(() => this.rest.getVisitorEmail({ token: this.token ?? '' }));
    }
    const ended = this.endedSession;
    if (ended != null) return this.rest.getVisitorEmail({ token: ended.token });
    throw new EasyLiveChatError(EasyLiveChatErrorCode.NO_TOKEN, {
      message: "The visitor's email needs a conversation — call open()/startSession() first.",
    });
  }

  /**
   * "Get the reply by email": keep `email` on the visitor's contact, so a
   * reply that comes after they have left still reaches them. Offer it while
   * {@link replyEmailEnabled} is true, to a visitor whose contact has no
   * address ({@link visitorEmail}).
   *
   * Resolves with the address as the contact now holds it, masked — which is
   * the one already on file when the visitor is identity-verified with a
   * different one; the server does not replace a verified address from the
   * device. Rejects with `INVALID_EMAIL` (a blank one is refused here, before
   * the network), `EMAIL_UNSUBSCRIBED`, or `NO_TOKEN` before there is a
   * conversation.
   */
  async setVisitorEmail(email: string): Promise<VisitorEmailResult> {
    const address = email.trim();
    if (address.length === 0) {
      throw new EasyLiveChatError(EasyLiveChatErrorCode.INVALID_EMAIL, {
        message: 'An email address is required.',
      });
    }
    if (this.token != null) {
      return this.guardAuth(() =>
        this.rest.postVisitorEmail({ token: this.token ?? '', email: address }),
      );
    }
    const ended = this.endedSession;
    if (ended != null) return this.rest.postVisitorEmail({ token: ended.token, email: address });
    throw new EasyLiveChatError(EasyLiveChatErrorCode.NO_TOKEN, {
      message: "Saving the visitor's email needs a conversation — call open()/startSession() first.",
    });
  }

  // ── attachments ─────────────────────────────────────────────────────────

  /** Upload via the current widget JWT; returns the first array element. */
  async uploadBytes(args: {
    data: UploadSource;
    filename: string;
    contentType?: string;
    onProgress?: (progress: number) => void;
  }): Promise<UploadedFile> {
    const token = this.token;
    if (token == null) {
      throw new EasyLiveChatError(EasyLiveChatErrorCode.NO_TOKEN, {
        message: 'Upload requires an active session token.',
      });
    }
    return this.guardAuth(() => this.rest.uploadBytes({ token, ...args }));
  }

  /**
   * Join a server-relative `/uploads/*` onto the API base.
   *
   * Absolute URLs pass through unchanged; non-resolvable placeholders (e.g.
   * `wa:media:{id}`) also pass through, so the UI can render an inert chip.
   */
  resolveUrl(relativeOrAbsolute: string): string {
    const s = relativeOrAbsolute.trim();
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    if (s.startsWith('/')) return `${this.config.normalizedApiBase}${s}`;
    return s;
  }

  // ── offline + CSAT + survey ─────────────────────────────────────────────

  /**
   * `POST /offline-form` — a terminal "we'll get back to you" flow.
   *
   * Creates an UNRESUMABLE conversation (random externalId, no token). Never
   * connect a socket after it.
   *
   * `consents` are the consent fields the visitor ticked on the form shown
   * beside it. Passing them (even `[]`) declares the `consent` capability, so
   * the server holds the submission to the required ones — checked here
   * first, `CONSENT_REQUIRED` + `fieldId`. They are sent only when the config
   * was fetched with {@link supportsConsent}, since otherwise no consent field
   * can have been on screen. Unset sends nothing about consent.
   */
  async submitOfflineForm(args: {
    name?: string;
    email?: string;
    message: string;
    consents?: readonly string[];
  }): Promise<string> {
    const consents =
      args.consents != null && this.configHasConsent ? [...args.consents] : undefined;
    const cfg = this.widgetConfig.get();
    if (consents != null && cfg != null) {
      const check = validateConsents(cfg.preChatForm, consents);
      if (!check.ok) {
        throw new EasyLiveChatError(check.error, { fieldId: check.fieldId });
      }
    }
    return this.rest.postOfflineForm({
      name: args.name ?? this.profile?.name,
      email: args.email ?? this.profile?.email,
      message: args.message,
      consents,
    });
  }

  /**
   * `POST /conversations/:id/feedback` — one-shot CSAT on the current
   * conversation; marks it rated so the prompt never re-fires.
   */
  async submitFeedback(args: { rating: number; comment?: string }): Promise<FeedbackResult> {
    const token = this.token;
    const convId = this.conversationIdValue;
    if (token == null || convId == null) {
      throw new EasyLiveChatError(EasyLiveChatErrorCode.NO_TOKEN, {
        message: 'Feedback requires an active session token.',
      });
    }
    try {
      const res = await this.guardAuth(() =>
        this.rest.postFeedback({
          token,
          conversationId: convId,
          rating: args.rating,
          comment: args.comment,
        }),
      );
      this.ratedConversations.add(convId);
      return res;
    } catch (e) {
      // Already rated — a finished state, not a failure. Mark it so the prompt
      // will not reappear, then rethrow for the caller to treat as done.
      if (e instanceof EasyLiveChatError && e.code === EasyLiveChatErrorCode.ALREADY_RATED) {
        this.ratedConversations.add(convId);
      }
      throw e;
    }
  }

  /**
   * Submit the tenant's post-chat survey for the conversation just closed.
   *
   * `fields` is keyed by field **id** — what `postChatForm` declares and what
   * the dashboard reads back. Validation is client-side for UX only; the
   * server re-checks.
   *
   * Like {@link submitFeedback}, a 409 means someone already answered, which
   * is a finished state rather than a failure — swallowed so the survey does
   * not reappear on the next close event.
   */
  async submitPostChat(fields: Record<string, string>): Promise<void> {
    const token = this.token;
    const convId = this.conversationIdValue;
    if (token == null || convId == null) {
      throw new EasyLiveChatError(EasyLiveChatErrorCode.NO_TOKEN, {
        message: 'The post-chat survey requires an active session token.',
      });
    }
    try {
      await this.guardAuth(() =>
        this.rest.postChat({
          token,
          conversationId: convId,
          fields,
          locale: this.config.contentLocale ?? this.config.locale,
        }),
      );
      this.ratedConversations.add(convId);
      this.finishEndedSession();
    } catch (e) {
      if (e instanceof EasyLiveChatError && e.code === EasyLiveChatErrorCode.ALREADY_SUBMITTED) {
        this.ratedConversations.add(convId);
        this.finishEndedSession();
        return;
      }
      throw e;
    }
  }

  /**
   * The conversation is over and its post-chat step is done — let go of it.
   *
   * Holding the socket open kept the visitor attached to a closed
   * conversation: their next message re-opened it server-side instead of
   * starting the fresh chat they were looking at. The thread came back from
   * the dead, already rated, and could then never be closed again — its
   * post-chat step was spent.
   */
  private finishEndedSession(): void {
    // Kept for "Email me this chat" on the screen after the chat: the server
    // sends the transcript of the conversation its token was minted for, and
    // nothing else reaches that conversation once the session is let go of.
    if (this.token != null && this.conversationIdValue != null) {
      this.endedSession = { conversationId: this.conversationIdValue, token: this.token };
    }
    this.teardownSocket();
    this.socketConversationId = null;
    this.conversationIdValue = null;
    this.token = null;
    // Belongs to the conversation being let go of, and only moves forward —
    // left set, it would rule the next one's opening messages already read.
    this.agentLastReadAt.set(null);
    this.queue.set(null);
  }

  /**
   * Forget who this visitor is — everything that survives a cold start.
   *
   * {@link endChat} clears the session but deliberately keeps the `visitorId`,
   * because the same person coming back belongs in the thread they already
   * have. Signing OUT is the opposite: the next person to open the chat may be
   * someone else entirely, and on a shared device — a restaurant tablet, a POS
   * terminal — they must not inherit the last one's identity.
   *
   * The contact is keyed on the stored `visitorId`, and the server keeps a
   * name it already holds when a client sends none (an anonymous resume knows
   * only the id, and must not wipe a real customer's name). So a signed-out
   * visitor was still greeted by the name from their last signed-in session,
   * and their chat continued inside the previous person's contact.
   *
   * The transcript is NOT deleted — this abandons the identity, not the
   * history.
   */
  async resetVisitor(): Promise<void> {
    this.endedSession = null;
    for (const key of StorageKeys.identity) {
      await this.storage.delete(key);
    }
  }

  // ── resume from an emailed link ─────────────────────────────────────────

  /**
   * Follow a "Reply in the chat" link from one of the workspace's emails to
   * the visitor: trade its token for the visitor id that reaches that
   * conversation (`POST /resume-link`, as the web widget does), become that
   * visitor, and resume — so the chat on screen is the one the email was
   * about, on whichever device it was opened.
   *
   * `link` is the URL the host's deep-link handler received — the email's
   * `…#elc_chat=<token>`, our chat page's `…#resume=<token>` — or the bare
   * token. Resolves true once that chat is the open session; false, without
   * throwing and without touching anything, for a link that is not ours, a
   * token the server refuses (expired, another workspace's, a chat that is
   * gone), no network, or a signed-in person's link to someone else's chat.
   *
   * **Who may follow it.** The token names a conversation, not a person, and
   * whoever holds the emailed link gets what the email showed — so an
   * anonymous visitor becomes the link's visitor, exactly as the web widget
   * adopts it: the cached profile goes with the old id, an identity the host
   * declared without a `userId` stays. A visitor identified with a `userId`
   * follows a link only to the chat this device's visitor already has. Any
   * other would be resumed under their verified identity, which the server
   * then writes onto that conversation's contact: a different signed-in
   * person would take over someone else's chat.
   */
  async resumeFromLink(link: string): Promise<boolean> {
    const token = resumeLinkToken(link);
    if (token == null || this.disposed) return false;
    try {
      // Line the stored visitor up with whoever is (or is not) signed in now:
      // the rule below reads the outcome.
      await this.settleIdentity();
      const epoch = this.identityEpoch;
      const { visitorId } = await this.rest.postResumeLink(token);
      if (this.disposed || epoch !== this.identityEpoch) return false;

      if (visitorId !== this.visitorIdValue) {
        if (this.claimUserId != null || this.storedUserId != null) return false;
        this.adoptLinkedVisitor(visitorId);
      } else if (this.phase.get() === 'chat' && this.token != null) {
        // Already in this visitor's chat.
        return true;
      }

      // The ordinary open, which resumes the conversation behind the visitor
      // id — joining an open already running for this visitor (a chat screen
      // mounting as the link arrives) rather than racing it.
      await this.open();
      return !this.disposed && this.phase.get() === 'chat' && this.token != null;
    } catch {
      // Refused, or no network: the chat stays as it was.
      return false;
    }
  }

  /**
   * Become the visitor an emailed link names. Everything the previous one had
   * in memory goes, as on a person switch; the stored id is replaced and the
   * cached profile dropped with it (the web widget's `adoptVisitorId`). The
   * identified user id is left alone — {@link resumeFromLink} only adopts on a
   * device where nobody is signed in.
   */
  private adoptLinkedVisitor(visitorId: string): void {
    const wasOpen = this.dropVisitorSession();
    this.visitorIdValue = visitorId;
    // The server just said there is a conversation behind this id.
    this.freshVisitor = false;
    // A cached profile is the previous visitor's. An identity the host declared
    // is who is using the app now, and stays.
    if (!this.hasIdentity) {
      this.profile = null;
      this.phone = undefined;
    }
    this.enqueueStorage(async () => {
      await this.storage.delete(StorageKeys.token);
      await this.storage.delete(StorageKeys.conversationId);
      await this.storage.delete(StorageKeys.profile);
      await this.storage.write(StorageKeys.visitorId, visitorId);
    });
    if (wasOpen) this.setPhase('idle');
  }

  // ── help articles ───────────────────────────────────────────────────────

  /**
   * One random id per controller (per `boot()`), sent with article views and
   * "was this helpful?" answers. The server counts a view once per
   * `(article, visitor, session)`, and an answer given twice in one session
   * changes the first rather than adding a second.
   */
  get helpSessionId(): string {
    this.helpSessionIdValue ??= uuidV4();
    return this.helpSessionIdValue;
  }

  /**
   * `GET /help/articles`. A query of two or more characters is a ranked
   * search (default 5 results, at most 20); a shorter one — or none — lists
   * the top articles in the workspace's order (default 20, at most 50).
   * Articles come back in the config's `contentLocale` when the workspace
   * wrote them in it.
   */
  searchHelp(
    q: string,
    options: { category?: string; limit?: number } = {},
  ): Promise<HelpArticleList> {
    return this.rest.getHelpArticles({ q, category: options.category, limit: options.limit });
  }

  /**
   * `GET /help/articles/:id`, then record that the visitor read it —
   * fire-and-forget: a count that fails must never cost them the article.
   */
  async getHelpArticle(id: string): Promise<HelpArticle> {
    const article = await this.rest.getHelpArticle(id);
    void this.recordHelpView(article.id.length > 0 ? article.id : id);
    return article;
  }

  /** "Was this helpful?" for an article. Rejects with a typed error on failure. */
  async rateHelpArticle(id: string, helpful: boolean): Promise<void> {
    // Never under a visitor id that an identity switch is forgetting.
    await this.identityChain;
    await this.rest.postHelpFeedback(id, {
      visitorId: this.visitorId,
      sessionId: this.helpSessionId,
      helpful,
    });
  }

  private async recordHelpView(id: string): Promise<void> {
    try {
      await this.identityChain;
      const visitorId = this.visitorIdValue;
      if (visitorId == null || this.disposed) return;
      await this.rest.postHelpView(id, { visitorId, sessionId: this.helpSessionId });
    } catch {
      // Analytics only.
    }
  }

  // ── presence / lifecycle ────────────────────────────────────────────────

  /**
   * Foreground/background. `resumed` ⇒ heartbeat + presence on; `paused` ⇒ off
   * (the chat socket has its own auto-reconnect and is left to the transport).
   */
  setAppLifecycle(state: AppLifecycle): void {
    if (this.lifecycle === state) return;
    this.lifecycle = state;
    if (state === 'resumed') {
      this.startHeartbeat();
      if (this.config.enablePresenceSocket && this.socket == null) this.connectPresence();
    } else {
      this.stopHeartbeat();
      this.teardownPresence();
    }
  }

  /**
   * Fire-and-forget `POST /visitor/heartbeat`. Only meaningful while
   * foregrounded; the periodic timer calls this directly.
   */
  heartbeat(args: { currentUrl?: string; currentTitle?: string } = {}): void {
    if (!this.config.enableHeartbeat) return;
    // heartbeat() is public and can be reached (e.g. via setAppLifecycle)
    // before boot() finishes, when there is no visitorId yet.
    if (this.visitorIdValue == null) return;
    // …or before a signed-in visitor on record has been lined up with whoever
    // is using the app now, when the id may be one about to be forgotten.
    if (this.identityPending) return;
    void this.rest
      .heartbeat({
        visitorId: this.visitorIdValue,
        currentUrl: args.currentUrl,
        currentTitle: args.currentTitle,
        language: this.effectiveLocale,
      })
      .catch(() => {
        // Tolerant endpoint; a presence ping must never affect UX.
      });
  }

  // ── socket wiring ───────────────────────────────────────────────────────

  private connectSocket(): void {
    const token = this.token;
    if (token == null) return;

    if (this.socket != null) {
      // Already wired — re-supply the token (e.g. after a re-mint).
      this.socket.updateToken(token);
      // …but a token for a DIFFERENT conversation needs a NEW HANDSHAKE, not
      // just a stored value. The server reads `conversationId` off the token
      // once, when the socket connects, and routes everything sent on that
      // socket there forever. `updateToken` only affects the next connect, so
      // a visitor who ended one chat and started another kept sending into the
      // old, closed conversation — and ending "this" chat closed the old one,
      // whose id no longer matched, so the close echo was ignored and the exit
      // confirmation appeared to do nothing.
      if (this.socketConversationId !== this.conversationIdValue) {
        this.socketConversationId = this.conversationIdValue;
        this.socket.reconnectWithFreshAuth();
      }
      return;
    }

    this.socketConversationId = this.conversationIdValue;
    const socket = new WidgetSocket(this.config.normalizedApiBase, token, {
      onMessageNew: (m) => this.handleMessageNew(m),
      onMessageUpdated: (m) => this.handleMessageUpdated(m),
      onMessageDeleted: (d) => this.forgetUnsent([d.id], d.conversationId),
      onMessageReactions: (u) => this.handleReactions(u),
      onQueueUpdate: (u) => this.handleQueueUpdate(u),
      onConversationAssigned: () => this.leaveQueue(),
      onAgentTyping: (t) => this.handleAgentTyping(t),
      onAssistantTyping: (t) => this.handleAssistantTyping(t),
      onWorkspaceAvailability: (a) => this.applyWorkspaceAvailability(a),
      onMessagesRead: (at) => this.advanceReadWatermark(at),
      onConversationClosed: (id) => this.handleConversationClosed(id),
      onProactive: (p) => this.handleProactive(p),
      onConnectionChange: (c) => this.handleConnectionChange(c),
      onConnectError: (e) => this.handleConnectError(e),
    });
    this.socket = socket;
    this.connection.set('connecting');
    socket.connect();
  }

  private teardownSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.hasConnectedOnce = false;
    socket?.dispose();
  }

  private connectPresence(): void {
    if (this.presence != null) return;
    if (this.visitorIdValue == null) return;
    if (this.identityPending) return;
    const p = new PresenceSocket(
      this.config.normalizedApiBase,
      this.config.tenantSlug,
      this.visitorIdValue,
      {
        onProactive: (m) => this.handleProactive(m),
        onConnectError: () => {
          // Non-fatal: presence is receive-only outreach. Swallowed rather
          // than surfaced so a bad handshake here cannot show the visitor an
          // error about a channel they never asked for.
        },
      },
    );
    this.presence = p;
    p.connect();
  }

  private teardownPresence(): void {
    const p = this.presence;
    this.presence = null;
    p?.dispose();
  }

  // ── inbound handlers ────────────────────────────────────────────────────

  /**
   * The widget protocol does NOT echo a `clientId`, so reconciling our own
   * send is a three-step match. Read the numbered steps below twice.
   */
  private handleMessageNew(msg: ChatMessage): void {
    if (this.unsentIds.has(msg.id)) return;

    // The assistant's reply is its own "done typing": clear the indicator now
    // rather than waiting on a stop event that may have been lost.
    if (isFromAssistant(msg) && this.assistantTyping.get()) {
      this.clearTypingTimer();
      this.agentTyping.set(false);
      this.assistantTyping.set(false);
    }

    const list = this.messages.get();

    // 1) Dedup by id. Already have it (e.g. our own echo, already reconciled)
    //    — refresh the row, keeping the sender's face if the refresh arrived
    //    without one.
    const existingIdx = list.findIndex((m) => m.id === msg.id);
    if (existingIdx !== -1) {
      const previous = list[existingIdx] as ChatMessage;
      const next = [...list];
      next[existingIdx] = withReactionsFrom(withIdentityFrom(msg, previous), previous);
      this.setMessages(dedupSort(next));
      return;
    }

    // 2) Reconcile a still-unreconciled local send. Match the OLDEST row that
    //    still carries a `tmp-` id with the same TRIMMED body — the list is
    //    createdAt-sorted, so a first-match search is FIFO. Replacing it
    //    consumes it: its id becomes the server id, so a second identical echo
    //    matches the NEXT pending temp, not this one.
    //
    //    Keyed on the `tmp-` id rather than on `isOptimistic`, because an
    //    ack'd-but-id-less send has `isOptimistic` cleared while keeping its
    //    temp id, and its echo must replace it rather than append a duplicate.
    if (isFromCustomer(msg)) {
      const body = (msg.body ?? '').trim();
      const optIdx = list.findIndex(
        (m) => isLocalTemp(m) && isFromCustomer(m) && (m.body ?? '').trim() === body,
      );
      if (optIdx !== -1) {
        const next = [...list];
        next[optIdx] = msg;
        this.setMessages(dedupSort(next));
        return;
      }
    }

    // 3) Genuinely new. Unread counts only AGENT replies the visitor has not
    //    seen — never our own echoes, system/bot rows, or anything once the
    //    conversation has moved to the chat/feedback phase.
    this.appendMessage(msg);
    // Someone from the team (or the assistant) said something: whoever was
    // waiting in the queue is not any more.
    if (!isFromCustomer(msg) && msg.senderType !== 'system') this.leaveQueue();
    const p = this.phase.get();
    if (isFromAgent(msg) && p !== 'chat' && p !== 'feedback') {
      this.unreadIds.add(msg.id);
      this.unreadCount.set(this.unreadCount.get() + 1);
    }
    this.messageEmitter.emit(msg);
  }

  /**
   * `message:updated`: the whole message again — an agent editing their reply
   * (new `body`, `editedAt` set), a media re-host, a delivery receipt.
   * Replaced by id, in place.
   */
  private handleMessageUpdated(msg: ChatMessage): void {
    if (this.unsentIds.has(msg.id)) return;
    const list = this.messages.get();
    const idx = list.findIndex((m) => m.id === msg.id);
    if (idx === -1) {
      // Unknown id — treat as a new arrival (still deduped/sorted).
      this.appendMessage(msg);
      return;
    }
    // A media re-host or a delivery receipt patches the row and re-broadcasts
    // it; on older servers that copy carries no sender name or photo.
    // Replacing wholesale erased the agent's face from a bubble that already
    // had one — see `withIdentityFrom`.
    // Likewise a row from a server older than reactions, or a partial one,
    // carries no `reactions` and must not clear the chips — `withReactionsFrom`.
    const previous = list[idx] as ChatMessage;
    const next = [...list];
    next[idx] = withReactionsFrom(withIdentityFrom(msg, previous), previous);
    this.setMessages(dedupSort(next));
  }

  /**
   * Take down messages an agent unsent, and remember them.
   *
   * One path for the live `message:deleted` and for the `unsentIds` every
   * history response carries (session open or restore, paging, the reconnect
   * backfill) — the second is how a visitor who was away when an agent took a
   * reply back stops seeing it. Each id leaves the thread with no placeholder,
   * comes off the unread badge if it was counted there, and is announced on
   * {@link onMessageDeleted} once — the first time this controller hears of it.
   */
  private forgetUnsent(ids: readonly string[], conversationId?: string): void {
    const fresh = ids.filter((id) => id.length > 0 && !this.unsentIds.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) this.unsentIds.add(id);
    const list = this.messages.get();
    if (list.some((m) => this.unsentIds.has(m.id))) {
      this.setMessages(list.filter((m) => !this.unsentIds.has(m.id)));
    }
    const convId = conversationId != null && conversationId.length > 0
      ? conversationId
      : (this.conversationIdValue ?? '');
    for (const id of fresh) {
      if (this.unreadIds.delete(id) && this.unreadCount.get() > 0) {
        this.unreadCount.set(this.unreadCount.get() - 1);
      }
      this.deletedEmitter.emit({ id, conversationId: convId });
    }
  }

  private clearTypingTimer(): void {
    if (this.typingTimer != null) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
  }

  private handleAgentTyping(isTyping: boolean): void {
    this.clearTypingTimer();
    // A person typing is never the assistant, whatever was showing before.
    this.assistantTyping.set(false);
    if (!isTyping) {
      this.agentTyping.set(false);
      return;
    }
    this.agentTyping.set(true);
    // Someone is answering: the wait is over even before their first word.
    this.leaveQueue();
    // The server does relay a real `false`, but the timeout stays as a
    // backstop for a dropped stop event.
    this.typingTimer = setTimeout(() => {
      this.agentTyping.set(false);
      this.typingTimer = null;
    }, TYPING_AUTO_CLEAR_MS);
  }

  /**
   * The assistant started or finished composing a reply.
   *
   * It sends an explicit stop when the reply is ready, and a reply can take
   * ten seconds or more, so the 4-second clear used for a person would drop
   * the indicator halfway and leave the visitor watching a silent thread. The
   * backstop is long instead — only for a stop lost to a dropped connection.
   * Its reply arriving also clears it (see {@link handleMessageNew}).
   */
  private handleAssistantTyping(isTyping: boolean): void {
    this.clearTypingTimer();
    // The label flag first, so a row built from the typing change reads it.
    this.assistantTyping.set(isTyping);
    this.agentTyping.set(isTyping);
    if (!isTyping) return;
    this.leaveQueue();
    this.typingTimer = setTimeout(() => {
      this.agentTyping.set(false);
      this.assistantTyping.set(false);
      this.typingTimer = null;
    }, ASSISTANT_TYPING_BACKSTOP_MS);
  }

  private handleConversationClosed(closedConversationId: string): void {
    // GUARD: the server emits on ANY `*→CLOSED` PATCH; only move to the
    // post-chat step once per conversation, and never if already rated.
    if (this.conversationIdValue != null && closedConversationId !== this.conversationIdValue) {
      return;
    }
    if (this.closedHandled.has(closedConversationId)) return;
    if (this.ratedConversations.has(closedConversationId)) return;
    this.closedHandled.add(closedConversationId);
    this.setPhase('feedback');
  }

  private handleProactive(msg: ProactiveMessage): void {
    this.proactiveEmitter.emit(msg);
    // Upgrade presence → full session so the visitor can reply.
    if (this.socket == null) void this.silentResume();
  }

  private handleConnectionChange(connected: boolean): void {
    if (connected) {
      const isReconnect = this.hasConnectedOnce;
      this.hasConnectedOnce = true;
      this.connection.set('connected');
      if (isReconnect) {
        // Live-only delivery: backfill anything missed while we were down. The
        // FIRST connect is skipped — the session payload already seeded the
        // newest page.
        void this.backfillAfterReconnect();
      }
      return;
    }
    // A drop while we still hold a token ⇒ the transport is reconnecting.
    this.connection.set(this.token != null ? 'reconnecting' : 'disconnected');
  }

  private handleConnectError(error: string): void {
    this.connection.set(this.token != null ? 'reconnecting' : 'disconnected');
    if (isAuthHandshakeError(error)) {
      void this.remintToken();
    } else {
      this.emitError(new EasyLiveChatError(EasyLiveChatErrorCode.SOCKET, { message: error }));
    }
  }

  // ── token re-mint (single-flight) + reconnect backfill ──────────────────

  /**
   * Run `op`; if it fails with an auth error (401/403) or the token is about
   * to expire, re-mint once (single-flight) and retry. The protocol has no
   * refresh route, so re-mint means `POST /session { resumeOnly: true }`.
   */
  private async guardAuth<T>(op: () => Promise<T>): Promise<T> {
    // Pre-emptive re-mint when the current token is within the refresh leeway.
    if (this.token != null && isTokenExpiring(this.token, this.config.tokenRefreshLeewayMs)) {
      await this.remintToken();
    }
    try {
      return await op();
    } catch (e) {
      if (e instanceof EasyLiveChatError && e.isAuthError) {
        const reminted = await this.remintToken();
        if (reminted) return op();
      }
      throw e;
    }
  }

  /**
   * Single-flight re-mint.
   *
   * Returns true when a fresh token was obtained and the socket reconnected;
   * false when the conversation is gone (CLOSED) and we dropped back to
   * pre-chat/anonymous.
   */
  private remintToken(): Promise<boolean> {
    const inflight = this.remintInFlight;
    if (inflight != null) return inflight;
    const p = this.remintImpl().finally(() => {
      this.remintInFlight = null;
    });
    this.remintInFlight = p;
    return p;
  }

  private async remintImpl(): Promise<boolean> {
    const epoch = this.identityEpoch;
    try {
      const res = await this.rest.postSession({
        visitorId: this.visitorId,
        userId: this.claimUserId,
        userHash: this.claimUserHash,
        name: this.profile?.name,
        email: this.profile?.email,
        phone: this.phone ?? this.profile?.phone,
        locale: this.effectiveLocale,
        resumeOnly: true,
      });

      if (epoch !== this.identityEpoch) return false;

      if (res.hasActiveConversation && res.token != null) {
        this.token = res.token;
        this.conversationIdValue = res.conversationId ?? this.conversationIdValue;
        await this.storage.write(StorageKeys.token, res.token);
        // Apply the fresh token. A LIVE socket will not re-read its handshake
        // auth on a no-op connect(), so force a fresh handshake — its
        // reconnect (with hasConnectedOnce already true) then owns the gap
        // backfill. A cold socket connects for the FIRST time, which is not
        // treated as a reconnect, so backfill inline only in that case.
        const socket = this.socket;
        if (socket != null) {
          socket.updateToken(res.token);
          socket.reconnectWithFreshAuth();
        } else {
          this.connectSocket();
          await this.backfillAfterReconnect();
        }
        return true;
      }

      // Conversation CLOSED — DO NOT LOOP. Drop to pre-chat / anonymous.
      this.token = null;
      await this.storage.delete(StorageKeys.token);
      this.teardownSocket();
      this.connection.set('disconnected');
      this.setPhase(this.idlePhase());
      return false;
    } catch (e) {
      if (epoch === this.identityEpoch) this.emitError(e);
      return false;
    }
  }

  /**
   * Reconnect backfill.
   *
   * The server delivers `message:new` LIVE-ONLY, so on every reconnect we page
   * `GET /messages` from the newest end and WALK the cursor backward until a
   * page overlaps ids we already hold (gap-safe beyond a single 50-message
   * page). Merge by id, sort by createdAt.
   */
  private async backfillAfterReconnect(): Promise<void> {
    const token = this.token;
    if (token == null) return;

    const known = new Set(
      this.messages
        .get()
        .filter((m) => !m.isOptimistic)
        .map((m) => m.id),
    );

    const fetched: ChatMessage[] = [];
    const unsent: string[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < MAX_BACKFILL_PAGES; pages++) {
      let page: MessagePage;
      try {
        page = await this.rest.getMessages({ token, cursor, limit: 50 });
      } catch {
        // Stop walking on ANY failure (auth included). We may be inside an
        // in-flight re-mint here, so do NOT recurse into remintToken — it
        // would deadlock on its own promise. The connect-error handler or the
        // next guardAuth call re-mints and re-backfills cleanly.
        break;
      }
      unsent.push(...page.unsentIds);
      if (page.messages.length === 0) break;
      fetched.push(...page.messages);

      // Overlap check: any already-known id in this page means the gap is
      // closed.
      const overlaps = page.messages.some((m) => known.has(m.id));
      cursor = page.nextCursor;
      if (overlaps || cursor == null) break;
    }

    // Anything an agent unsent while we were away goes, whether or not a page
    // brought anything new.
    this.forgetUnsent(unsent);
    if (fetched.length > 0) this.mergeMessages(fetched);
  }

  // ── heartbeat ───────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    if (!this.config.enableHeartbeat) return;
    if (this.lifecycle !== 'resumed') return;
    if (this.heartbeatTimer != null) return;
    // Fire one immediately, then on the configured cadence.
    this.heartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.lifecycle === 'resumed') this.heartbeat();
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── message-list helpers (always assign a NEW immutable array) ──────────

  private setMessages(next: ChatMessage[]): void {
    // A new array on every mutation, frozen in dev. `useSyncExternalStore`
    // compares by reference, so an in-place push renders nothing — and a
    // frozen list makes that mistake throw here instead of silently
    // disappearing at the UI.
    const list = (IS_DEV ? Object.freeze(next) : next) as readonly ChatMessage[];
    this.messages.set(list);
    this.noteSessionBoundary(list);
    this.seedReadWatermark(list);
  }

  private appendMessage(msg: ChatMessage): void {
    this.setMessages(dedupSort([...this.messages.get(), msg]));
  }

  /**
   * Fold a fetched page into the thread.
   *
   * Deduplicating by id alone is not enough for the visitor's OWN messages.
   * `message:new` is live-only, so a send whose echo arrived while the socket
   * was down is recovered here, from REST, as a brand-new row — and the
   * optimistic `tmp-` row it belongs to is invisible to an id comparison,
   * because it does not have the server's id yet. The thread then shows the
   * message twice and one copy sits on the clock for ever: the agent has it,
   * the visitor is told it never sent.
   *
   * Nothing else clears it. The 20s ack timer is a JS `setTimeout`, which does
   * not run while the app is suspended — which is exactly when a socket drops
   * — and when it does fire it turns the duplicate into a FAILED bubble with a
   * retry link rather than a sent one.
   *
   * So a server row for one of our own sends consumes the pending row instead
   * of sitting beside it, by the same rule `handleMessageNew` uses for a live
   * echo: first pending `tmp-` row from the visitor with the same trimmed
   * body. Consuming it keeps the FIFO property — a second identical send
   * matches the NEXT pending row, not this one again.
   *
   * `backfillAfterReconnect` deliberately leaves optimistic rows out of the
   * overlap set it walks (they have no server id to compare), so this is the
   * only place they can be reconciled.
   */
  private mergeMessages(incoming: readonly ChatMessage[]): void {
    const list = [...this.messages.get()];

    for (const msg of incoming) {
      // A page fetched just before an agent unsent one of its rows.
      if (this.unsentIds.has(msg.id)) continue;
      if (isFromCustomer(msg) && !list.some((m) => m.id === msg.id)) {
        const body = (msg.body ?? '').trim();
        const optIdx = list.findIndex(
          (m) => isLocalTemp(m) && isFromCustomer(m) && (m.body ?? '').trim() === body,
        );
        if (optIdx !== -1) {
          list[optIdx] = msg;
          continue;
        }
      }
      list.push(msg);
    }

    this.setMessages(dedupSort(list));
  }

  /** Move the read watermark FORWARD, never back. See {@link agentLastReadAt}. */
  private advanceReadWatermark(at: Date): void {
    if (this.disposed) return;
    const current = this.agentLastReadAt.get();
    if (current == null || at.getTime() > current.getTime()) this.agentLastReadAt.set(at);
  }

  /**
   * Recover the watermark from history's per-message read flags.
   *
   * `messages:read` only fires while the visitor is connected to hear it. A
   * visitor who closes the app, has their messages read, and comes back gets
   * no event — the read happened in their absence. Their history still carries
   * `read` per message, so the newest read customer message dates the
   * watermark and the ticks are correct on the first frame instead of
   * resolving only after the next agent action.
   */
  private seedReadWatermark(next: readonly ChatMessage[]): void {
    let newest: Date | null = null;
    for (const m of next) {
      if (!isFromCustomer(m) || !m.readByAgent) continue;
      if (newest == null || m.createdAt.getTime() > newest.getTime()) newest = m.createdAt;
    }
    if (newest != null) this.advanceReadWatermark(newest);
  }

  /**
   * Forget that this conversation was rated once a NEW VISIT opens inside it.
   *
   * `ratedConversations` and `closedHandled` are keyed by conversation id, and
   * a returning customer lands back in the thread they already have — so the
   * id stopped being one-per-visit. Rating a chat once then suppressed the
   * survey for the life of the thread: the visitor ended their second chat and
   * it simply closed, having never been asked, and `endChat()` returned false
   * so the host UI dismissed its confirmation and did nothing visible.
   *
   * What matters is the marker's IDENTITY, never its presence. The same marker
   * arrives again on every resume, backfill and reconnect; only a marker we
   * have not already accounted for means a visit has begun.
   */
  private noteSessionBoundary(next: readonly ChatMessage[]): void {
    const id = this.conversationIdValue;
    if (id == null) return;
    const newest = newestSessionStartMarker(next);
    if (newest == null || newest.id === this.sessionMarkerId) return;
    this.sessionMarkerId = newest.id;
    this.closedHandled.delete(id);
    this.ratedConversations.delete(id);
  }

  /**
   * Replace the optimistic `tmp-` row with the server row. If a server row of
   * the same id already arrived (via `message:new`), just drop the temp.
   */
  private reconcileOptimistic(tempId: string, serverId: string): void {
    const list = this.messages.get();
    const tmpIdx = list.findIndex((m) => m.id === tempId);
    if (tmpIdx === -1) return; // Already reconciled by the echo.

    if (list.some((m) => m.id === serverId)) {
      // The live echo beat the ack — drop the optimistic temp.
      const next = [...list];
      next.splice(tmpIdx, 1);
      this.setMessages(dedupSort(next));
      return;
    }

    const next = [...list];
    next[tmpIdx] = {
      ...(list[tmpIdx] as ChatMessage),
      id: serverId,
      isOptimistic: false,
      failed: false,
      deliveryStatus: 'sent',
    };
    this.setMessages(dedupSort(next));
  }

  private markSent(tempId: string): void {
    const list = this.messages.get();
    const idx = list.findIndex((m) => m.id === tempId);
    if (idx === -1) return;
    const next = [...list];
    next[idx] = {
      ...(list[idx] as ChatMessage),
      isOptimistic: false,
      failed: false,
      deliveryStatus: 'sent',
    };
    this.setMessages(next);
  }

  private failOptimistic(tempId: string): void {
    const list = this.messages.get();
    const idx = list.findIndex((m) => m.id === tempId);
    if (idx === -1) return;
    const next = [...list];
    next[idx] = { ...(list[idx] as ChatMessage), failed: true, deliveryStatus: 'failed' };
    this.setMessages(next);
  }

  private removeMessage(id: string): void {
    const list = this.messages.get();
    const idx = list.findIndex((m) => m.id === id);
    if (idx === -1) return;
    const next = [...list];
    next.splice(idx, 1);
    this.setMessages(next);
  }

  // ── availability ────────────────────────────────────────────────────────

  /** Adopt a server availability verdict, from the socket or a config fetch. */
  private applyWorkspaceAvailability(a: WorkspaceAvailability): void {
    this.isOpen.set(a.isOpen);
    this.agentsAccepting.set(a.agentsAccepting);
    this.visitorMode.set(a.visitorMode);
    this.availabilityReason.set(a.reason);
    this.nextOpenAt.set(a.nextOpenAt);
    this.closureLabel.set(a.closureLabel ?? null);
    this.nextOpenLocal.set(a.nextOpenLocal ?? null);
    this.workspaceTimezone.set(a.timezone ?? null);
    this.assistantCovers.set(a.assistantCovers);
    // Same rule as refreshAvailability(): a visitor with a conversation keeps
    // it (minus the composer); one without gets the notice. Closing time shows
    // a notice — it never moves a visitor mid-conversation.
    const p = this.phase.get();
    if (
      this.composerLocked &&
      this.conversationIdValue == null &&
      p !== 'offline' &&
      p !== 'feedback'
    ) {
      this.setPhase('offline');
    }
  }

  // ── misc helpers ────────────────────────────────────────────────────────

  private setPhase(next: ChatPhase): void {
    if (this.disposed) return;
    this.phase.set(next);
  }

  private get effectiveLocale(): string | undefined {
    return this.config.locale;
  }

  private async persistProfile(profile: StoredProfile): Promise<void> {
    this.profile = profile;
    await this.storage.write(StorageKeys.profile, serializeStoredProfile(profile));
  }

  private surface(e: unknown): EasyLiveChatError {
    return toEasyLiveChatError(e);
  }

  private emitError(e: unknown): void {
    this.errorEmitter.emit(this.surface(e));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.typingTimer != null) clearTimeout(this.typingTimer);
    this.typingTimer = null;
    this.stopHeartbeat();
    this.teardownSocket();
    this.teardownPresence();
    this.messageEmitter.close();
    this.deletedEmitter.close();
    this.proactiveEmitter.close();
    this.errorEmitter.close();
  }
}

// ── module-level helpers ──────────────────────────────────────────────────

/**
 * Dedup by id (last write wins, so a server row replaces an optimistic temp
 * that shares its id only after reconcile) and sort by createdAt, ties broken
 * by id so the ordering is stable.
 */
export function dedupSort(input: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of input) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => {
    const c = a.createdAt.getTime() - b.createdAt.getTime();
    return c !== 0 ? c : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The newest "new chat" marker in `messages`, or null when there is none.
 *
 * Exported rather than private so the boundary rule can be exercised without a
 * socket. The rule reads as trivial and is not: what matters is the marker's
 * IDENTITY, never its presence.
 */
export function newestSessionStartMarker(
  messages: Iterable<ChatMessage>,
): ChatMessage | null {
  let newest: ChatMessage | null = null;
  for (const m of messages) {
    if (systemI18nKey(m) !== SESSION_START_MARKER) continue;
    if (newest == null || m.createdAt.getTime() > newest.createdAt.getTime()) newest = m;
  }
  return newest;
}

/**
 * Does this `connect_error` look like an auth/JWT handshake rejection (⇒
 * re-mint) rather than a generic transport error?
 *
 * The server sends stable-ish codes (`WIDGET_TOKEN_MISSING`) and jose verify
 * messages. Matched against specific token/JWT signals — deliberately NOT a
 * bare `TOKEN` — so a benign message that merely contains the word cannot
 * trigger a re-mint storm.
 */
export function isAuthHandshakeError(error: string): boolean {
  const e = error.toUpperCase();
  const signals = [
    'WIDGET_TOKEN',
    'TOKEN_MISSING',
    'TOKEN_EXPIRED',
    'TOKEN_INVALID',
    'INVALID_TOKEN',
    'UNAUTHORIZED',
    'UNAUTHENTICATED',
    'JWT',
    'JWS',
    'SIGNATURE',
    // jose: ERR_JWS_INVALID / ERR_JWT_EXPIRED / ERR_JWK_*
    'ERR_JW',
  ];
  return signals.some((s) => e.includes(s));
}

/** Re-exported so hosts can parse a raw socket row without reaching inside. */
export { parseChatMessage };
