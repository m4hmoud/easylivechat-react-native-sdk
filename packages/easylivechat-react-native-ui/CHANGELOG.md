# Changelog

All notable changes to `@easylivechat/react-native-ui` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.5] - 2026-09-29

### Fixed

- The recording waveform advanced in one-second lurches instead of scrolling.
  `useRecorder` returned its API through a `useMemo` whose dependency list left
  out `levels` and `paused`. A memo that omits a value it returns does not go
  stale so much as PIN that value, so although metering pushed a sample every
  60ms, the only listed dependency that moved during a take was the
  one-second clock — the waveform sat frozen for a second and then seventeen
  bars arrived at once. Nothing inside the waveform could have smoothed this:
  the samples were never handed to it. `paused` was pinned the same way, which
  is why tapping pause took up to a second to show the review UI and why the
  `pause`/`resume` callbacks were closed over a state that had already moved.
- The elapsed time did not match the waveform during playback, and drifted
  further the longer a take was reviewed. Two causes. The `m:ss` readout was a
  `setInterval` adding one per tick, and nothing stopped it when the microphone
  stopped — a paused take kept accruing seconds of audio it had not recorded.
  And the playhead was scaled by the player's reported `duration`, which these
  formats cannot supply mid-write: a WAV's data-chunk length is a placeholder
  until `stop()` patches it and ADTS carries no duration field at all, so the
  figure was zero or a guess off whatever bytes were on disk when the file was
  opened. The take is now measured off the clock across the runs the
  microphone was actually open, and that measurement is the timeline for both
  readouts; the player is asked only for `currentTime`, which is a sample
  count and is reliable.
- A paused take was drawn entirely dimmed until it had been played through to
  the end. The playhead fraction was 0 at rest, and that fraction is what dims
  the bars, so a perfectly good recording greyed out the moment you paused it.
- The waveform stuttered in Arabic and Kurdish while scrolling cleanly in
  English. The RTL branch wrapped the animated value in `Animated.multiply`,
  building a new animated node on every render — seventeen times a second,
  each one created and attached natively while the last was detached, so the
  transform was rebuilt out from under the running animation continuously. The
  sign lives on the value now and the transform is the same node in both
  directions. Each step also carries over whatever travel the previous one had
  not finished rather than discarding it, so a sample arriving early no longer
  jumps the run backwards.

## [0.1.4] - 2026-09-28

### Fixed

- The composer disappeared under the keyboard. `KeyboardAvoidingView` was inert
  on Android — `behavior` was undefined, which is RN's plain-`View` branch —
  and on iOS it derived the overlap from a parent-relative layout rect against
  a screen-absolute keyboard rect, so it was only correct when the screen began
  at window Y 0. Any host mounting the chat under a safe-area inset, a
  navigation header or a page sheet was short by that offset, and the bar is
  only ~60pt tall. The composer measures its own overlap in window coordinates
  now and pays exactly that, which is right wherever it is mounted and cannot
  double-avoid. This matches `easylivechat_ui`, which ships no keyboard widget
  at all because `MediaQuery.viewInsets` is already a window value.
- The voice-note send arrow did not mirror in right-to-left languages, so it
  pointed the opposite way to the text send arrow beside it. Flutter gets this
  free from `matchTextDirection`; these icons are drawn from Views and must opt
  in, which `SendIcon` now documents.
- Recording never worked. `expo-audio` exports `AudioRecorder` as a type with
  no runtime value, so the module guard rejected a working install and every
  attempt fell through to "microphone unavailable". The recorder is built from
  `AudioModule.AudioRecorder`, as `expo-audio`'s own `useAudioRecorder` does.
- Recording options were passed with nested `ios`/`android` blocks, which only
  `useAudioRecorder` flattens through a helper the package does not export.
  Handed to the constructor they were dropped, so iOS recorded AAC-in-MPEG-4
  into a file named `.wav` — defeating the containerless formats chosen so a
  paused take can be played. They are flat now.
- A voice note fell back to a download chip on its first failure, and the
  reason was swallowed by a bare `catch`. It now tries the local copy and then
  the remote url before giving up, as `voice_note_tile.dart` does, and every
  failure says which stage failed and why.

## [0.1.3] - 2026-09-14

Brings the RN SDK level with `easylivechat_ui` 0.1.69.

### Added

- **A recording can be reviewed before it is sent.** The composer offered one
  move — stop, which sent — so the only way to hear what you had said was to
  send it to someone. It now records against a live waveform of the
  microphone's own metering, pauses, plays back with a seek bar, carries on
  recording where it left off, and sends or bins the take: trash, play,
  waveform, mic, send.
- Listening to a take does not end it, and continuing really continues —
  `expo-audio` pauses and resumes the same file, so it is one recording and
  not two that would have to be merged.
- `TrashIcon`, still drawn from plain `View`s like the rest of the set.

