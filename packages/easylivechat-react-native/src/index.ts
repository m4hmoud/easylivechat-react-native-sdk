/**
 * `@easylivechat/react-native` — the headless EasyLiveChat visitor client.
 *
 * Transport, state machine, reactive stores and React hooks. No UI, no JSX.
 * The prebuilt components live in `@easylivechat/react-native-ui`.
 *
 * ```ts
 * import { EasyLiveChat } from '@easylivechat/react-native';
 *
 * await EasyLiveChat.instance.boot({
 *   apiBase: 'https://api.livechattools.com',
 *   tenantSlug: 'acme',
 * }, { storage: myDurableStorage });
 * await EasyLiveChat.instance.open();
 * ```
 */

// ── client ────────────────────────────────────────────────────────────────
export { EasyLiveChat, easylivechat } from './client';

// ── config ────────────────────────────────────────────────────────────────
export {
  type EasyLiveChatConfig,
  type ResolvedConfig,
  CONFIG_DEFAULTS,
  normalizeApiBase,
  resolveConfig,
  validateConfig,
} from './config';

// ── errors ────────────────────────────────────────────────────────────────
export {
  type EasyLiveChatErrorCodeValue,
  type EasyLiveChatErrorOptions,
  EasyLiveChatError,
  EasyLiveChatErrorCode,
  errorForResponse,
  toEasyLiveChatError,
} from './errors';

// ── storage ───────────────────────────────────────────────────────────────
export { type EasyLiveChatStorage, InMemoryStorage, StorageKeys } from './storage';

// ── stores ────────────────────────────────────────────────────────────────
export { type ReadonlyStore, type Store, constantStore, createStore } from './store';

// ── enums ─────────────────────────────────────────────────────────────────
export {
  type AttachmentKind,
  type ChannelSource,
  type ConversationStatus,
  type LocaleDirection,
  type MessageContentType,
  type MessageDeliveryStatus,
  type MessageReceipt,
  type PostChatFieldType,
  type PreChatFieldType,
  type SenderType,
  parseAttachmentKind,
  parseChannelSource,
  parseConversationStatus,
  parseLocaleDirection,
  parseMessageContentType,
  parseMessageDeliveryStatus,
  parsePostChatFieldType,
  parsePreChatFieldType,
  parseSenderType,
} from './models/enums';

// ── models ────────────────────────────────────────────────────────────────
export {
  type ChatMessage,
  type RehostedAttachment,
  hasAttachments,
  isFromAgent,
  isFromCustomer,
  isLocalTemp,
  isResolvableUrl,
  optimisticMessage,
  parseChatMessage,
  parseChatMessages,
  parseDate,
  parseRehostedAttachment,
  postChatSubmission,
  receiptFor,
  systemI18nKey,
  systemI18nParam,
  withIdentityFrom,
} from './models/chat-message';

export {
  type PreChatField,
  type PreChatForm,
  DISABLED_PRE_CHAT_FORM,
  EMAIL_PATTERN,
  parsePreChatField,
  parsePreChatForm,
  validatePreChatField,
} from './models/pre-chat-form';

export {
  type PostChatField,
  type PostChatForm,
  DISABLED_POST_CHAT_FORM,
  parsePostChatField,
  parsePostChatForm,
  postChatHasFields,
  validatePostChatField,
} from './models/post-chat-form';

export {
  type AvailabilityReason,
  type ConfigResponse,
  type VisitorMode,
  type WidgetConfig,
  type WorkspaceAvailability,
  isNoticeOnly,
  isWorkspaceClosed,
  parseConfigResponse,
  parseWidgetConfig,
  parseWorkspaceAvailability,
  substituteVisitorVariables,
} from './models/widget-config';

export {
  type FeedbackResult,
  type MessagePage,
  type ProactiveMessage,
  type SendAck,
  type SendResult,
  type SessionResult,
  type StoredProfile,
  type UploadedFile,
  parseFeedbackResult,
  parseMessagePage,
  parseProactiveMessage,
  parseSendAck,
  parseSessionResult,
  parseStoredProfile,
  parseUploadedFile,
  serializeStoredProfile,
} from './models/results';

// ── controller + transport (advanced / testing surface) ───────────────────
export {
  type AppLifecycle,
  type ChatPhase,
  type ConnectionState,
  type VisitorIdentity,
  SessionController,
  dedupSort,
  isAuthHandshakeError,
  newestSessionStartMarker,
} from './session-controller';

export { type SessionArgs, type UploadArgs, type UploadSource, RestClient } from './rest-client';
export { type WidgetSocketHandlers, WidgetSocket, describeError } from './widget-socket';
export { type PresenceSocketHandlers, PresenceSocket } from './presence-socket';

// ── React bindings ────────────────────────────────────────────────────────
export {
  type WorkspaceAvailabilityView,
  useAgentLastReadAt,
  useAgentTyping,
  useConnectionState,
  useEasyLiveChat,
  useEasyLiveChatMessages,
  useEasyLiveChatPhase,
  useEasyLiveChatStore,
  useIsBooted,
  useOnError,
  useOnMessage,
  useOnProactiveMessage,
  useUnreadCount,
  useWidgetConfig,
  useWorkspaceAvailability,
} from './hooks';

// ── random source ─────────────────────────────────────────────────────────
// Metro cannot resolve an optional peer through a computed `require`, so the
// visitor id's random source is INJECTED rather than probed. See uuid.ts.
export { setUuidGenerator, uuidV4 } from './internal/uuid';

// ── push (documented non-goal; see the README) ────────────────────────────
export { EasyLiveChatPush } from './push';
