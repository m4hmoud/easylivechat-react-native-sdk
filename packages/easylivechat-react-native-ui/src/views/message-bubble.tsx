import {
  type ChatMessage,
  type MessageReceipt,
  type RehostedAttachment,
  EasyLiveChat,
  isFromCustomer,
  isResolvableUrl,
  postChatSubmission,
  receiptFor,
  systemI18nKey,
  systemI18nParam,
} from '@easylivechat/react-native';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type DirectionStyles, isolate, useDirectionStyles } from '../direction';
import {
  BrokenImageIcon,
  CheckIcon,
  ClockIcon,
  DoubleCheckIcon,
  DownloadIcon,
  FileIcon,
  StarIcon,
} from '../icons';
import type { Strings } from '../l10n';
import { ERROR_COLOR, type EasyLiveChatTheme, onColor, withAlpha } from '../theme';
import { LinkifiedText } from './linkified-text';
import { RemoteImage } from './remote-image';
import { VoiceNoteTile, looksLikeAudio } from './voice-note-tile';
import { MAX_FONT_SCALE } from '../text-scaling';

export interface MessageBubbleProps {
  message: ChatMessage;
  theme: EasyLiveChatTheme;
  showAgentName: boolean;
  showAgentAvatar: boolean;
  strings: Strings;
  /** How far an agent has read, for the visitor's own sent/read ticks. */
  agentLastReadAt: Date | null;
  onOpenImage: (uri: string) => void;
}

/**
 * A single message row.
 *
 * Customer messages sit on the TRAILING edge, agent/system/bot on the LEADING
 * edge — logical, so `ar`/`ckb`/`ur` mirror without a second layout.
 *
 * Renders text, inline images, file chips and inert placeholders WITHOUT EVER
 * CRASHING on unknown content or attachment shapes: an unknown `contentType`
 * degrades to a plain text bubble, and a non-resolvable placeholder
 * (`wa:media:{id}`) renders a "media unavailable" chip rather than a broken
 * image.
 */
export function MessageBubble(props: MessageBubbleProps): React.JSX.Element | null {
  const { message, theme, strings } = props;
  const dir = useDirectionStyles();

  // The survey the visitor filled in, drawn where they filled it in. A thread
  // that swallowed it would look like the submission failed, and pinning it
  // below everything (as the old conversation-level field did) put an older
  // visit's rating under newer messages.
  const submission = postChatSubmission(message);
  if (submission != null) {
    return (
      <PostChatCard submission={submission} theme={theme} strings={strings} dir={dir} />
    );
  }

  if (message.senderType === 'system') {
    return <SystemRow message={message} theme={theme} strings={strings} />;
  }

  return <ChatBubble {...props} dir={dir} />;
}

// ── system notices ────────────────────────────────────────────────────────

/**
 * System lines are NOTICES, NOT CHAT: centred, small, muted, with no bubble,
 * avatar, name or meta — matching the dashboard, the web widget and the native
 * agent apps.
 */
function SystemRow({
  message,
  theme,
  strings,
}: {
  message: ChatMessage;
  theme: EasyLiveChatTheme;
  strings: Strings;
}): React.JSX.Element | null {
  const key = systemI18nKey(message);

  // A returning visitor lands back in the conversation they already have
  // rather than starting a fresh one, so a thread can span months and several
  // unrelated problems. These bracket each visit — a labelled RULE rather than
  // the usual pill, so a session boundary reads as a break in the transcript
  // and not as another notice.
  if (
    key === 'conversation.session.ended' ||
    key === 'conversation.session.ended.customer' ||
    key === 'conversation.session.started'
  ) {
    const started = key === 'conversation.session.started';
    // Leaving is a moment in a working day, so it reads at a clock time; an
    // agent resolving something is a day-level event in a thread that may span
    // months.
    const left = key === 'conversation.session.ended.customer';
    const label = left
      ? strings.t('systemSessionLeft').replace('{time}', sessionTime(message.createdAt))
      : (started ? strings.t('systemSessionStarted') : strings.t('systemSessionEnded')).replace(
          '{date}',
          sessionDate(message.createdAt),
        );
    const rule = withAlpha(theme.text, 0.12);
    return (
      <View style={styles.dividerRow}>
        <View style={[styles.dividerRule, { backgroundColor: rule }]} />
        <Text
          style={[
            styles.dividerLabel,
            { color: started ? theme.primary : withAlpha(theme.text, 0.55) },
          ]}
        >
          {label}
        </Text>
        <View style={[styles.dividerRule, { backgroundColor: rule }]} />
      </View>
    );
  }

  // Prefer the structured key so the line renders in the VIEWER's language;
  // the body is the workspace-language fallback for notices sent before the
  // key existed (or with keys this SDK does not know).
  const notice =
    key === 'conversation.transferred'
      ? strings.t('systemTransferredTo').replace('{name}', systemI18nParam(message, 'name'))
      : (message.body ?? '').trim();
  if (notice.length === 0) return null;

  return (
    <View style={styles.noticeWrap}>
      <View style={[styles.noticePill, { backgroundColor: withAlpha(theme.text, 0.06) }]}>
        <Text style={[styles.noticeText, { color: withAlpha(theme.text, 0.55) }]}>{notice}</Text>
      </View>
    </View>
  );
}

