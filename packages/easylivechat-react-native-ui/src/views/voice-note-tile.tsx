import React, { useCallback, useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, Text, View } from 'react-native';

import type { DirectionStyles } from '../direction';
import { PauseIcon, PlayIcon } from '../icons';
import type { Strings } from '../l10n';
import { MAX_FONT_SCALE } from '../text-scaling';
import { withAlpha } from '../theme';

/**
 * A voice message you can listen to, with its length and a seek bar.
 *
 * ## Why the file is downloaded before it is played
 *
 * Handing the remote url straight to `expo-audio` does not work against this
 * API. `routes/uploads.ts` serves every upload as a single `200` carrying the
 * whole body, with **no `Accept-Ranges`** and no handling of a `Range` header.
 * iOS plays remote media through `AVPlayer`, which reads an MP4/M4A `moov`
 * atom by issuing byte-range requests; against a server that cannot answer
 * them the asset never loads, and the tile falls back to its download chip —
 * which is exactly what `easylivechat_ui` 0.1.68 did on the Flutter side
 * before the same fix landed there in 0.1.69.
 *
 * Fetching first sidesteps it (a plain GET needs no ranges) and is what a
 * voice note wants anyway: a **real duration before anything is played** — it
 * cannot be known without the file — and **seeking that works**, which over a
 * server that cannot serve ranges is impossible.
 *
 * `expo-file-system` is an optional peer, like `expo-audio`: every Expo app
 * already has it, and a host without it still gets playback, just streamed
 * (so on iOS, against this server, the chip).
 *
 * Only one note plays at a time, and the tile is keyed by url upstream, so a
 * message arriving mid-listen neither restarts nor re-downloads it.
 */
