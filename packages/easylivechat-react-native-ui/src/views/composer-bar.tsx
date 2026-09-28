import {
  type UploadSource,
  type UploadedFile,
  EasyLiveChat,
  EasyLiveChatError,
  useWidgetConfig,
  useWorkspaceAvailability,
} from '@easylivechat/react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  type KeyboardEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { deviceTextDirection, textDirectionOf } from '../bidi';
import { type Direction, type DirectionStyles, useDirectionStyles } from '../direction';
import { CloseIcon, MicIcon, PauseIcon, PlayIcon, PlusIcon, SendIcon, TrashIcon } from '../icons';
import type { Strings } from '../l10n';
import type { ElcAttachmentPicker, ElcPickedFile } from '../picked-file';
import { VoiceLevels } from './voice-levels';
import { UiPreferences } from '../storage-impl';
import { ERROR_COLOR, type EasyLiveChatTheme, onColor, withAlpha } from '../theme';
import { ElcImageViewer } from './image-viewer';
import { looksLikeImage } from './message-bubble';
import { RemoteImage } from './remote-image';
import { MAX_FONT_SCALE } from '../text-scaling';

/**
 * Where the composer's remembered writing direction lives.
 *
 * NOT in `EasyLiveChatStorage`: this is a UI preference on this device, not
 * part of the visitor's identity, and it must not be swept by `reset()` when
 * somebody signs out — the next person on a shared phone probably writes the
 * same language.
 */
const DIRECTION_KEY = 'easylivechat:composer_direction';

/**
 * How often the waveform takes a level. Fast enough that the run slides
 * rather than steps, and eased so raw metering jitter does not draw a comb.
 */
const LEVEL_INTERVAL_MS = 60;

/** Hard stop, so a forgotten open microphone cannot upload something huge. */
export const MAX_RECORD_SECONDS = 5 * 60;

export interface ComposerBarProps {
  theme: EasyLiveChatTheme;
  strings: Strings;
  /**
   * Host hook that fully owns attachment picking. When set, the attach button
   * calls this and uploads whatever it returns, instead of the built-in
   * image/document pickers — which is also how a host avoids installing
   * `expo-image-picker` / `expo-document-picker` at all.
   */
  onPickAttachments?: ElcAttachmentPicker;
}

interface PendingAttachment {
  file: UploadedFile;
  /** A local preview URI, so the strip draws the picture without a round trip. */
  previewUri?: string;
  pickedContentType?: string;
}

/**
 * The message composer.
 *
 * Typing presence follows the FIELD, not the keystrokes: `setTyping(true)`
 * repeats every 2s for as long as the box has text, and `setTyping(false)`
 * fires the moment it empties, on send, and on teardown. The agent side clears
 * its indicator a few seconds after the last event it heard, so pausing
 * mid-sentence would otherwise read as "stopped typing" while the visitor is
 * still composing.
 */