// ── the bubble ────────────────────────────────────────────────────────────

function ChatBubble({
  message,
  theme,
  showAgentName,
  showAgentAvatar,
  strings,
  agentLastReadAt,
  onOpenImage,
  dir,
}: MessageBubbleProps & { dir: DirectionStyles }): React.JSX.Element {
  const customer = isFromCustomer(message);
  const bubbleColor = customer ? theme.primary : theme.surface;
  const textColor = customer ? onColor(theme.primary) : theme.text;
  const body = (message.body ?? '').trim();

  const agentName = trimmedOrNull(message.senderName);
  const jobTitle = trimmedOrNull(message.senderJobTitle);
  const agentLine = agentName == null ? null : jobTitle != null ? `${agentName} · ${jobTitle}` : agentName;

  // An avatar sits beside every inbound bubble when the workspace has the
  // switch on. System notices never reach here, so what is left is the team
  // talking, and the team gets a face.
  //
  // Deliberately NOT gated on knowing WHO sent it: the auto-greeting of a chat
  // opened while everyone was offline is stamped with the assignee, and there
  // is not one yet — so the first bubble of the conversation had no face while
  // every later one did. `AgentAvatar` degrades to an initial, and to a
  // neutral circle when there is no name either.
  const withAvatar = !customer && showAgentAvatar;

  // A message that is ONLY self-drawn media gets no bubble. The bubble exists
  // to put a surface behind text; wrapped around a photo or a voice note it
  // becomes a second card around a first — on the visitor's own side the full
  // accent colour, so their own images arrived matted in blue and their own
  // recording in a coloured frame. Both already round their own corners.
  //
  // Deliberately strict: a caption needs the bubble behind it, and so does a
  // file chip or an unavailable-media placeholder — those read as controls and
  // would float loose without a surface.
  const bareMedia = isBareMedia(message);

  const tiles = useMemo(
    () =>
      attachmentTiles(
        message,
        textColor,
        theme,
        strings,
        onOpenImage,
        dir,
        // Standing alone, a voice note has to paint the surface the bubble
        // would have; inside one it stays an inlay.
        bareMedia ? bubbleColor : undefined,
      ),
    [message, textColor, theme, strings, onOpenImage, dir, bareMedia, bubbleColor],
  );

  const receipt = receiptFor(message, agentLastReadAt);

  const column = (
    <View style={{ alignItems: customer ? dir.alignEnd : dir.alignStart, flexShrink: 1 }}>
      {!customer && showAgentName && agentLine != null ? (
        <Text style={[styles.agentLine, dir.textStart, { color: withAlpha(theme.text, 0.6) }]}>
          {agentLine}
        </Text>
      ) : null}

      <View
        style={[
          styles.bubble,
          {
            maxWidth: withAvatar ? '84%' : '92%',
            backgroundColor: bareMedia ? 'transparent' : bubbleColor,
            paddingHorizontal: bareMedia ? 0 : 14,
            paddingVertical: bareMedia ? 0 : 10,
            // Logical corners: the tail hugs the sender's own side in RTL too.
            borderTopStartRadius: 16,
            borderTopEndRadius: 16,
            borderBottomStartRadius: customer ? 16 : 4,
            borderBottomEndRadius: customer ? 4 : 16,
            borderWidth: customer || bareMedia ? 0 : StyleSheet.hairlineWidth,
            borderColor: withAlpha(theme.text, 0.08),
          },
        ]}
      >
        {tiles.length > 0 ? (
          <View>
            {tiles}
            {body.length > 0 ? <View style={{ height: 8 }} /> : null}
          </View>
        ) : null}

        {body.length > 0 ? (
          <LinkifiedText
            text={body}
            style={{ color: textColor, fontSize: 15, lineHeight: 21 }}
            // On the accent-coloured customer bubble the accent IS the
            // background, so a link there keeps the bubble's own foreground and
            // relies on the underline; agent bubbles sit on `surface`, where
            // the accent reads correctly.
            linkColor={customer ? textColor : theme.primary}
          />
        ) : null}

        {body.length === 0 && tiles.length === 0 ? (
          // An attachment-only message with no resolvable media still needs
          // SOMETHING visible so it never renders empty.
          <Text style={{ color: withAlpha(textColor, 0.7), fontSize: 14, fontStyle: 'italic' }}>
            {strings.t('attachment')}
          </Text>
        ) : null}
      </View>

      <MetaRow
        message={message}
        receipt={receipt}
        theme={theme}
        strings={strings}
        dir={dir}
      />
    </View>
  );

  if (!withAvatar) {
    return (
      <View style={[styles.row, { alignItems: customer ? dir.alignEnd : dir.alignStart }]}>
        {column}
      </View>
    );
  }

  return (
    <View style={[styles.row, { flexDirection: dir.row, alignItems: 'flex-start' }]}>
      <AgentAvatar url={message.senderAvatarUrl} name={agentName} theme={theme} />
      <View style={{ width: 8 }} />
      <View style={{ flexShrink: 1 }}>{column}</View>
    </View>
  );
}

