/**
 * `@easylivechat/react-native-ui` — prebuilt, themeable chat UI for
 * EasyLiveChat, built on the headless `@easylivechat/react-native` core.
 *
 * ```tsx
 * import {
 *   EasyLiveChat,
 *   EasyLiveChatLauncher,
 *   SecureAsyncStorage,
 * } from '@easylivechat/react-native-ui';
 *
 * await EasyLiveChat.instance.boot(
 *   { apiBase: 'https://api.livechattools.com', tenantSlug: 'acme' },
 *   { storage: new SecureAsyncStorage() },
 * );
 *
 * // in your tree:
 * <View style={{ flex: 1 }}>
 *   <MyApp />
 *   <EasyLiveChatLauncher />
 * </View>
 * ```
 *
 * Theming, locale and RTL all come from the server widget config.
 */

// The whole core, so a host installs one package.
export * from '@easylivechat/react-native';

// ── theme ─────────────────────────────────────────────────────────────────
export {
  type EasyLiveChatTheme,
  ERROR_COLOR,
  ERROR_COLOR_DARK,
  FALLBACK_THEME,
  contrastRatio,
  deriveSurface,
  errorColorOf,
  inkOf,
  inkOn,
  keyboardAppearance,
  luminance,
  mixColors,
  normalizeColor,
  onColor,
  parseHexColor,
  themeFromConfig,
  withAlpha,
} from './theme';
export { useEasyLiveChatTheme } from './use-theme';

// ── direction / RTL ───────────────────────────────────────────────────────
export {
  type Direction,
  type DirectionStyles,
  DirectionProvider,
  directionStyles,
  isolate,
  useDirection,
  useDirectionStyles,
} from './direction';

export { deviceLocale, deviceTextDirection, isRtlLanguage, textDirectionOf } from './bidi';

// ── storage ───────────────────────────────────────────────────────────────
export { SecureAsyncStorage, UiPreferences } from './storage-impl';

// ── localization ──────────────────────────────────────────────────────────
export {
  type Strings,
  type StringKey,
  type StringsTable,
  SUPPORTED_LOCALES,
  normalizeLocale,
  overrideAll,
  overrideByLocale,
  rawTable,
  resolveLocale,
  setHostLocale,
  stringsFor,
} from './l10n';

// ── sound ─────────────────────────────────────────────────────────────────
export { ElcChime, shouldChime } from './chime';

// ── attachments ───────────────────────────────────────────────────────────
export type { ElcAttachmentPicker, ElcPickedFile } from './picked-file';

// ── components ────────────────────────────────────────────────────────────
export {
  type EasyLiveChatLauncherProps,
  type LauncherAlignment,
  EasyLiveChatLauncher,
} from './launcher';
export { type EasyLiveChatScreenProps, EasyLiveChatScreen } from './chat-screen';
export { type EasyLiveChatHelpScreenProps, EasyLiveChatHelpScreen } from './help-screen';
export {
  type EasyLiveChatEndChatButtonProps,
  type EndChatDialogProps,
  EasyLiveChatEndChatButton,
  EndChatDialog,
} from './end-chat-button';

export { type ThreadViewProps, ThreadView } from './views/thread-view';
export { type MessageBubbleProps, MessageBubble, formatTime } from './views/message-bubble';
export { type ComposerBarProps, ComposerBar, formatRecordDuration } from './views/composer-bar';
export { type PreChatFormViewProps, PreChatFormView } from './views/pre-chat-form-view';
export { type PostChatFormViewProps, PostChatFormView } from './views/post-chat-form-view';
export { type FeedbackPromptViewProps, FeedbackPromptView } from './views/feedback-prompt-view';
export {
  type ClosedNoticeBannerProps,
  type ClosedNoticeViewProps,
  ClosedNoticeBanner,
  ClosedNoticeView,
  closedNoticeText,
} from './views/closed-notice-view';
export { type QueueNoticeProps, QueueNotice } from './views/queue-notice-view';
export { QuickReactionRow, ReactionChips } from './views/reactions-view';
export {
  type EmojiPickerProps,
  type EmojiPickerSheetProps,
  EmojiPicker,
  EmojiPickerSheet,
} from './views/emoji-picker';
export {
  type EmojiCatalog,
  type EmojiCategory,
  type EmojiEntry,
  EMOJI_CATEGORIES,
  EMOJI_CATEGORY_ICON,
  RECENT_EMOJI_MAX,
  addRecentEmoji,
  defaultEmojiCatalog,
  emojiCatalog,
  emojiCategoryKey,
  recentEmoji,
  searchEmoji,
} from './emoji/emoji';
export {
  type EmailCardProps,
  type EmailCardResult,
  EMAIL_CARD_PATTERN,
  EmailCard,
} from './views/email-card';
export {
  type EasyLiveChatEmailTranscriptButtonProps,
  type EmailTranscriptOffer,
  AfterChatEmailOffer,
  ChatEmailOffers,
  EasyLiveChatEmailTranscriptButton,
  openEmailTranscript,
  useEmailTranscriptOffer,
} from './email-offers';
export { LinkPreviewCard } from './views/link-preview-card';
export { type ElcImageViewerProps, ElcImageViewer } from './views/image-viewer';
export {
  type ElcHelpApi,
  type HelpViewProps,
  HelpView,
  helpArticleDirection,
} from './views/help-view';
export {
  type ElcOpenLink,
  type HelpMarkdownViewProps,
  HelpMarkdownView,
  openHelpLink,
} from './views/help-markdown-view';
export { type RemoteImageProps, RemoteImage } from './views/remote-image';
export {
  type ElcLinkKind,
  type ElcLinkSpan,
  type LinkifiedTextProps,
  LinkifiedText,
  detectLinks,
  isPhoneLike,
  openElcLink,
  uriForSpan,
} from './views/linkified-text';

// ── icons (drawn from Views; no icon font, no SVG peer) ───────────────────
export * from './icons';