export function ComposerBar({
  theme,
  strings,
  onPickAttachments,
}: ComposerBarProps): React.JSX.Element {
  const dir = useDirectionStyles();
  const config = useWidgetConfig();
  // Read the lock through a SUBSCRIPTION, not once at render: a visitor
  // already sitting on the chat screen when closing time arrives has to see it
  // lock, and the server pushes `visitorMode` on every availability change.
  const { composerLocked } = useWorkspaceAvailability();

  /**
   * How much of this bar the keyboard is covering, measured rather than
   * inferred.
   *
   * The screen used to wrap everything in a `KeyboardAvoidingView`, which is
   * inert on Android — `behavior` was undefined there, and RN's `default:`
   * branch is a plain `View` that never reads the computed inset — and
   * mis-measured on iOS, where it derives the overlap from
   * `frame.y + frame.height - keyboardFrame.screenY`. That mixes a
   * PARENT-RELATIVE layout rect with a SCREEN-ABSOLUTE keyboard rect, so it is
   * only correct when the view chain happens to start at window Y 0. Any host
   * that puts the chat under a safe-area inset, a navigation header or a page
   * sheet is short by exactly that offset — and this bar is about 60pt tall,
   * so being short by a status bar hides all of it. The draft was never lost;
   * the field it was in was underneath the keyboard.
   *
   * `measureInWindow` reports in the same space as `endCoordinates.screenY`,
   * so there is nothing left for a hand-tuned `keyboardVerticalOffset` to
   * correct. Where the window itself resizes — Android `adjustResize`, RN's
   * own `Modal` — this bar has already been moved above the keyboard by the
   * time it measures, the overlap comes out negative, and it adds nothing. So
   * it cannot double-avoid.
   *
   * This is Flutter's model: consume the true inset rather than reconstruct
   * it. There, `MediaQuery.viewInsets` is a window value that is right however
   * deep the widget sits, which is why `chat_screen.dart` ships no keyboard
   * widget at all and `composer_bar.dart` carries its own `SafeArea`.
   */
  const rootRef = useRef<View>(null);
  const [keyboardOverlap, setKeyboardOverlap] = useState(0);

  useEffect(() => {
    const onFrame = (event: KeyboardEvent) => {
      const screenY = event.endCoordinates.screenY;
      rootRef.current?.measureInWindow((_x, y, _width, height) => {
        setKeyboardOverlap(Math.max(0, y + height - screenY));
      });
    };
    // `will` on iOS so the bar travels with the keyboard rather than after it;
    // Android only emits `did`.
    const shown = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow',
      onFrame,
    );
    const hidden = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardOverlap(0),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const [rememberedDirection, setRememberedDirection] = useState<Direction | null>(null);
  const recorder = useRecorder({ strings, onError: setAttachError });

  // ── typing presence ──
  const typingActive = useRef(false);
  const typingKeepAlive = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTyping = useCallback(() => {
    if (typingKeepAlive.current != null) {
      clearInterval(typingKeepAlive.current);
      typingKeepAlive.current = null;
    }
    if (typingActive.current) {
      typingActive.current = false;
      EasyLiveChat.instance.setTyping(false);
    }
  }, []);

  useEffect(() => {
    void UiPreferences.get(DIRECTION_KEY).then((saved) => {
      if (saved === 'rtl' || saved === 'ltr') setRememberedDirection(saved);
    });
  }, []);

  useEffect(
    () => () => {
      // Best-effort on teardown: let the agent side know we stopped typing.
      stopTyping();
    },
    [stopTyping],
  );

  const onChangeText = useCallback(
    (text: string) => {
      setDraft(text);

      // Remember what the visitor is WRITING in, so the empty box keeps facing
      // that way. Only set from a direction the TEXT actually established.
      const written = textDirectionOf(text);
      if (written != null && written !== rememberedDirection) {
        setRememberedDirection(written);
        void UiPreferences.set(DIRECTION_KEY, written);
      }

      if (text.trim().length === 0) {
        stopTyping();
        return;
      }
      if (!typingActive.current) {
        typingActive.current = true;
        EasyLiveChat.instance.setTyping(true);
      }
      typingKeepAlive.current ??= setInterval(() => {
        EasyLiveChat.instance.setTyping(true);
      }, 2000);
    },
    [rememberedDirection, stopTyping],
  );

  const send = useCallback(() => {
    const text = draft.trim();
    const urls = pending.map((p) => p.file.url);
    if (text.length === 0 && urls.length === 0) return;
    stopTyping();
    // Fire-and-forget optimistic send; the controller surfaces the ack/echo
    // through `messages` (a failure shows as a failed bubble). Swallow the
    // serverId promise so a no-socket/rejected send is not an unhandled
    // rejection.
    EasyLiveChat.instance
      .sendMessage(text, { attachmentUrls: urls })
      .serverMessageId.catch(() => '');
    setDraft('');
    setPending([]);
    setAttachError(null);
  }, [draft, pending, stopTyping]);

  // ── uploads ──
  const upload = useCallback(
    async (file: ElcPickedFile) => {
      setUploading(true);
      setAttachError(null);
      try {
        const uploaded = await EasyLiveChat.instance.uploadBytes({
          data: file.data,
          filename: file.filename,
          contentType: file.contentType,
        });
        setPending((prev) => [
          ...prev,
          {
            file: uploaded,
            // Keep the local URI when we have one: the thumbnail is then
            // instant and offline, instead of pulling the visitor's own photo
            // back down from the server to show it to them.
            previewUri: localUriOf(file.data),
            pickedContentType: file.contentType,
          },
        ]);
      } catch (e) {
        setAttachError(
          e instanceof EasyLiveChatError
            ? strings.forErrorCode(e.code)
            : strings.t('somethingWentWrong'),
        );
      } finally {
        setUploading(false);
      }
    },
    [strings],
  );

  const onAttach = useCallback(async () => {
    if (uploading) return;
    if (onPickAttachments != null) {
      try {
        const files = await onPickAttachments();
        for (const f of files) await upload(f);
      } catch {
        setAttachError(strings.t('somethingWentWrong'));
      }
      return;
    }
    setAttachMenuOpen(true);
  }, [uploading, onPickAttachments, upload, strings]);

  const pickImage = useCallback(async () => {
    setAttachMenuOpen(false);
    // null covers both "cancelled" and "the optional peer is not installed";
    // neither is an error worth showing — a host without the picker supplies
    // `onPickAttachments` instead, and a cancelled pick is just a cancel.
    const picked = await pickFromLibrary();
    if (picked != null) await upload(picked);
  }, [upload]);

  const pickDocument = useCallback(async () => {
    setAttachMenuOpen(false);
    const picked = await pickDocumentFile();
    if (picked != null) await upload(picked);
  }, [upload]);

  const sendRecording = useCallback(async () => {
    const file = await recorder.stopAndTake();
    if (file == null) return;
    setUploading(true);
    try {
      const uploaded = await EasyLiveChat.instance.uploadBytes({
        data: file.data,
        filename: file.filename,
        contentType: file.contentType,
      });
      stopTyping();
      // Sent, NOT parked in the pending strip: a voice message is finished
      // when you stop talking, and a visitor is unlikely to hunt for a second
      // button to make it leave.
      EasyLiveChat.instance.sendMessage('', { attachmentUrls: [uploaded.url] }).serverMessageId.catch(
        () => '',
      );
    } catch (e) {
      setAttachError(
        e instanceof EasyLiveChatError
          ? strings.forErrorCode(e.code)
          : strings.t('somethingWentWrong'),
      );
    } finally {
      setUploading(false);
    }
  }, [recorder, stopTyping, strings]);

  // The hard duration cap. Stopping SENDS, exactly as the stop button does —
  // a recorder that merely stopped counting would keep the microphone live
  // (and the OS indicator lit) until the visitor noticed.
  useEffect(() => {
    if (recorder.recording && recorder.seconds >= MAX_RECORD_SECONDS) void sendRecording();
  }, [recorder.recording, recorder.seconds, sendRecording]);

  // The workspace's direction is the STARTING POINT, not the answer. Text
  // first; then what this visitor last wrote; then the phone's own language;
  // then the workspace's. Each step is a worse guess than the one before it,
  // and the first two are usually all it takes.
  const inputDirection: Direction =
    textDirectionOf(draft) ?? rememberedDirection ?? deviceTextDirection() ?? dir.direction;

  const voiceNotesEnabled = config?.voiceNotesEnabled ?? false;
  const recording = recorder.recording;

  return (
    <View
      ref={rootRef}
      style={[
        styles.container,
        {
          backgroundColor: theme.background,
          borderTopColor: withAlpha(theme.text, 0.08),
          paddingBottom: keyboardOverlap,
        },
      ]}
    >
      {attachError != null ? (
        <View style={[styles.errorBanner, { backgroundColor: withAlpha(ERROR_COLOR, 0.1) }]}>
          <Text style={[styles.errorText, dir.textStart]}>{attachError}</Text>
        </View>
      ) : null}

      {pending.length > 0 ? (
        <PendingStrip
          pending={pending}
          theme={theme}
          strings={strings}
          onRemove={(i) => setPending((prev) => prev.filter((_, idx) => idx !== i))}
          onPreview={setPreviewUri}
        />
      ) : null}

      <View style={[styles.row, { flexDirection: dir.row }]}>
        {/* Hidden rather than dimmed while locked: a greyed paperclip still
            reads as "attach something", and there is nothing to attach to a
            composer that cannot send. */}
        {!composerLocked && !recording ? (
          <Pressable
            onPress={() => void onAttach()}
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel={strings.t('attach')}
            style={styles.iconButton}
            hitSlop={6}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={withAlpha(theme.text, 0.5)} />
            ) : (
              <PlusIcon color={withAlpha(theme.text, 0.7)} size={22} />
            )}
          </Pressable>
        ) : null}

        {!composerLocked && !recording && voiceNotesEnabled ? (
          <Pressable
            onPress={() => void recorder.start()}
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel={strings.t('recordVoice')}
            style={styles.iconButton}
            hitSlop={6}
          >
            <MicIcon color={withAlpha(theme.text, uploading ? 0.4 : 0.75)} size={22} />
          </Pressable>
        ) : null}

        {/* Recording puts the trash where the paperclip was: the take is the
            only thing on screen to act on, and the two never share a slot. */}
        {recording ? (
          <Pressable
            onPress={() => void recorder.cancel()}
            accessibilityRole="button"
            accessibilityLabel={strings.t('discardVoice')}
            style={styles.iconButton}
            hitSlop={6}
          >
            <TrashIcon color={withAlpha(theme.text, 0.75)} size={22} />
          </Pressable>
        ) : null}

        {/* While a take is open there is nothing to type, so the bar stands in
            for the field. */}
        <View style={styles.field}>
          {recording ? (
            <RecordingBar
              seconds={recorder.seconds}
              levels={recorder.levels}
              paused={recorder.paused}
              previewUri={recorder.previewUri}
              theme={theme}
              strings={strings}
              dir={dir}
              onPause={() => void recorder.pause()}
            />
          ) : (
            <TextInput
              value={draft}
              onChangeText={onChangeText}
              editable={!composerLocked}
              multiline
              // The caret, the alignment and the punctuation all follow the
              // text, not the workspace.
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[
                styles.input,
                {
                  color: theme.text,
                  textAlign: inputDirection === 'rtl' ? 'right' : 'left',
                  writingDirection: inputDirection,
                },
              ]}
              // The hint is `closedReadOnly`, not `closedNotice`. The latter
              // says "leave your message", which is written for the banner
              // where they still can — as a hint on a disabled field beside a
              // send button, it asks for something the composer would refuse.
              placeholder={composerLocked ? strings.t('closedReadOnly') : strings.t('typeAMessage')}
              placeholderTextColor={withAlpha(theme.text, 0.4)}
              // Keep the keyboard up across a send, the way every messenger
              // does — `blurOnSubmit: false` is what stops the thread lurching
              // as the keyboard leaves mid-scroll-animation.
              blurOnSubmit={false}
              returnKeyType="send"
              onSubmitEditing={send}
              accessibilityLabel={strings.t('typeAMessage')}
            />
          )}
        </View>

        {/* Same reasoning as the paperclip: a live accent-coloured send button
            beside a disabled field promises something the composer refuses. */}
        {/* Paused: the microphone comes back to carry on talking. It really
            continues — expo-audio pauses and resumes the same file, so this
            is one recording and not two that would have to be merged. */}
        {recording && recorder.paused ? (
          <Pressable
            onPress={() => void recorder.resume()}
            accessibilityRole="button"
            accessibilityLabel={strings.t('recordVoice')}
            style={styles.iconButton}
            hitSlop={6}
          >
            <MicIcon color="#E11D48" size={22} />
          </Pressable>
        ) : null}

        {!composerLocked ? (
          recording ? (
            <Pressable
              onPress={() => void sendRecording()}
              accessibilityRole="button"
              accessibilityLabel={strings.t('sendVoice')}
              style={styles.iconButton}
              hitSlop={6}
            >
              {/* A send arrow, not a stop square. This button has never
                  stopped anything — sendRecording() puts the note straight in
                  the thread — so a square asked people to commit to sending
                  while showing them a pause. Its accessibilityLabel has read
                  `sendVoice` the whole time; only the glyph disagreed. */}
              <View style={[styles.sendCircle, { backgroundColor: theme.primary }]}>
                {/* Mirrored, exactly like the text send button below. This one
                    was the only directional glyph in the SDK left unmirrored,
                    and it sits inches from a correctly mirrored twin — so in
                    Kurdish or Arabic the two send arrows pointed opposite
                    ways. Flutter never had the bug: `Icons.send_rounded`
                    carries `matchTextDirection`, so Flutter mirrors it for
                    free, while these icons are hand-drawn and must opt in. */}
                <View style={dir.mirror}>
                  <SendIcon color={onColor(theme.primary)} size={20} />
                </View>
              </View>
            </Pressable>
          ) : (
            <Pressable
              onPress={send}
              accessibilityRole="button"
              accessibilityLabel={strings.t('send')}
              style={styles.iconButton}
              hitSlop={6}
            >
              <View style={[styles.sendCircle, { backgroundColor: theme.primary }]}>
                {/* A send arrow points the way the text flows, so it mirrors
                    in RTL — the same reason `BackIcon` does, and unlike the
                    receipt ticks, which are shape-symmetric and must not. */}
                <View style={dir.mirror}>
                  <SendIcon color={onColor(theme.primary)} size={20} />
                </View>
              </View>
            </Pressable>
          )
        ) : null}
      </View>

      <AttachMenu
        visible={attachMenuOpen}
        theme={theme}
        strings={strings}
        onClose={() => setAttachMenuOpen(false)}
        onPickImage={() => void pickImage()}
        onPickFile={() => void pickDocument()}
      />

      <ElcImageViewer
        visible={previewUri != null}
        uri={previewUri}
        theme={theme}
        strings={strings}
        onClose={() => setPreviewUri(null)}
      />
    </View>
  );
}