// ── meta row (time + receipt) ─────────────────────────────────────────────

function MetaRow({
  message,
  receipt,
  theme,
  strings,
  dir,
}: {
  message: ChatMessage;
  receipt: MessageReceipt | null;
  theme: EasyLiveChatTheme;
  strings: Strings;
  dir: DirectionStyles;
}): React.JSX.Element {
  const muted = withAlpha(theme.text, 0.45);
  return (
    <View style={[styles.meta, { flexDirection: dir.row }]}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: muted, fontSize: 10 }}>
        {isolate(formatTime(message.createdAt))}
      </Text>
      {receipt === 'failed' ? (
        // The one state that is not a tick. It is the only one the visitor can
        // act on, so it stays a WORDED, TAPPABLE affordance rather than an
        // icon they would have to guess at.
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            // Swallow the (already UI-reflected) failure so a second failure
            // is not an unhandled rejection.
            EasyLiveChat.instance.resend(message)?.serverMessageId.catch(() => '');
          }}
          style={{ marginStart: 6 }}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.retry}>
            {strings.t('sendFailedRetry')}
          </Text>
        </Pressable>
      ) : receipt != null ? (
        <View style={{ marginStart: 4 }}>
          <ReceiptTicks receipt={receipt} muted={muted} readColor={theme.primary} strings={strings} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The visitor's own send status, in the idiom every messaging app uses: a
 * clock while it is in flight, one tick once the server has it, two in the
 * workspace's accent once an agent has read it.
 *
 * The tick glyphs are shape-symmetric, so unlike a chevron they need no
 * mirroring in Arabic, Sorani, Badini or Urdu — the surrounding row already
 * flips their position.
 */
function ReceiptTicks({
  receipt,
  muted,
  readColor,
  strings,
}: {
  receipt: MessageReceipt;
  muted: string;
  readColor: string;
  strings: Strings;
}): React.JSX.Element {
  const isRead = receipt === 'read';
  const color = isRead ? readColor : muted;
  const label =
    receipt === 'pending'
      ? strings.t('sending')
      : isRead
        ? strings.t('messageRead')
        : strings.t('messageSent');
  return (
    // The time next to it is already read out; the tick is one more fact about
    // the same message, not a control.
    <View accessible accessibilityLabel={label}>
      {receipt === 'pending' ? (
        <ClockIcon color={color} size={12} />
      ) : isRead ? (
        <DoubleCheckIcon color={color} size={13} />
      ) : (
        // `failed` never reaches here — the meta row renders its retry link
        // instead — so a single tick is the only remaining case.
        <CheckIcon color={color} size={13} />
      )}
    </View>
  );
}

// ── avatar ────────────────────────────────────────────────────────────────

/**
 * The replying agent's face.
 *
 * Falls back to the initial of their name on a tinted circle when there is no
 * photo — the same fallback the web widget uses, so an agent without an avatar
 * still reads as a person rather than leaving a hole in the layout.
 */
function AgentAvatar({
  url,
  name,
  theme,
}: {
  url?: string;
  name: string | null;
  theme: EasyLiveChatTheme;
}): React.JSX.Element {
  const size = 28;
  const initial = name != null && name.length > 0 ? (name[0] ?? 'A').toUpperCase() : 'A';
  const fallback = (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: withAlpha(theme.primary, 0.15),
      }}
    >
      <Text style={{ color: theme.primary, fontSize: 12, fontWeight: '700' }}>{initial}</Text>
    </View>
  );

  const raw = url?.trim();
  if (raw == null || raw.length === 0) return fallback;

  // Avatars come back server-relative (`/uploads/...`); resolveUrl makes them
  // absolute against the configured API host.
  const resolved = EasyLiveChat.instance.resolveUrl(raw);
  return (
    <RemoteImage
      uri={resolved}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      theme={theme}
      // A broken or slow avatar must never break the thread — degrade to the
      // initial rather than showing an error glyph mid-conversation.
      fallback={fallback}
      placeholder={fallback}
    />
  );
}

