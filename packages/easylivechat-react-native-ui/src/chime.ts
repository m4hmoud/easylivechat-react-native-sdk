import { type ChatMessage, EasyLiveChat, isFromAgent } from '@easylivechat/react-native';

/**
 * The sound an arriving agent reply makes.
 *
 * The visitor is usually looking at something else in the host app when a
 * reply lands, so the thread updating silently means they simply miss it — the
 * web widget has always chimed here, down to the same audio file and the same
 * half volume.
 *
 * Only AGENT messages ring: not the visitor's own echoes, not bot greetings,
 * not SYSTEM transfer notices — matching the web widget exactly. The tenant's
 * `soundEnabled` / `soundUrl` config is honoured, so turning the sound off in
 * the dashboard turns it off here too, and a workspace that uploaded its own
 * chime hears that one instead of the bundled default.
 *
 * Mounting is REF-COUNTED: the launcher bubble and the chat screen can both be
 * alive at once, and a single subscription means a reply that arrives with
 * both on screen chimes ONCE rather than twice.
 */

/** Matches the web widget's `audioRef.volume = 0.5`. */
const VOLUME = 0.5;

/**
 * `expo-audio` is an OPTIONAL peer. A host that never wants a chime simply
 * does not install it, and everything below degrades to silence.
 */
interface AudioPlayerish {
  volume: number;
  seekTo(seconds: number): Promise<void> | void;
  play(): void;
  pause(): void;
  remove(): void;
}

interface ExpoAudioModule {
  createAudioPlayer(source: unknown): AudioPlayerish;
}

class Chime {
  private mounts = 0;
  private unsubscribe: (() => void) | null = null;
  private player: AudioPlayerish | null = null;
  private playerSource: string | null = null;
  private audioModule: ExpoAudioModule | null | undefined;

  /** Start listening. Call from an effect in any component that should chime. */
  attach(): void {
    this.mounts++;
    this.unsubscribe ??= EasyLiveChat.instance.onMessage((m) => this.handleMessage(m));
  }

  /** Stop listening once the last mounted component goes. */
  detach(): void {
    if (this.mounts > 0) this.mounts--;
    if (this.mounts > 0) return;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.releasePlayer();
  }

  /**
   * Whether this arrival should make a sound.
   *
   * Split out from the playback so the rule is testable without an audio
   * device: a chime is for someone ELSE reaching the visitor, which is the
   * agent and nothing else.
   */
  static shouldChime(message: ChatMessage, opts: { soundEnabled: boolean }): boolean {
    if (!opts.soundEnabled) return false;
    return isFromAgent(message);
  }

  private handleMessage(message: ChatMessage): void {
    const config = EasyLiveChat.instance.widgetConfig.get();
    // Config not loaded yet: the tenant default is sound ON, so ring rather
    // than swallow the first reply of a session.
    if (!Chime.shouldChime(message, { soundEnabled: config?.soundEnabled ?? true })) return;
    void this.play(config?.soundUrl);
  }

  private async play(soundUrl?: string): Promise<void> {
    // A chime is never worth an exception: no audio route, a codec the device
    // will not decode, a tenant sound URL that 404s — the reply still arrived
    // and the thread still shows it.
    try {
      const audio = await this.loadAudioModule();
      if (audio == null) return;
      const trimmed = soundUrl?.trim();
      const source: unknown =
        trimmed != null && trimmed.length > 0
          ? { uri: EasyLiveChat.instance.resolveUrl(trimmed) }
          : // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../assets/sounds/message.mp3');
      const key = trimmed != null && trimmed.length > 0 ? trimmed : '__bundled__';

      if (this.player == null || this.playerSource !== key) {
        this.releasePlayer();
        this.player = audio.createAudioPlayer(source);
        this.playerSource = key;
        this.player.volume = VOLUME;
      }
      const player = this.player;
      if (player == null) return;
      // Restart rather than overlap when replies arrive back to back.
      player.pause();
      await player.seekTo(0);
      player.play();
    } catch {
      // Deliberately swallowed.
    }
  }

  private async loadAudioModule(): Promise<ExpoAudioModule | null> {
    if (this.audioModule !== undefined) return this.audioModule;
    try {
      const mod = (await import('expo-audio')) as unknown as ExpoAudioModule;
      this.audioModule = typeof mod.createAudioPlayer === 'function' ? mod : null;
    } catch {
      // Optional peer not installed — silence is the correct degradation.
      this.audioModule = null;
    }
    return this.audioModule;
  }

  private releasePlayer(): void {
    try {
      this.player?.remove();
    } catch {
      // Releasing a player twice, or one whose native side is already gone, is
      // not an error worth surfacing.
    }
    this.player = null;
    this.playerSource = null;
  }
}

export const ElcChime = new Chime();
export const shouldChime = Chime.shouldChime;