// ── pending attachments ───────────────────────────────────────────────────

/**
 * The row of attachments waiting to be sent.
 *
 * PICTURES SHOW AS PICTURES. A paperclip chip carrying
 * `IMG_20260814_113255.jpg` tells the visitor nothing about which of four
 * screenshots they just picked — the one thing they need to check before
 * hitting send. Non-images keep the chip, because a filename IS what
 * identifies a PDF.
 */
function PendingStrip({
  pending,
  theme,
  strings,
  onRemove,
  onPreview,
}: {
  pending: PendingAttachment[];
  theme: EasyLiveChatTheme;
  strings: Strings;
  onRemove: (index: number) => void;
  onPreview: (uri: string) => void;
}): React.JSX.Element {
  const dir = useDirectionStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.strip}
      contentContainerStyle={{ flexDirection: dir.row, paddingHorizontal: 12, paddingTop: 12 }}
    >
      {pending.map((p, i) => {
        const uri = previewUriFor(p);
        return (
          <View key={`${p.file.url}-${i}`} style={styles.stripItem}>
            {uri != null ? (
              <Pressable
                onPress={() => onPreview(uri)}
                accessibilityRole="imagebutton"
                accessibilityLabel={strings.t('image')}
              >
                <RemoteImage
                  uri={uri}
                  style={{ width: 56, height: 56, borderRadius: 10 }}
                  theme={theme}
                />
              </Pressable>
            ) : (
              <View style={[styles.pendingChip, { backgroundColor: theme.surface, borderColor: withAlpha(theme.text, 0.12) }]}>
                <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13, maxWidth: 120 }}>
                  {p.file.filename ?? strings.t('attachment')}
                </Text>
              </View>
            )}
            {/* A 20px badge in a 32px touch target, so the corner × is
                hittable without covering the picture it sits on. */}
            <Pressable
              onPress={() => onRemove(i)}
              accessibilityRole="button"
              accessibilityLabel={strings.t('removeAttachment')}
              style={[
                styles.removeBadgeHit,
                // Sits on the tile's TRAILING corner, so it mirrors with the
                // strip rather than covering the picture's leading edge.
                dir.isRtl ? { left: -12 } : { right: -12 },
              ]}
              hitSlop={6}
            >
              <View style={[styles.removeBadge, { borderColor: theme.background }]}>
                <CloseIcon color="#FFFFFF" size={12} />
              </View>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

function previewUriFor(p: PendingAttachment): string | null {
  const mime = (p.file.mimeType ?? p.pickedContentType ?? '').toLowerCase();
  const isImage =
    mime.length > 0 ? mime.startsWith('image/') : looksLikeImage(p.file.filename ?? p.file.url);
  if (!isImage) return null;
  return p.previewUri ?? EasyLiveChat.instance.resolveUrl(p.file.url);
}

function localUriOf(data: UploadSource): string | undefined {
  return typeof data === 'object' && data != null && 'uri' in data ? data.uri : undefined;
}

// ── recording ─────────────────────────────────────────────────────────────

/** `m:ss` — voice messages are short, so no hours component. */
export function formatRecordDuration(seconds: number): string {
  const s = seconds < 0 ? 0 : seconds;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The take, while it is being made and once it is made.
 *
 * Recording: a live waveform off the microphone, running time, and a pause.
 * Paused: the same waveform with a playhead, a play button, and the elapsed
 * time as it plays back — the take can be heard and then carried on with,
 * because neither recording format has a container index to finalise.
 */
function RecordingBar({
  seconds,
  levels,
  paused,
  previewUri,
  theme,
  strings,
  dir,
  onPause,
}: {
  seconds: number;
  levels: number[];
  paused: boolean;
  previewUri: () => string | null;
  theme: EasyLiveChatTheme;
  strings: Strings;
  dir: DirectionStyles;
  onPause: () => void;
}): React.JSX.Element {
  const preview = usePreviewPlayer(previewUri, paused);
  const fraction = paused ? preview.fraction : 1;
  const elapsed =
    paused && preview.position > 0
      ? formatRecordDuration(Math.floor(preview.position))
      : formatRecordDuration(seconds);

  return (
    <View style={{ flexDirection: dir.row, alignItems: 'center' }}>
      {paused ? (
        <Pressable
          onPress={() => void preview.toggle()}
          accessibilityRole="button"
          accessibilityLabel={strings.t(preview.playing ? 'pauseVoice' : 'playVoice')}
          hitSlop={8}
          style={{ paddingHorizontal: 2 }}
        >
          {preview.playing ? (
            <PauseIcon color={theme.text} size={22} />
          ) : (
            <PlayIcon color={theme.text} size={22} />
          )}
        </Pressable>
      ) : (
        // The recording dot: the one thing on the bar that says the
        // microphone is actually open.
        <View style={styles.recordDot} />
      )}

      <View style={{ flex: 1, marginHorizontal: 8 }}>
        <VoiceLevels
          levels={levels}
          fraction={fraction}
          color={theme.text}
          dir={dir}
          reviewing={paused}
          intervalMs={LEVEL_INTERVAL_MS}
          onSeek={paused ? preview.seek : undefined}
        />
      </View>

      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          color: withAlpha(theme.text, 0.7),
          fontSize: 13,
          fontVariant: ['tabular-nums'],
        }}
      >
        {elapsed}
      </Text>

      {!paused ? (
        <Pressable
          onPress={onPause}
          accessibilityRole="button"
          accessibilityLabel={strings.t('pauseVoice')}
          hitSlop={8}
          style={{ paddingStart: 6 }}
        >
          <PauseIcon color={theme.text} size={22} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Play the take back without ending it.
 *
 * The recorder keeps the file open while paused; both formats are readable
 * mid-write, so the uri can simply be handed to a player. Recreated whenever
 * the take grows, because the old player is holding a shorter file.
 */
function usePreviewPlayer(previewUri: () => string | null, paused: boolean) {
  const player = useRef<PreviewPlayerish | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [total, setTotal] = useState(0);

  const stop = useCallback(() => {
    if (ticker.current != null) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
    try {
      player.current?.remove();
    } catch {
      // Releasing twice is not an error worth surfacing.
    }
    player.current = null;
    setPlaying(false);
    setPosition(0);
    setTotal(0);
  }, []);

  // Leaving the paused state means the take is about to grow: whatever was
  // loaded is now a shorter file than the one being recorded.
  useEffect(() => {
    if (!paused) stop();
  }, [paused, stop]);

  useEffect(() => () => stop(), [stop]);

  const toggle = useCallback(async () => {
    if (playing) {
      try {
        player.current?.pause();
      } catch {
        // Nothing to pause is the state we wanted.
      }
      setPlaying(false);
      return;
    }
    const uri = previewUri();
    if (uri == null) return;
    try {
      const audio = await loadExpoAudio();
      if (audio == null) return;
      player.current ??= audio.createAudioPlayer({ uri }) as PreviewPlayerish;
      player.current.play();
      setPlaying(true);
      if (ticker.current != null) clearInterval(ticker.current);
      ticker.current = setInterval(() => {
        const p = player.current;
        if (p == null) return;
        const d = typeof p.duration === 'number' && Number.isFinite(p.duration) ? p.duration : 0;
        const t =
          typeof p.currentTime === 'number' && Number.isFinite(p.currentTime) ? p.currentTime : 0;
        if (d > 0) setTotal(d);
        setPosition(t);
        if (d > 0 && t >= d - 0.25) {
          try {
            p.pause();
            void p.seekTo(0);
          } catch {
            // Nothing left to rewind.
          }
          setPosition(0);
          setPlaying(false);
          if (ticker.current != null) clearInterval(ticker.current);
          ticker.current = null;
        }
      }, 200);
    } catch {
      setPlaying(false);
    }
  }, [playing, previewUri]);

  const seek = useCallback(
    (f: number) => {
      const p = player.current;
      if (p == null || total <= 0) return;
      const target = total * Math.min(1, Math.max(0, f));
      setPosition(target);
      try {
        void p.seekTo(target);
      } catch {
        // A seek the platform refused leaves the playhead where it was.
      }
    },
    [total],
  );

  return {
    playing,
    position,
    fraction: total > 0 ? Math.min(1, Math.max(0, position / total)) : 0,
    toggle,
    seek,
  };
}

interface PreviewPlayerish {
  playing?: boolean;
  currentTime?: number;
  duration?: number;
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void> | void;
  remove(): void;
}


interface RecorderApi {
  recording: boolean;
  /** Microphone off, take kept. `resume()` appends to the SAME file. */
  paused: boolean;
  seconds: number;
  /** Real input levels, newest last, for the waveform. */
  levels: number[];
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  /** The uri of the take so far, playable, without ending it. */
  previewUri(): string | null;
  stopAndTake(): Promise<ElcPickedFile | null>;
}

/**
 * What to record, by platform — see the comment at the call site.
 *
 * Both are containerless enough to be played before the recorder stops:
 * WAV is raw samples after a fixed header, ADTS is self-framing.
 *
 * FLAT, deliberately. `expo-audio` accepts the nested `ios` / `android` blocks
 * only through `useAudioRecorder`, which runs them through an internal
 * `createRecordingOptions()` that the package does not export. Handed straight
 * to the constructor, as they are here, the nested blocks are ignored and the
 * native recorder falls back to its defaults — which on iOS is AAC-in-MPEG-4
 * written into a file named `.wav`. That would defeat the whole reason for
 * choosing these formats: a container with no index can be played while it is
 * merely paused, and an m4a cannot.
 */
function recordingOptions(): Record<string, unknown> {
  const wav = Platform.OS === 'ios' || Platform.OS === 'macos';
  const common = {
    extension: wav ? '.wav' : '.aac',
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 64000,
    isMeteringEnabled: true,
  };
  return wav
    ? {
        ...common,
        outputFormat: 'lpcm',
        audioQuality: 96,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
      }
    : { ...common, outputFormat: 'aac_adts', audioEncoder: 'aac' };
}

function takeExtension(): string {
  return Platform.OS === 'ios' || Platform.OS === 'macos' ? 'wav' : 'aac';
}

function takeContentType(): string {
  return Platform.OS === 'ios' || Platform.OS === 'macos' ? 'audio/wav' : 'audio/aac';
}

/**
 * Voice-note recording, over `expo-audio`.
 *
 * The recorder is created LAZILY, so a workspace that never turns voice
 * messages on pays nothing for them, and released on the way out — a recorder
 * left holding the microphone keeps the OS indicator lit.
 *
 * `expo-audio` is an OPTIONAL peer precisely so that a host which will never
 * enable voice messages is not forced to ship a microphone permission. The
 * host still needs `RECORD_AUDIO` (Android) / `NSMicrophoneUsageDescription`
 * (iOS) in its own manifest when it does.
 */
function useRecorder({
  strings,
  onError,
}: {
  strings: Strings;
  onError: (message: string) => void;
}): RecorderApi {
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const recorderRef = useRef<AudioRecorderish | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const meter = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopMeter = useCallback(() => {
    if (meter.current != null) {
      clearInterval(meter.current);
      meter.current = null;
    }
  }, []);

  /// Poll the recorder's own metering, which is dBFS.
  const startMeter = useCallback(() => {
    stopMeter();
    meter.current = setInterval(() => {
      const rec = recorderRef.current;
      if (rec == null) return;
      let db = -45;
      try {
        const status = rec.getStatus?.();
        if (typeof status?.metering === 'number' && Number.isFinite(status.metering)) {
          db = status.metering;
        }
      } catch {
        // A recorder that will not report is drawn as a quiet room.
      }
      // 0 is clipping and under about -45 is silence. Mapping the full -160
      // draws ordinary speech as a flat line along the bottom.
      const raw = Math.min(1, Math.max(0, (db + 45) / 45));
      setLevels((prev) => {
        // Ease toward the new level: raw metering jitters hard between reads
        // and drew a comb.
        const eased = prev.length === 0 ? raw : prev[prev.length - 1]! * 0.45 + raw * 0.55;
        return [...prev, eased];
      });
    }, LEVEL_INTERVAL_MS);
  }, [stopMeter]);

  const stopTicker = useCallback(() => {
    if (ticker.current != null) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
  }, []);

  const release = useCallback(() => {
    stopTicker();
    stopMeter();
    setPaused(false);
    setLevels([]);
    try {
      recorderRef.current?.release?.();
    } catch {
      // Releasing twice is not an error worth surfacing.
    }
    recorderRef.current = null;
    setRecording(false);
    setSeconds(0);
  }, [stopTicker, stopMeter]);

  useEffect(() => () => release(), [release]);

  const start = useCallback(async () => {
    if (recording) return;
    try {
      const audio = await loadExpoAudio();
      if (audio == null) {
        onError(strings.t('micFailed'));
        return;
      }
      const permission = await audio.requestRecordingPermissionsAsync();
      if (permission?.granted !== true) {
        onError(strings.t('micDenied'));
        return;
      }
      await audio.setAudioModeAsync?.({ allowsRecording: true, playsInSilentMode: true });
      // AAC in m4a: the container every channel accepts, so a voice message
      // sent from here needs none of the server-side rewrapping a browser
      // recording does.
      // A format with NO container index, so a take can be heard while it is
      // merely paused and talking can carry on afterwards. An m4a's index is
      // written on stop, so listening to one means ending it — which is
      // exactly the trap easylivechat_ui 0.1.69 climbed out of.
      //
      // iOS records linear PCM in a WAV; Android has no WAV recorder but does
      // have raw ADTS, which has no index at all. Both are accepted by the
      // upload whitelist and both are classified as audio on the way out.
      const rec = new audio.AudioModule.AudioRecorder(recordingOptions());
      await rec.prepareToRecordAsync();
      rec.record();
      recorderRef.current = rec;
      setRecording(true);
      setPaused(false);
      setSeconds(0);
      setLevels([]);
      startMeter();
      stopTicker();
      ticker.current = setInterval(() => {
        setSeconds((s) => Math.min(s + 1, MAX_RECORD_SECONDS));
      }, 1000);
    } catch {
      onError(strings.t('micFailed'));
      release();
    }
  }, [recording, onError, strings, stopTicker, release]);

  const cancel = useCallback(async () => {
    try {
      await recorderRef.current?.stop();
    } catch {
      // A recorder that already stopped is exactly what we wanted.
    }
    release();
  }, [release]);

  /** Stop listening, keep the take. The file stays open for `resume()`. */
  const pause = useCallback(async () => {
    if (!recording || paused) return;
    stopMeter();
    try {
      recorderRef.current?.pause();
    } catch {
      // A recorder that will not pause is one we can still stop to send.
    }
    setPaused(true);
  }, [recording, paused, stopMeter]);

  const resume = useCallback(async () => {
    const rec = recorderRef.current;
    if (rec == null || !paused) return;
    try {
      rec.record();
    } catch {
      onError(strings.t('micFailed'));
      return;
    }
    setPaused(false);
    startMeter();
  }, [paused, onError, strings, startMeter]);

  /**
   * The take so far, playable, WITHOUT ending it.
   *
   * Both recording formats are containerless by design (see the call site),
   * so the bytes on disk are already a complete, decodable stream — the uri
   * can simply be handed to a player while the recorder sits paused holding
   * the file. That is the whole reason the format changed.
   */
  const previewUri = useCallback((): string | null => {
    const uri = recorderRef.current?.uri;
    return uri != null && uri.length > 0 ? uri : null;
  }, []);

  const stopAndTake = useCallback(async (): Promise<ElcPickedFile | null> => {
    const rec = recorderRef.current;
    if (rec == null) return null;
    stopTicker();
    let uri: string | null = null;
    try {
      await rec.stop();
      uri = rec.uri ?? null;
    } catch {
      uri = null;
    }
    release();
    if (uri == null || uri.length === 0) return null;
    const name = uri.split('/').pop() ?? `voice-message.${takeExtension()}`;
    return { data: { uri }, filename: name, contentType: takeContentType() };
  }, [release, stopTicker]);

  return useMemo(
    () => ({
      recording,
      paused,
      seconds,
      levels,
      start,
      pause,
      resume,
      cancel,
      previewUri,
      stopAndTake,
    }),
    [recording, seconds, start, cancel, stopAndTake],
  );
}

interface AudioRecorderish {
  prepareToRecordAsync(): Promise<void>;
  getStatus?(): { metering?: number } | undefined;
  pause(): void;
  record(): void;
  stop(): Promise<void>;
  release?(): void;
  uri?: string | null;
}

interface ExpoAudioModule {
  /**
   * The recorder is only reachable through `AudioModule`.
   *
   * `expo-audio` exports `AudioRecorder` as a `declare class` — a TYPE, with
   * no runtime value behind it. Reaching for the top-level name compiles
   * (the module is imported through an `as unknown as` cast, so tsc never
   * sees the real shape) and is `undefined` at run time, which meant the
   * guard below rejected a perfectly good module and recording has never
   * worked in this SDK. `expo-audio`'s own `useAudioRecorder` builds one with
   * `new AudioModule.AudioRecorder(...)`; so do we.
   */
  AudioModule: { AudioRecorder: new (options: unknown) => AudioRecorderish };
  /** Used to play a paused take back before it is sent. */
  createAudioPlayer(source: unknown): unknown;
  RecordingPresets: { HIGH_QUALITY: unknown };
  requestRecordingPermissionsAsync(): Promise<{ granted: boolean }>;
  setAudioModeAsync?(mode: Record<string, unknown>): Promise<void>;
}

let expoAudio: ExpoAudioModule | null | undefined;

async function loadExpoAudio(): Promise<ExpoAudioModule | null> {
  if (expoAudio !== undefined) return expoAudio;
  try {
    const mod = (await import('expo-audio')) as unknown as ExpoAudioModule;
    expoAudio = typeof mod.AudioModule?.AudioRecorder === 'function' ? mod : null;
  } catch {
    expoAudio = null;
  }
  return expoAudio;
}

// ── built-in pickers (both optional peers) ────────────────────────────────

interface ImagePickerAsset {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}

async function pickFromLibrary(): Promise<ElcPickedFile | null> {
  try {
    const mod = (await import('expo-image-picker')) as unknown as {
      requestMediaLibraryPermissionsAsync(): Promise<{ granted: boolean }>;
      launchImageLibraryAsync(options: unknown): Promise<{
        canceled: boolean;
        assets?: ImagePickerAsset[] | null;
      }>;
    };
    const permission = await mod.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return null;
    const result = await mod.launchImageLibraryAsync({ quality: 0.85 });
    if (result.canceled) return null;
    const asset = result.assets?.[0];
    if (asset == null) return null;
    // A `{ uri }` reference, not bytes: RN's FormData streams it off disk, and
    // a 12MP photo read into a JS array first is how a picker crashes a
    // mid-range Android phone.
    return {
      data: { uri: asset.uri },
      filename: asset.fileName ?? asset.uri.split('/').pop() ?? 'image.jpg',
      contentType: asset.mimeType ?? undefined,
    };
  } catch {
    // Optional peer not installed, or the picker refused. A host without it
    // supplies `onPickAttachments` instead.
    return null;
  }
}

async function pickDocumentFile(): Promise<ElcPickedFile | null> {
  try {
    const mod = (await import('expo-document-picker')) as unknown as {
      getDocumentAsync(options: unknown): Promise<{
        canceled: boolean;
        assets?: Array<{ uri: string; name: string; mimeType?: string | null }> | null;
      }>;
    };
    const result = await mod.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled) return null;
    const asset = result.assets?.[0];
    if (asset == null) return null;
    return {
      data: { uri: asset.uri },
      filename: asset.name,
      contentType: asset.mimeType ?? undefined,
    };
  } catch {
    return null;
  }
}

function AttachMenu({
  visible,
  theme,
  strings,
  onClose,
  onPickImage,
  onPickFile,
}: {
  visible: boolean;
  theme: EasyLiveChatTheme;
  strings: Strings;
  onClose: () => void;
  onPickImage: () => void;
  onPickFile: () => void;
}): React.JSX.Element | null {
  const dir = useDirectionStyles();
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background }]}
          onPress={() => undefined}
        >
          {[
            { label: strings.t('attachImage'), onPress: onPickImage },
            { label: strings.t('attachFile'), onPress: onPickFile },
          ].map((row) => (
            <Pressable
              key={row.label}
              onPress={row.onPress}
              accessibilityRole="button"
              style={[styles.sheetRow, { flexDirection: dir.row }]}
            >
              <Text style={[{ color: theme.text, fontSize: 16 }, dir.textStart]}>{row.label}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8 },
  field: { flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  input: { fontSize: 15, maxHeight: 120, paddingVertical: 8 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sendCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  errorBanner: { paddingHorizontal: 16, paddingVertical: 8 },
  errorText: { color: ERROR_COLOR, fontSize: 12 },
  strip: { maxHeight: 80 },
  stripItem: { width: 56, height: 56, marginEnd: 8, marginBottom: 8 },
  pendingChip: {
    width: 56,
    height: 56,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  removeBadgeHit: {
    position: 'absolute',
    top: -12,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
  },
  recordDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#E11D48' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 8, paddingBottom: 28 },
  sheetRow: { paddingHorizontal: 20, paddingVertical: 16, alignItems: 'center' },
});