// ── attachments ───────────────────────────────────────────────────────────

function attachmentTiles(
  message: ChatMessage,
  fg: string,
  theme: EasyLiveChatTheme,
  strings: Strings,
  onOpenImage: (uri: string) => void,
  dir: DirectionStyles,
  /**
   * The surface a voice note must paint for itself, set only when this
   * message dropped its bubble. Undefined leaves the tile an inlay.
   */
  bubbleColor?: string,
): React.JSX.Element[] {
  const tiles: React.JSX.Element[] = [];
  // Prefer the RICH rehosted list when present (post re-host); fall back to
  // the flat URL list otherwise.
  if (message.attachments.length > 0) {
    message.attachments.forEach((a, i) => {
      tiles.push(richTile(a, i, fg, theme, strings, onOpenImage, dir, bubbleColor));
    });
    return tiles;
  }
  message.attachmentUrls.forEach((raw, i) => {
    tiles.push(urlTile(raw, i, fg, theme, strings, onOpenImage, dir, bubbleColor));
  });
  return tiles;
}

function richTile(
  a: RehostedAttachment,
  key: number,
  fg: string,
  theme: EasyLiveChatTheme,
  strings: Strings,
  onOpenImage: (uri: string) => void,
  dir: DirectionStyles,
  bubbleColor?: string,
): React.JSX.Element {
  if (!isResolvableUrl(a.url)) return unavailableChip(key, fg, strings, dir);
  const url = EasyLiveChat.instance.resolveUrl(a.url);
  if (a.kind === 'image') return inlineImage(url, key, fg, theme, strings, onOpenImage, dir);
  const label = a.filename ?? basename(a.url);
  // The server's `kind` is authoritative — it comes from the mime type, so it
  // catches a container this end has never heard of.
  if (a.kind === 'audio' || looksLikeAudio(a.url)) {
    return voiceTile(url, label, key, fg, strings, dir, bubbleColor);
  }
  return fileChip(label, key, fg, strings, dir);
}

function urlTile(
  raw: string,
  key: number,
  fg: string,
  theme: EasyLiveChatTheme,
  strings: Strings,
  onOpenImage: (uri: string) => void,
  dir: DirectionStyles,
  bubbleColor?: string,
): React.JSX.Element {
  // `wa:media:{id}` and similar placeholders.
  if (!isResolvableUrl(raw)) return unavailableChip(key, fg, strings, dir);
  const url = EasyLiveChat.instance.resolveUrl(raw);
  if (looksLikeImage(raw)) return inlineImage(url, key, fg, theme, strings, onOpenImage, dir);
  if (looksLikeAudio(raw)) return voiceTile(url, basename(raw), key, fg, strings, dir, bubbleColor);
  return fileChip(basename(raw), key, fg, strings, dir);
}

/**
 * Keyed by url so playback survives the thread re-rendering around it — a
 * message arriving mid-listen must not restart what is playing.
 */
function voiceTile(
  url: string,
  label: string,
  key: number,
  fg: string,
  strings: Strings,
  dir: DirectionStyles,
  /** Set only when the bubble has been dropped and the tile IS the card. */
  background?: string,
): React.JSX.Element {
  return (
    <VoiceNoteTile
      key={`voice:${url}`}
      url={url}
      fg={fg}
      strings={strings}
      dir={dir}
      background={background}
      fallback={fileChip(label, key, fg, strings, dir)}
    />
  );
}

