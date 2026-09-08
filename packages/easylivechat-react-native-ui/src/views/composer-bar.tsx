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
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { deviceTextDirection, textDirectionOf } from '../bidi';
import { type Direction, type DirectionStyles, useDirectionStyles } from '../direction';
import { CloseIcon, MicIcon, PlusIcon, SendIcon, StopIcon } from '../icons';
import type { Strings } from '../l10n';
import type { ElcAttachmentPicker, ElcPickedFile } from '../picked-file';
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
      style={[
        styles.container,
        { backgroundColor: theme.background, borderTopColor: withAlpha(theme.text, 0.08) },
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

        {/* While the microphone is live there is nothing to type, so the bar
            stands in for the field and the only two things to press are
            discard and send. */}
        <View style={styles.field}>
          {recording ? (
            <RecordingBar
              seconds={recorder.seconds}
              theme={theme}
              strings={strings}
              dir={dir}
              onCancel={() => void recorder.cancel()}
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
        {!composerLocked ? (
          recording ? (
            <Pressable
              onPress={() => void sendRecording()}
              accessibilityRole="button"
              accessibilityLabel={strings.t('sendVoice')}
              style={styles.iconButton}
              hitSlop={6}
            >
              <View style={[styles.sendCircle, { backgroundColor: theme.primary }]}>
                <StopIcon color={onColor(theme.primary)} size={16} />
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

function RecordingBar({
  seconds,
  theme,
  strings,
  dir,
  onCancel,
}: {
  seconds: number;
  theme: EasyLiveChatTheme;
  strings: Strings;
  dir: DirectionStyles;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <View style={{ flexDirection: dir.row, alignItems: 'center' }}>
      <View style={styles.recordDot} />
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{ color: theme.text, marginHorizontal: 10, fontVariant: ['tabular-nums'] }}
      >
        {formatRecordDuration(seconds)}
      </Text>
      <Text
        numberOfLines={1}
        style={{ color: withAlpha(theme.text, 0.6), fontSize: 13, flexShrink: 1 }}
      >
        {strings.t('recordingVoice')}
      </Text>
      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel={strings.t('discardVoice')}
        style={{ marginStart: 'auto', padding: 6 }}
        hitSlop={8}
      >
        <CloseIcon color={withAlpha(theme.text, 0.6)} size={18} />
      </Pressable>
    </View>
  );
}

interface RecorderApi {
  recording: boolean;
  seconds: number;
  start(): Promise<void>;
  cancel(): Promise<void>;
  stopAndTake(): Promise<ElcPickedFile | null>;
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
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<AudioRecorderish | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTicker = useCallback(() => {
    if (ticker.current != null) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
  }, []);

  const release = useCallback(() => {
    stopTicker();
    try {
      recorderRef.current?.release?.();
    } catch {
      // Releasing twice is not an error worth surfacing.
    }
    recorderRef.current = null;
    setRecording(false);
    setSeconds(0);
  }, [stopTicker]);

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
      const rec = new audio.AudioRecorder(audio.RecordingPresets.HIGH_QUALITY);
      await rec.prepareToRecordAsync();
      rec.record();
      recorderRef.current = rec;
      setRecording(true);
      setSeconds(0);
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
    const name = uri.split('/').pop() ?? 'voice-message.m4a';
    return { data: { uri }, filename: name, contentType: 'audio/mp4' };
  }, [release, stopTicker]);

  return useMemo(
    () => ({ recording, seconds, start, cancel, stopAndTake }),
    [recording, seconds, start, cancel, stopAndTake],
  );
}

interface AudioRecorderish {
  prepareToRecordAsync(): Promise<void>;
  record(): void;
  stop(): Promise<void>;
  release?(): void;
  uri?: string | null;
}

interface ExpoAudioModule {
  AudioRecorder: new (options: unknown) => AudioRecorderish;
  RecordingPresets: { HIGH_QUALITY: unknown };
  requestRecordingPermissionsAsync(): Promise<{ granted: boolean }>;
  setAudioModeAsync?(mode: Record<string, unknown>): Promise<void>;
}

let expoAudio: ExpoAudioModule | null | undefined;

async function loadExpoAudio(): Promise<ExpoAudioModule | null> {
  if (expoAudio !== undefined) return expoAudio;
  try {
    const mod = (await import('expo-audio')) as unknown as ExpoAudioModule;
    expoAudio = typeof mod.AudioRecorder === 'function' ? mod : null;
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