### Changed

- **The recording format is now containerless**, which is what makes the
  review flow possible: an m4a's index is only written on stop, so a take
  could not be heard without ending it. iOS records linear PCM in a WAV;
  Android has no WAV recorder but does have raw ADTS (`.aac`), which has no
  index at all. Both are classified as audio on the way out, and the API's
  upload whitelist accepts both.
- **A voice note in the thread is the whole card**, with no bubble around it —
  it already rounds its own corners, so the bubble was a second card holding a
  first, in the full accent colour on the visitor's own side. A note WITH a
  caption keeps its bubble.
- The thread tile's seek bar is a waveform. Those bars are **decorative**: a
  real envelope means decoding the audio, so they are a stable fingerprint of
  the note's url. The composer's are real metering.
- One download per url, however many tiles ask for it — a message re-keys from
  its optimistic id to the server's and re-mounts the tile mid-download.

### Fixed

- The button that sends a recording is drawn as a send arrow, not a stop
  square. It has never stopped anything — `sendRecording()` puts the note
  straight in the thread — so the square asked people to commit to sending
  while showing them a pause. Its `accessibilityLabel` has read `sendVoice`
  the whole time; only the glyph disagreed. Matches `easylivechat_ui` 0.1.69.
  `StopIcon` stays exported: the icon set is public API.

## [0.1.2] - 2026-09-14

### Fixed

- **A voice note plays, and shows its length and a seek bar.** 0.1.1 gave it a
  play button that turned the note straight back into a download chip.
  `routes/uploads.ts` serves every upload as a single `200` carrying the whole
  body, with no `Accept-Ranges` and no handling of a `Range` header, and iOS
  plays remote media through `AVPlayer`, which reads an MP4/M4A `moov` atom by
  issuing byte-range requests — so the asset never loaded and the tile fell
  back to its chip. The same fault, and the same fix, as `easylivechat_ui`
  0.1.69 on the Flutter side.
- The file is fetched before it is played. A plain GET needs no ranges, so this
  works against the server as it stands — and it is what a voice note wants
  anyway: the **real duration** is on screen before anything is played instead
  of the words "voice message", and **dragging the seek bar works**, which over
  a server that cannot serve ranges was impossible. Recordings are cached under
  the cache directory, so scrolling back re-reads from disk.
- The seek bar has a thumb you can drag, and the elapsed time counts while it
  plays.

### Added

- `expo-file-system` as another OPTIONAL peer, used for that cache. Every Expo
  app already ships it; a host without it still gets playback, just streamed.

## [0.1.1] - 2026-09-14

### Fixed

- **Voice messages play in the thread.** The composer could record and send
  them from 0.1.0, but what came back rendered through the generic attachment
  path — `richTile` special-cased images and every other kind fell through to
  the download chip. A visitor's own recording appeared as a uuid with a
  download arrow beside it, and hearing it meant saving a file and leaving the
  chat. A voice note now gets a play button, a progress bar you can scrub and
  its running time; only one plays at a time, and the tile is keyed by url so a
  message arriving mid-listen does not restart it. Matches the fix in
  `easylivechat_ui` 0.1.68.
- Playback is lazy — nothing is fetched until play is pressed. A duration is
  only knowable by loading the file, so a thread of twenty notes would
  otherwise pull twenty audio files over the network purely to print their
  lengths.
- A host that never installed the optional `expo-audio` peer, or audio the
  device cannot decode, falls back to the download chip rather than a dead
  control — so the file is never unreachable.
- **`kmr` is Badini, not Kurmanji.** The six voice and microphone strings were
  written in Latin-script Kurmanji while the rest of that locale is
  Arabic-script Badini — which is what `kmr` means everywhere else in the
  product (`Kurdish (Badini)` in every picker), and what `bidi.ts`'s RTL set
  already assumed, so they were Latin sentences laid out right-to-left.

### Added

- `voiceMessage`, `playVoice` and `pauseVoice` chrome strings, in all 13
  locales, and `PlayIcon` / `PauseIcon` — still plain `View`s, the triangle
  drawn with borders.

## [0.1.0] - 2026-09-08

### Added

- First release: feature parity with the Flutter SDK
  (`easylivechat` 0.1.50 / `easylivechat_ui` 0.1.65).
- `EasyLiveChatLauncher`, `EasyLiveChatScreen` (phase router),
  `EasyLiveChatEndChatButton`, thread, composer, pre-chat form, post-chat
  survey, CSAT prompt, closed notice and full-screen image viewer.
- `SecureAsyncStorage`: the durable storage production apps should inject.
- 13-locale chrome strings with per-locale host overrides, and RTL that never
  touches `I18nManager.forceRTL`.
- Voice notes, attachments and the incoming-message chime, each behind an
  optional peer so a host pays only for what it enables.
- An icon set drawn from plain `View`s — no icon font, no SVG peer.