function inlineImage(
  url: string,
  key: number,
  fg: string,
  theme: EasyLiveChatTheme,
  strings: Strings,
  onOpenImage: (uri: string) => void,
  dir: DirectionStyles,
): React.JSX.Element {
  return (
    <Pressable
      key={`img${key}`}
      onPress={() => onOpenImage(url)}
      accessibilityRole="imagebutton"
      accessibilityLabel={strings.t('image')}
      style={[{ marginBottom: 4 }, { alignSelf: dir.alignStart }]}
    >
      <RemoteImage
        uri={url}
        // A thumbnail, capped — tapping opens it full-screen, where it can be
        // pinched and panned.
        style={{ width: 240, height: 180, borderRadius: 10 }}
        contentFit="cover"
        theme={theme}
        // A broken/blocked image must never throw — degrade to a chip.
        fallback={fileChip(strings.t('image'), key, fg, strings, dir)}
      />
    </Pressable>
  );
}

function fileChip(
  label: string,
  key: number,
  fg: string,
  strings: Strings,
  dir: DirectionStyles,
): React.JSX.Element {
  return (
    <View
      key={`file${key}`}
      // Logical row + logical self-alignment: a chip laid out with a physical
      // `row`/`flex-start` keeps its icon on the left and hugs the left edge in
      // an RTL thread, which is the one place a bubble's contents visibly fail
      // to mirror.
      style={[
        styles.chip,
        { backgroundColor: withAlpha(fg, 0.08), flexDirection: dir.row, alignSelf: dir.alignStart },
      ]}
    >
      <FileIcon color={fg} size={18} />
      <Text numberOfLines={1} style={{ color: fg, fontSize: 13, flexShrink: 1, marginHorizontal: 8 }}>
        {label}
      </Text>
      {/* Labelled, or the download affordance announces as nothing. */}
      <View accessible accessibilityLabel={strings.t('download')}>
        <DownloadIcon color={withAlpha(fg, 0.7)} size={16} />
      </View>
    </View>
  );
}

function unavailableChip(
  key: number,
  fg: string,
  strings: Strings,
  dir: DirectionStyles,
): React.JSX.Element {
  return (
    <View
      key={`na${key}`}
      style={[
        styles.chip,
        {
          backgroundColor: withAlpha(fg, 0.06),
          borderWidth: 1,
          borderColor: withAlpha(fg, 0.15),
          flexDirection: dir.row,
          alignSelf: dir.alignStart,
        },
      ]}
    >
      <BrokenImageIcon color={withAlpha(fg, 0.6)} size={18} />
      <Text style={{ color: withAlpha(fg, 0.6), fontSize: 13, marginHorizontal: 8 }}>
        {strings.t('mediaUnavailable')}
      </Text>
    </View>
  );
}

// ── the submitted-survey card ─────────────────────────────────────────────

/**
 * The post-chat survey as it appears in the thread.
 *
 * Deliberately not a chat bubble: it is a form the visitor submitted, so it
 * reads as a small centred card — matching the dashboard and the native apps.
 */
