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
  type IdentityNotVerifiedError,
  type IdentityRejectionReason,
  EasyLiveChatError,
  EasyLiveChatErrorCode,
  errorForResponse,
  isIdentityNotVerified,
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
  isEdited,
  isFromAgent,
  isFromAssistant,
  isFromCustomer,
  isLocalTemp,
  isResolvableUrl,
  optimisticMessage,
  parseChatMessage,
  parseChatMessages,
  parseDate,
  parseOptionalDate,
  parseRehostedAttachment,
  postChatSubmission,
  receiptFor,
  systemI18nKey,
  systemI18nParam,
  withIdentityFrom,
} from './models/chat-message';

export {
  type BotButton,
  type BotButtons,
  type BotReply,
  type MessageCard,
  type MessageCardButton,
  type QuickReplyOffer,
  MAX_BOT_BUTTONS,
  MAX_CARD_BUTTONS,
  MAX_CAROUSEL_CARDS,
  botButtonsOf,
  botReplyOf,
  buttonsOpen,
  chosenButtonId,
  isSafeCardUrl,
  messageCardsOf,
  parseMessageCard,
  quickRepliesOf,
  quickRepliesOnOffer,
  replyLabel,
} from './models/message-extras';

export {
  type PreChatField,
  type PreChatForm,
  DISABLED_PRE_CHAT_FORM,
  EMAIL_PATTERN,
  cleanPolicyUrl,
  consentFieldsOf,
  isConsentField,
  parsePreChatField,
  parsePreChatForm,
  validateConsents,
  validatePreChatConsent,
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
  type DeletedMessage,
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
  parseUnsentIds,
  parseUploadedFile,
  serializeStoredProfile,
} from './models/results';

export {
  type HelpArticle,
  type HelpArticleList,
  type HelpArticleSummary,
  type HelpViewResult,
  HELP_SEARCH_MIN_LENGTH,
  parseHelpArticle,
  parseHelpArticleList,
  parseHelpArticleSummary,
} from './models/help-articles';

export {
  type HelpBlock,
  type HelpInline,
  helpInlineText,
  parseHelpMarkdown,
  safeHelpHref,
  safeHelpImage,
} from './models/help-markdown';

// ── controller + transport (advanced / testing surface) ───────────────────
export {
  type AppLifecycle,
  type ChatPhase,
  type ConnectionState,
  type VisitorChange,
  type PreChatSubmission,
  type VisitorIdentity,
  SessionController,
  dedupSort,
  isAuthHandshakeError,
  newestSessionStartMarker,
  visitorChangeFor,
} from './session-controller';

export {
  type HelpListArgs,
  type PushPlatform,
  type RegisterPushArgs,
  type SessionArgs,
  type UploadArgs,
  type UploadSource,
  CONSENT_CAPABILITY,
  RestClient,
} from './rest-client';
export { type WidgetSocketHandlers, WidgetSocket, describeError } from './widget-socket';
export { type PresenceSocketHandlers, PresenceSocket } from './presence-socket';

// ── React bindings ────────────────────────────────────────────────────────
export {
  type WorkspaceAvailabilityView,
  useAgentLastReadAt,
  useAgentTyping,
  useAssistantCovers,
  useAssistantTyping,
  useConnectionState,
  useEasyLiveChat,
  useEasyLiveChatMessages,
  useEasyLiveChatPhase,
  useEasyLiveChatStore,
  useIsBooted,
  useOnError,
  useOnMessage,
  useOnMessageDeleted,
  useOnProactiveMessage,
  useUnreadCount,
  useWidgetConfig,
  useWorkspaceAvailability,
} from './hooks';

// ── random source ─────────────────────────────────────────────────────────
// Metro cannot resolve an optional peer through a computed `require`, so the
// visitor id's random source is INJECTED rather than probed. See uuid.ts.
export { setUuidGenerator, uuidV4 } from './internal/uuid';

// ── push ──────────────────────────────────────────────────────────────────
// `EasyLiveChat.instance.setPushToken()` is the API; this is the old stub's
// name, kept as a deprecated alias that forwards to it.
export { EasyLiveChatPush } from './push';
