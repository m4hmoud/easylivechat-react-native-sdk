# Changelog

All notable changes to `@easylivechat/react-native-ui` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.7] - 2026-10-19

Requires `@easylivechat/react-native` ^0.1.4 (identity verification, help
articles, consent fields, reply buttons and cards, and the AI assistant).

**Parity:** this matches `easylivechat_ui` 0.1.73 in full, the AI assistant's
display included — the "AI" badge and the assistant's name on its replies,
"Assistant is typing…", and the assistant's notices on the closed and busy
screens.

### Added

- **Cards, carousels, reply buttons and quick replies in the thread.** An
  agent's card draws as a card (image, title, text, buttons — links open in
  the visitor's browser), two or more as a row swiped sideways; a message's
  reply buttons (a bot's or an agent's) draw as chips under its own words —
  not as its numbered-menu body — live while the question is open, the chosen
  one filled; a card's reply buttons answer the same way; the greeting's and
  the assistant's quick replies draw under the newest message. Every tap sends
  once, however fast the second one comes — the guard is a ref, not state,
  which two taps inside one frame both read before React re-renders — and the
  chips wait, disabled, for the server. They also go dead the moment the
  workspace switches to "notice only" mid-chat. A card is 280 wide, or what
  the row leaves on a phone too narrow for that, and wears the team's bubble:
  surface, hairline and tail. Each run of its text — title, text, every
  button label — faces the way it reads. `MessageBubble` takes `quickReplies`,
  `onQuickReply`, `showButtons`, `chosenButtonId` and `onButton`; `ThreadView`
  wires them. New strings (`suggestedReplies`, `cards`) in all 13 languages.
- **The AI assistant says it is automated.** Its replies carry the
  assistant's name and an "AI" badge above the bubble — the accent on a tint
  of it, after the name in reading order in either direction — shown even when
  the workspace hides agent names: hiding a colleague's name is the tenant's
  choice to make, hiding that nobody is there is not. Only the assistant's own
  replies (`isFromAssistant`) are badged: the automatic greeting is a bot
  message too, and draws like any other message from the business. While the
  assistant composes, the typing row is announced as "Assistant is typing…"
  instead of "Typing…" — the row still follows `agentTyping`, and
  `assistantTyping` names it. While it covers a closed or busy workspace
  (`assistantCovers`), the notice says it can help in the meantime instead of
  "leave a message and we'll reply when we're back", and on the banner the
  tenant's leave-a-message copy gives way to it; the reopening time stays,
  because it is when a person is back. Four new strings in all 13 languages,
  worded as in `easylivechat_ui` and overridable like the rest: `aiBadge`,
  `assistantTyping`, `closedAssistantNotice`, `noAgentsAssistantNotice`.
- **Help articles.** When the workspace turns "Show help articles" on,
  `EasyLiveChatScreen` offers a "Browse help articles" row before the visitor
  has written (the chat, the pre-chat form and the closed notice). It opens
  search over the workspace's top articles (debounced; one character is still
  the top list), headed "Popular articles", with a clear button in the field,
  the number of results read out to a screen reader after each search
  ("Articles found: 3" — a live region on Android, an announcement on iOS), a
  labelled loading state, and its own "could not be loaded" with Retry. Then
  the article, "Was this helpful? Yes / No" — answered once per visit — and
  "Still need help? Start a chat" under the list and every article. An article
  that has been unpublished says "This article is no longer available." rather
  than that something broke. The help sits over the still-mounted chat, so a
  started draft survives. `showHelpArticles={false}` (also on the launcher)
  keeps it out.