export function VoiceNoteTile({
  url,
  fg,
  strings,
  dir,
  background,
  fallback,
}: {
  /** Already resolved to an absolute URL by the caller. */
  url: string;
  /**
   * The bubble's text colour. Everything is drawn from it at varying alpha, so
   * one tile works on both the accent bubble the visitor's own messages get
   * and the neutral one an agent's arrive in.
   */
  fg: string;
  strings: Strings;
  dir: DirectionStyles;
  /**
   * The surface to paint, when this tile is the whole message and the bubble
   * behind it has been dropped. Undefined while it sits INSIDE a bubble (a
   * note with a caption), where it stays a translucent inlay instead.
   */
  background?: string;
  /** Shown when the audio cannot be fetched or decoded at all. */
  fallback: React.JSX.Element;
}): React.JSX.Element {
  const playerRef = useRef<AudioPlayerish | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const barWidth = useRef(0);
  const mounted = useRef(true);

  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(true);
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  /** Set while a finger is on the bar, so the thumb follows the drag. */
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  const stopTicker = useCallback(() => {
    if (ticker.current != null) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
  }, []);

  const pause = useCallback(() => {
    try {
      playerRef.current?.pause();
    } catch {
      // Losing the floor is never worth an exception.
    }
    stopTicker();
    if (mounted.current) setPlaying(false);
  }, [stopTicker]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopTicker();
      if (activePause === pause) activePause = null;
      try {
        playerRef.current?.remove();
      } catch {
        // Releasing twice is not an error worth surfacing.
      }
      playerRef.current = null;
    };
  }, [pause, stopTicker]);

  /**
   * Fetch the file and read its real length, before anything is pressed.
   *
   * Two stages, then give up — the shape `_prepare()` has in
   * `voice_note_tile.dart`. A local copy first, because only a real file can
   * be seeked and measured; then the remote url, because half a voice note
   * beats a download chip against a server that will not do byte ranges.
   * Falling straight to `fallback` on the first failure is what turned a
   * playable note into a file row.
   *
   * And every failure says why. This used to be a bare `catch {}`, so the one
   * thing anybody needed to know — WHICH stage failed and with what — was
   * thrown away, and a voice note silently became a file with no way to tell
   * a missing peer from a dead URL. Flutter keeps the reason for exactly this
   * reason; its CHANGELOG says losing it cost two releases.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const audio = await loadExpoAudio();
      if (audio == null) {
        console.warn(
          '[easylivechat] voice note: expo-audio is not installed, so audio cannot play',
        );
        if (!cancelled && mounted.current) {
          setFailed(true);
          setPreparing(false);
        }
        return;
      }

      const sources = [await localCopy(url), url];
      for (const source of sources) {
        try {
          const player = audio.createAudioPlayer({ uri: source });
          if (cancelled || !mounted.current) {
            try {
              player.remove();
            } catch {
              // Unmounted mid-load; nothing to keep.
            }
            return;
          }
          playerRef.current = player;
          const duration = await settledDuration(player);
          if (cancelled || !mounted.current) return;
          setTotal(duration);
          setPreparing(false);
          return;
        } catch (error) {
          console.warn(`[easylivechat] voice note: ${source} failed — ${String(error)}`);
        }
      }

      if (cancelled || !mounted.current) return;
      setFailed(true);
      setPreparing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  /**
   * Poll rather than subscribe: `expo-audio` has renamed its status event
   * across releases and this SDK supports a range of host versions. 200ms is
   * finer than a 4px bar can show anyway.
   */
  const startTicker = useCallback(() => {
    stopTicker();
    ticker.current = setInterval(() => {
      const player = playerRef.current;
      if (player == null || !mounted.current) return;
      const duration = numberOrNull(player.duration);
      if (duration != null && duration > 0) setTotal(duration);
      const current = numberOrNull(player.currentTime) ?? 0;
      setPosition(current);
      // Finished: rewind, so pressing play again replays instead of sitting at
      // the end doing nothing.
      if (duration != null && duration > 0 && current >= duration - 0.25) {
        try {
          player.pause();
          void player.seekTo(0);
        } catch {
          // Nothing left to rewind.
        }
        stopTicker();
        setPosition(0);
        setPlaying(false);
        return;
      }
      if (player.playing === false) {
        stopTicker();
        setPlaying(false);
      }
    }, 200);
  }, [stopTicker]);

  const toggle = useCallback(() => {
    const player = playerRef.current;
    if (failed || preparing || player == null) return;
    if (playing) {
      pause();
      return;
    }
    // Whatever else is talking stops first.
    if (activePause != null && activePause !== pause) activePause();
    activePause = pause;
    try {
      player.play();
      setPlaying(true);
      startTicker();
    } catch {
      setFailed(true);
      setPlaying(false);
    }
  }, [failed, pause, playing, preparing, startTicker]);

  const seekToFraction = useCallback(
    (fraction: number) => {
      const player = playerRef.current;
      if (player == null || total == null || total <= 0) return;
      const target = total * clamp(fraction, 0, 1);
      setPosition(target);
      try {
        void player.seekTo(target);
      } catch {
        // A seek the platform refused leaves the playhead where it was.
      }
    },
    [total],
  );

  if (failed) return fallback;

  const fraction =
    dragFraction ?? (total != null && total > 0 ? clamp(position / total, 0, 1) : 0);
  // Its length until it is played, then the elapsed time — the way every
  // messaging app reads. Only while the file is arriving is there neither.
  const label =
    total == null
      ? strings.t('voiceMessage')
      : formatDuration(position === 0 && dragFraction == null ? total : position);

  const bars = waveformOf(url);
  const fractionFor = (x: number): number => {
    const width = barWidth.current;
    if (width <= 0) return 0;
    // locationX is physical; the bars run the other way in RTL.
    return clamp((dir.row === 'row-reverse' ? width - x : x) / width, 0, 1);
  };

  return (
    <View
      style={{
        marginBottom: 4,
        alignSelf: dir.alignStart,
        flexDirection: dir.row,
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        // Standing alone it IS the bubble, so it paints the bubble's colour
        // and takes the bubble's corners. Inlaid in one (a note with a
        // caption) it stays a translucent panel on the surface behind it.
        borderRadius: background == null ? 10 : 16,
        backgroundColor: background ?? withAlpha(fg, 0.08),
      }}
    >
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={strings.t(playing ? 'pauseVoice' : 'playVoice')}
        hitSlop={8}
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: withAlpha(fg, 0.15),
          opacity: preparing ? 0.5 : 1,
        }}
      >
        {playing ? <PauseIcon color={fg} size={20} /> : <PlayIcon color={fg} size={20} />}
      </Pressable>

      <View style={{ width: 140, marginHorizontal: 10 }}>
        <View
          onLayout={(e: LayoutChangeEvent) => {
            barWidth.current = e.nativeEvent.layout.width;
          }}
          onStartShouldSetResponder={() => !preparing}
          onMoveShouldSetResponder={() => !preparing}
          onResponderGrant={(e) => setDragFraction(fractionFor(e.nativeEvent.locationX))}
          onResponderMove={(e) => setDragFraction(fractionFor(e.nativeEvent.locationX))}
          onResponderRelease={(e) => {
            const target = fractionFor(e.nativeEvent.locationX);
            setDragFraction(null);
            seekToFraction(target);
          }}
          onResponderTerminate={() => setDragFraction(null)}
          // Taller than the bar it draws: 4px is an impossible drag target,
          // 22 is a comfortable one.
          style={{ height: 22, justifyContent: 'center' }}
        >
          {/* A row-reverse row mirrors itself under RTL, so the fill grows
              from the leading edge in both directions with no arithmetic. */}
          <View style={{ flexDirection: dir.row, alignItems: 'center', height: 22 }}>
            {bars.map((level, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  marginHorizontal: 0.8,
                  height: 3 + level * 17,
                  borderRadius: 1.5,
                  backgroundColor:
                    (i + 0.5) / bars.length <= fraction ? fg : withAlpha(fg, 0.32),
                }}
              />
            ))}
          </View>
        </View>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            color: withAlpha(fg, 0.75),
            fontSize: 12,
            marginTop: 2,
            fontVariant: ['tabular-nums'],
          }}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