function PostChatCard({
  submission,
  theme,
  strings,
  dir,
}: {
  submission: Record<string, unknown>;
  theme: EasyLiveChatTheme;
  strings: Strings;
  dir: DirectionStyles;
}): React.JSX.Element {
  const rating = typeof submission.rating === 'number' ? submission.rating : null;
  const comment = String(submission.comment ?? '');
  const rawAnswers = submission.answers;
  // Everything except the rating and the comment, which are drawn in their own
  // right above — a form whose comment field IS the comment would otherwise
  // print it twice.
  const extras = (Array.isArray(rawAnswers) ? rawAnswers : [])
    .filter((a): a is Record<string, unknown> => a != null && typeof a === 'object')
    .filter(
      (a) =>
        a.type !== 'rating' &&
        String(a.value ?? '').trim().length > 0 &&
        String(a.value ?? '') !== comment,
    );

  return (
    <View style={styles.cardWrap}>
      <View style={[styles.card, { backgroundColor: withAlpha(theme.text, 0.06) }]}>
        <Text style={[styles.cardTitle, { color: withAlpha(theme.text, 0.55) }]}>
          {strings.t('postChatTitle').toUpperCase()}
        </Text>
        {rating != null ? (
          <View style={{ flexDirection: dir.row, marginTop: 6 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <StarIcon
                key={i}
                size={16}
                filled={i < rating}
                color={i < rating ? '#F59E0B' : withAlpha(theme.text, 0.3)}
              />
            ))}
          </View>
        ) : null}
        {comment.length > 0 ? (
          <Text style={[styles.cardComment, { color: theme.text }]}>{comment}</Text>
        ) : null}
        {extras.map((answer, i) => (
          <View key={i} style={[styles.cardAnswer, { alignItems: dir.alignStart }]}>
            <Text style={[dir.textStart, { fontSize: 10.5, color: withAlpha(theme.text, 0.55) }]}>
              {String(answer.label ?? '')}
            </Text>
            <Text style={[dir.textStart, { fontSize: 12.5, color: theme.text }]}>
              {String(answer.value ?? '')}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────

function trimmedOrNull(v: string | undefined): string | null {
  const t = v?.trim();
  return t != null && t.length > 0 ? t : null;
}

/**
 * True when this message is nothing but media that draws its own surface.
 *
 * A picture, or a voice note: both already round their own corners, so the
 * bubble around them is a second card holding a first one. On the visitor's
 * own side that is the full accent colour, so their own recording arrived
 * matted in a coloured frame.
 */
export function isBareMedia(message: ChatMessage): boolean {
  if ((message.body ?? '').trim().length > 0) return false;
  if (message.attachments.length > 0) {
    return message.attachments.every(
      (a) =>
        isResolvableUrl(a.url) &&
        (a.kind === 'image' || a.kind === 'audio' || looksLikeAudio(a.url)),
    );
  }
  if (message.attachmentUrls.length > 0) {
    return message.attachmentUrls.every(
      (u) => isResolvableUrl(u) && (looksLikeImage(u) || looksLikeAudio(u)),
    );
  }
  return false;
}

export function looksLikeImage(url: string): boolean {
  const path = url.toLowerCase().split('?')[0] ?? '';
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic'].some((ext) =>
    path.endsWith(ext),
  );
}

function basename(url: string): string {
  const path = url.split('?')[0] ?? url;
  const segments = path.split('/');
  const last = segments[segments.length - 1] ?? path;
  return last.length === 0 ? path : last;
}

/**
 * Timestamps and dates are formatted HERE, never delegated to the host's
 * localization.
 *
 * The SDK ships chrome in 13 languages, two of which (`ckb`, `kmr`) have no
 * platform localization at all, so a host supporting them must supply its own
 * data — and when that returns a bad pattern the date arrives as literal
 * format characters, indistinguishable from a real date. Building from the
 * parts (day/month/year, Western digits, 24h) is plain, unambiguous and
 * identical in every locale.
 *
 * `Intl.DateTimeFormat` is also not reliably available: Hermes ships without
 * full ICU by default.
 */
export function formatTime(dt: Date): string {
  const h = String(dt.getHours()).padStart(2, '0');
  const m = String(dt.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function sessionTime(dt: Date): string {
  return isolate(formatTime(dt));
}

function sessionDate(dt: Date): string {
  const d = String(dt.getDate()).padStart(2, '0');
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  return isolate(`${d}/${m}/${dt.getFullYear()}`);
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 12, paddingVertical: 4 },
  bubble: { overflow: 'hidden' },
  agentLine: { fontSize: 11, fontWeight: '600', marginBottom: 2, marginHorizontal: 4 },
  meta: { alignItems: 'center', marginTop: 2, paddingHorizontal: 4 },
  retry: {
    color: ERROR_COLOR,
    fontSize: 10,
    textDecorationLine: 'underline',
    textDecorationColor: ERROR_COLOR,
  },
  chip: {
    // `flexDirection` and `alignSelf` are supplied per-render from the
    // resolved direction — see fileChip/unavailableChip.
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 4,
  },
  dividerRow: {
    // Symmetric by construction (rule · label · rule), so a physical `row`
    // reads identically in both directions.
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  dividerRule: { flex: 1, height: 1 },
  dividerLabel: { fontSize: 11, fontWeight: '500', marginHorizontal: 10 },
  noticeWrap: { paddingHorizontal: 24, paddingVertical: 6, alignItems: 'center' },
  noticePill: { maxWidth: 280, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  noticeText: { fontSize: 11.5, lineHeight: 16, textAlign: 'center' },
  cardWrap: { paddingHorizontal: 16, paddingVertical: 6, alignItems: 'center' },
  card: {
    maxWidth: 320,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: 'center',
  },
  cardTitle: { fontSize: 10, fontWeight: '600', letterSpacing: 0.8 },
  cardComment: { fontSize: 12.5, textAlign: 'center', marginTop: 6 },
  cardAnswer: { marginTop: 6, alignSelf: 'stretch' },
});