- `EasyLiveChatHelpScreen` is the same as a screen of its own, for a host's
  Help tab: `onClose`, `onStartChat` — omitted, "Start a chat" turns the help
  screen into an `EasyLiveChatScreen` in place, as `easylivechat_ui` does —
  `onOpenLink` for article links, `showAppBar` (on by default; off, an article
  gets a "Back" of its own) and `initialArticleId`. `HelpView`, `ElcHelpApi`
  (the article source, for tests or a host's own cache) and
  `helpArticleDirection` are exported too.
- Article bodies are drawn natively by `HelpMarkdownView` from the shared help
  dialect — headings, paragraphs with line breaks, lists, quotes, code, bold,
  italic, links and images — with no HTML and no WebView; only
  http(s)/mailto:/tel: links and http(s) images ever become tappable or load.
  An article reads in its own language's direction: from its `locale` when the
  server sends one, else from its first strong character, else the screen's
  (`direction` on `HelpMarkdownView`); code stays left-to-right. Links go to
  `onOpenLink` when given, else `Linking`.
- 17 help strings in all 13 languages, worded as in the web widget and
  `easylivechat_ui`, under the same keys: `helpTitle`, `helpBrowse`,
  `helpSearchPlaceholder`, `helpSearchClear`, `helpTopArticles`,
  `helpResultsFound`, `helpLoading`, `helpLoadFailed`, `helpNoResults`,
  `helpArticleUnavailable`, `helpWasHelpful`, `helpYes`, `helpNo`,
  `helpFeedbackThanks`, `helpStillNeedHelp`, `helpStartChat`, `helpBack`.
- **Consent checkboxes.** A workspace's consent field draws as a checkbox with
  the tenant's sentence beside it — verbatim, start-aligned, wrapping however
  long it is (up to 500 characters) — and, when the field has one, a "Privacy
  policy" link under the sentence that opens in the visitor's browser through
  `Linking`, never inside the host app. The sentence is the checkbox's label,
  so tapping it ticks the box; the link sits outside that control as its own
  target and accessibility element, so opening the policy never ticks
  anything. A required box left unticked keeps the chat from starting and says
  "Please tick this box to continue" under it, cleared the moment it is
  ticked; the server's own `CONSENT_REQUIRED` lands on the same box. A consent
  is never sent as a field value: the ticked ids go as `consents`. The row is
  laid out with the chat's own direction, box at the start edge, in RTL too.
- The launcher and the chat screen set `EasyLiveChat.supportsConsent`, so
  their config asks for consent fields (`?caps=consent`). A server that has
  none, or predates them, sends none, and the form is what it was. Two new
  strings in all 13 languages: `privacyPolicy` and `consentRequired`.
- An identity refusal (`IDENTITY_NOT_VERIFIED`) on the pre-chat form shows the
  generic "something went wrong" to the visitor; the developer's message stays
  on `onError`.
- **Render tests.** The UI's components are now rendered in the test suite —
  the help screen, the image viewer, consent, cards, carousels, reply buttons,
  quick replies, ticks, "edited", voice notes, the recording waveform, links,
  the AI badge, the assistant's typing label and its closed and busy notices —
  ported from `easylivechat_ui`'s widget tests, against a rendering
  React Native stand-in with `@testing-library/react-native` (no Metro, no
  simulator). How it works: `test/README.md` at the workspace root.

### Changed

- `SecureAsyncStorage` keeps the identified user id in the keychain, beside
  the token and the profile — it is often an email or an account number — as
  `easylivechat_ui`'s `SecurePrefsStorage` does. One left in AsyncStorage by
  an earlier build is moved across on first read, and signing out clears both
  places.
- **The image viewer zooms on Android.** It zoomed through a `ScrollView`'s
  `maximumZoomScale`, which only iOS implements, so an Android visitor could
  not enlarge a picture at all. It now reads pinch, pan and double-tap from the
  responder system itself — the same on both platforms, with no new
  dependency: pinch zooms about the fingers and follows them, one finger pans
  while zoomed (never off the picture's edge), double-tap zooms 2.5× toward the
  point tapped and back out, and a tap on the backdrop leaves — but not while
  zoomed in, where a tap is how a pan ends. The × closes at any scale, and a
  picture that will not load says so instead of a black void. Matches
  `easylivechat_ui`'s viewer.

### Fixed

- **Nothing reached the keychain.** `expo-secure-store` throws on any key
  outside letters, digits, `.`, `-` and `_`, every key the core uses has a
  colon in it, and the throw was swallowed — so the session token and the
  visitor's cached profile were never stored, and the profile was gone on
  every cold start. Keys are mapped to names the secure store accepts
  (`secureStoreKey`).
- A bubble's tail sat on the wrong corner when the chat's direction differed
  from the app's — an Arabic chat in an English app had every team bubble
  pointing away from the team. `borderBottomStartRadius` follows the HOST's
  direction, not the chat's; corners are now written for the chat's
  (`logicalRadii`, `bubbleRadii`), on bubbles, cards and the typing row.
- The same host-versus-chat mix-up in spacing: the typing indicator's dots
  touched in that case, and the gaps beside a message's time, the composer's
  pause button and its attachment thumbnails opened on the wrong side; the
  remove × on a thumbnail took the wrong corner inside an app that is itself
  right-to-left.
- The chat app bar's back button had no accessibility label; it reads "Back"
  in the chat's language.
- A field error naming a field the form does not show — the tenant changed the
  form while the visitor was filling it in — now says something went wrong and
  re-reads the config, instead of highlighting nothing.
- `expo-file-system` is listed as external in the build, like every other
  optional peer.
- The README claimed `expo-crypto` was a required install. It is the
  recommended random source, wired by the host with `setUuidGenerator`, and
  not a dependency of this package.

## [0.1.6] - 2026-10-06

### Added

- "edited" beside the time. A message an agent changed after sending it says
  so in its meta row, in the time's own muted style, on the leading side of the
  time in either direction — translated into all 13 languages (`edited` in
  `src/l10n/strings.json`, overridable like every other string). An unsent
  message simply leaves the thread — one unsent while the app was away too.
  Requires `@easylivechat/react-native` ^0.1.3. Matches `easylivechat_ui` 0.1.72.

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