/**
 * The tile currently holding the floor. Module-level because the rule is "one
 * at a time" across the whole thread, not within one bubble.
 */
let activePause: (() => void) | null = null;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function numberOrNull(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** `m:ss`, built by hand — Hermes ships without full ICU. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Wait for the player to report a length.
 *
 * A freshly created player reports `0` until the file is parsed, and there is
 * no "ready" callback that is stable across `expo-audio` versions — so this
 * polls briefly and gives up rather than hanging the tile on a codec the
 * device cannot read.
 */
async function settledDuration(player: AudioPlayerish): Promise<number | null> {
  for (let i = 0; i < 50; i++) {
    const d = numberOrNull(player.duration);
    if (d != null && d > 0) return d;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/**
 * Bar heights for a voice note, derived from its url.
 *
 * **Decorative, not an amplitude envelope.** A true waveform means decoding
 * the audio to PCM, which needs a platform decoder this package deliberately
 * does not carry — so these bars are a stable fingerprint of the note's
 * identity, not a reading of its loudness. Two notes look different and one
 * note always looks the same; a quiet passage is not drawn short.
 *
 * The COMPOSER's waveform is real: there the microphone hands us levels.
 */
export function waveformOf(url: string, bars = 28): number[] {
  let h = 2166136261;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    // xorshift, so consecutive bars do not walk in a straight line.
    h ^= (h << 13) >>> 0;
    h >>>= 0;
    h ^= h >>> 17;
    h ^= (h << 5) >>> 0;
    h >>>= 0;
    out.push(0.18 + ((h % 1000) / 1000) * 0.82);
  }
  return out;
}

/** One download per url, however many tiles ask for it. */
const inFlight = new Map<string, Promise<string>>();

/**
 * Copy [url] into the cache directory and return a local uri, or fall back to
 * the remote url when `expo-file-system` is not installed.
 *
 * A message re-keys from its optimistic id to the server's, which re-mounts
 * the tile while the first download is still running, so two fetches of the
 * same note overlap routinely. Sharing the promise means the second caller
 * waits on the first rather than racing it into the same file — the fault
 * that cost the Flutter SDK two releases.
 */
function localCopy(url: string): Promise<string> {
  const existing = inFlight.get(url);
  if (existing != null) return existing;
  const fetch = fetchLocalCopy(url).finally(() => inFlight.delete(url));
  inFlight.set(url, fetch);
  return fetch;
}

async function fetchLocalCopy(url: string): Promise<string> {
  const fs = await loadFileSystem();
  if (fs?.cacheDirectory == null) return url;
  try {
    const dir = `${fs.cacheDirectory}easylivechat-voice/`;
    const info = await fs.getInfoAsync(dir);
    if (!info.exists) await fs.makeDirectoryAsync(dir, { intermediates: true });
    const target = `${dir}${cacheName(url)}`;
    const existing = await fs.getInfoAsync(target);
    if (existing.exists && (existing.size ?? 0) > 0) return target;
    const result = await fs.downloadAsync(url, target);
    return result?.uri ?? target;
  } catch {
    // A cache that will not cooperate is not a reason to refuse to play.
    return url;
  }
}

/**
 * The uploaded name is already a uuid, so it needs no hashing — only
 * stripping of anything unsafe in a path.
 */
function cacheName(url: string): string {
  const path = url.split('?')[0] ?? url;
  const last = path.split('/').filter(Boolean).pop() ?? 'voice';
  const safe = last.replace(/[^A-Za-z0-9._-]/g, '_');
  return safe.length === 0 ? 'voice' : safe;
}

interface AudioPlayerish {
  playing?: boolean;
  currentTime?: number;
  duration?: number;
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void> | void;
  remove(): void;
}

interface ExpoAudioModule {
  createAudioPlayer(source: unknown): AudioPlayerish;
}

interface FileInfoish {
  exists: boolean;
  size?: number;
}

interface ExpoFileSystemModule {
  cacheDirectory: string | null;
  getInfoAsync(uri: string): Promise<FileInfoish>;
  makeDirectoryAsync(uri: string, options?: { intermediates?: boolean }): Promise<void>;
  downloadAsync(uri: string, fileUri: string): Promise<{ uri: string } | undefined>;
}

let expoAudio: ExpoAudioModule | null | undefined;
let expoFileSystem: ExpoFileSystemModule | null | undefined;

async function loadExpoAudio(): Promise<ExpoAudioModule | null> {
  if (expoAudio !== undefined) return expoAudio;
  try {
    const mod = (await import('expo-audio')) as unknown as ExpoAudioModule;
    expoAudio = typeof mod.createAudioPlayer === 'function' ? mod : null;
  } catch {
    expoAudio = null;
  }
  return expoAudio;
}

async function loadFileSystem(): Promise<ExpoFileSystemModule | null> {
  if (expoFileSystem !== undefined) return expoFileSystem;
  try {
    const mod = (await import('expo-file-system')) as unknown as ExpoFileSystemModule;
    expoFileSystem = typeof mod.downloadAsync === 'function' ? mod : null;
  } catch {
    expoFileSystem = null;
  }
  return expoFileSystem;
}

/** Test seam — the module-level peer caches outlive a test. */
export function __resetVoicePlayback(): void {
  expoAudio = undefined;
  expoFileSystem = undefined;
  activePause = null;
  inFlight.clear();
}

/**
 * `.webm` is deliberately absent: the outbound media classifier
 * (`adapters/media-out.ts`) reads it as video, and the API rewraps a
 * browser-recorded audio `.webm` to `.ogg` on upload, so one arriving here
 * really is a video. A `.webm` that is audio-only still plays — it reaches
 * `richTile` carrying `kind: 'audio'` from its mime type.
 */
export function looksLikeAudio(url: string): boolean {
  const path = url.toLowerCase().split('?')[0] ?? '';
  return ['.m4a', '.mp3', '.ogg', '.oga', '.opus', '.aac', '.amr', '.wav'].some((ext) =>
    path.endsWith(ext),
  );
}
