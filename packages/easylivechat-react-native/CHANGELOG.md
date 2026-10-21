# Changelog

All notable changes to `@easylivechat/react-native` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.6] - 2026-10-21

The first release on npm since 0.1.4: it includes everything listed under
0.1.5, which was never published.

### Added

- **Emails to the visitor.** The web widget's "Get the reply by email" next to
  0.1.5's "Email me this chat", over the same endpoints:
  `EasyLiveChat.instance.visitorEmail()` — `GET /:slug/visitor-email`, a
  `VisitorEmailState`: the address on the visitor's contact, masked
  (`j•••@example.com`) or null, `unsubscribed`, and whether each email is on
  offer — and `setVisitorEmail(email)` — `POST /:slug/visitor-email`, the
  address kept on the contact for a reply that comes after the visitor has
  left; resolves `{ emailHint }` (`VisitorEmailResult`), rejects
  `INVALID_EMAIL` (a blank one before the network) or `EMAIL_UNSUBSCRIBED`.
  Offer it while `replyEmailEnabled` is true — the store,
  `useReplyEmailEnabled()` and `ConfigResponse.replyEmailEnabled`, false from
  an older server. `RestClient.getVisitorEmail` / `postVisitorEmail`,
  `parseVisitorEmailState`.
- **Resume from an emailed link.** `resumeFromLink(link)` follows the "Reply
  in the chat" link in those emails: the email's `…#elc_chat=<token>`, our
  chat page's `…#resume=<token>`, or the bare token, its JWT shape checked as
  the widget's `readResumeToken` checks it. The token is traded over
  `POST /:slug/resume-link` for the visitor id that reaches the conversation,
  adopted as the widget's `adoptVisitorId` adopts it (the cached profile goes
  with the old id; an identity the host declared stays), and the ordinary open
  resumes the chat. Resolves true once that chat is the open session; false —
  never throwing, and changing nothing — for a link that is not ours
  (answered at once, with no request), a token the server refuses, or no
  network. A visitor identified with a `userId` only follows a link to the
  chat this device already holds: resumed under their verified identity,
  someone else's conversation would become theirs. Held until `boot()` when
  called before it (the deep link that launched the app); `reset()` drops a
  held one. `resumeLinkToken(url)` says synchronously whether a URL carries a
  token. `RestClient.postResumeLink`. The README shows the expo-router and
  React Navigation wiring.

### Changed

- `emailTranscript({ email })` takes an options object, as the Flutter SDK
  does; a plain string (0.1.5's spelling) still reads as `{ email }`. On the
  screen after the chat it, and `visitorEmail()`, reach the conversation that
  just ended with the token minted for it — without the re-mint that would
  resume, and so re-open, the closed chat.

### Deprecated

- **`setPushToken()` is a no-op.** Workspaces no longer hand us their Firebase
  credentials, so the SDK has no device to register: notifying your app's
  users is your own server's job, driven by the workspace's `message.created`
  webhook — for a reply from the team (`senderType` `AGENT` or `BOT`) whose
  `contact.userId` is set, send your own push to that user's devices. The
  signature stays so an app that calls it keeps compiling; nothing is sent and
  nothing is stored. `EasyLiveChatPush` likewise (`isSupported` is false). The
  README's "Notifications" has the recipe, signature check included.

### Removed

- The push registration plumbing: `RestClient.registerPush` /
  `unregisterPush`, `RegisterPushArgs`, the held and queued device token, and
  the unregister that an identity switch and `reset()` used to send.

## [0.1.5] - 2026-10-20

Never published to npm; released as part of 0.1.6.

What the web widget gained on 2026-10-17/18 that a visitor can see, over the
same protocol — no server changes.

### Added

- **Reactions.** `message.reactions` carries the visitor's view of a
  message's reactions — their own on the team's messages, the team's on
  theirs, never an agent's name — from history, `message:new` /
  `message:updated`, and live from `message:reactions` with the whole list
  after each change (`WidgetSocketHandlers.onMessageReactions`, optional).
  `EasyLiveChat.instance.react(messageId, emoji | null)` reacts to one of the
  team's messages over `message:react`, or takes the visitor's reaction back:
  shown at once, put back if the server refuses, the server's list taken as
  final; resolves whether it held, never rejects. One reaction per message, as
  on WhatsApp. `QUICK_REACTIONS` (the quick six every client offers),
  `reactionsOf`, `myReaction`, `toggledReaction` (a tap → set or take back),
  `canReactTo` (the team's messages, once the server has them),
  `groupReactions` (one chip per emoji, ❤ and ❤️ as one), `withMyReaction`,
  `sameEmoji`, `sameReactions`, `parseReactions`. An update that carries no
  list — an older server, a partial row — keeps the reactions on screen
  (`withReactionsFrom`); `[]` is the last one taken back. A reaction is not a
  message: no unread count, no `onMessage`.
- **Link previews.** `linkPreviewOf(message)` reads the preview the server
  made for a link in a message (`metadata.linkPreview`, usually on the
  `message:updated` a moment after the message) through a port of the shared
  parser: http(s) links only, the picture the server's own upload or https,
  every field one line and capped. `parseLinkPreview`, `isSafePreviewImage`,
  `previewHost`, `LINK_PREVIEW_LIMITS`. `WidgetConfig.linkPreviews` is the
  workspace's switch (on when an older server says nothing).
- **The widget's look.** `WidgetConfig.colorScheme` — `light`, `dark` or
  `auto` (follow the device); `light` when the server says nothing, so no
  look changes by itself — with `resolveColorScheme(choice, deviceDark)`.
  `WidgetConfig.launcherSize` (`small` | `medium` | `large`, `LAUNCHER_PX`
  48/56/64) and `launcherLabel` (the words beside the launcher's icon, one
  line, at most `LAUNCHER_LABEL_MAX` = 40).
- **The business's own closed notice.** `WidgetConfig.offlineInfoText` — the
  notice written in Settings → Availability, in the visitor's language, or
  undefined when none was written. It is what the closed/busy notice shows
  when set; `offlineMessage` stays the leave-a-message prompt it always was.
- **Waiting in the queue.** The `queue` store (`useQueueStatus()`) —
  `{ position, minutes, text }` while the visitor waits for a person, the
  text filled in by the server — from the session response (`queued`,
  `queuePosition`, `queueMinutes`, `queueInfoText`; `SessionResult.queue`)
  and `queue:update`. Cleared the moment anyone from the team is there —
  `conversation:assigned`, `queue:update { assigned }`, a team or assistant
  message, someone typing — as the widget's `leavesQueue` does; never carried
  to the next person on the device. `WidgetSocketHandlers.onQueueUpdate` /
  `onConversationAssigned` (optional), `parseQueueUpdate`.
- **Email me this chat.** `EasyLiveChat.instance.emailTranscript(email?)`
  over `POST /:slug/conversations/:id/transcript` — to `email`, or to the
  address the contact already has — resolving with where it went, masked
  (`TranscriptResult`). Rejects with the server's code: `NO_CONTACT_EMAIL`,
  `INVALID_EMAIL`, `EMAIL_UNSUBSCRIBED`, `TRANSCRIPT_RATE_LIMITED`. Offer it
  while `transcriptEmailEnabled` is true (the store, `useTranscriptEmailEnabled()`
  and `ConfigResponse.transcriptEmailEnabled`; false from an older server).
  `RestClient.postTranscript`.

### Changed

- `isSafeCardUrl` shares its http(s) check with link previews; what it
  accepts is unchanged.

## [0.1.4] - 2026-10-19

### Added

- **The AI assistant, as the SDK sees it.** The server has answered SDK
  visitors with the workspace's assistant since it shipped, through the same
  `/widgets` namespace as the web widget, but the SDK read none of what the
  widget reads about it:
  - `isFromAssistant(message)` — true only for replies the assistant wrote,
    read from the server's `metadata.assistant` (a literal `true`). Not every
    `bot` message: the workspace's automatic greeting is one too, and badging
    it "AI" in a workspace that never switched the assistant on was the bug
    `easylivechat` 0.1.52 fixed.
  - `assistantCovers` — whether the assistant answers a message sent right
    now, on `WorkspaceAvailability` and `ConfigResponse`, from `GET /config`
    and every `workspace:availability` push (false from an older server).
    While it does, "we're offline, leave a message" is untrue. On the client
    as the `EasyLiveChat.instance.assistantCovers` store, the
    `useAssistantCovers()` hook and `useWorkspaceAvailability().assistantCovers`.
  - Assistant typing — `agent:typing` with `actor: 'assistant'` is the
    assistant composing. `agentTyping` stays true for it, and the new
    `assistantTyping` store (`useAssistantTyping()`) says it is the assistant.
    It sends an explicit stop when its reply is ready, and a reply can take ten
    seconds, so it no longer falls to the 4-second clear meant for a person:
    the typing row used to vanish halfway through the wait. Its reply arriving
    also clears it; a 45-second backstop covers a stop lost to a dropped
    connection. `WidgetSocketHandlers.onAssistantTyping` (optional) receives
    it.
- **Background push for visitors.** `EasyLiveChat.instance.setPushToken(token,
  { platform: 'IOS' | 'ANDROID', appVersion? })` registers the device to tell
  when an agent replies while the app is closed, over the server's
  `POST /api/widget/:slug/push/register` (and `…/push/unregister`). The SDK
  brings no push dependency — hand it the FCM token your app already has.
  Call it as soon as you have one, even before `boot()`: a registration can
  only be authenticated with a session token, so it is held and sent the
  moment there is one (every session adoption and token re-mint retries a held
  or failed one). A new token moves the registration (the old one is dropped
  first, and a burst of rotations collapses to the right end state); `null`
  stops it. An identity switch drops the previous person's registration — with
  the stored widget token on a cold start — and `reset()` drops the visitor's;
  the device token is kept for the next person's session. Never rejects. The
  notification is always sent; suppress it in your own handler when the chat
  is on screen. `RestClient.registerPush` / `unregisterPush`, `PushPlatform`
  and `RegisterPushArgs` for the advanced surface. The registration's `locale`
  is `contentLocale ?? locale` — the code the server can match when it words
  "Sent a photo".
- **`clearIdentity()`** — the signed-in user signed out, without tearing the
  SDK down. A name/email-only identity is cleared (with the cached profile)
  and the visitor keeps their conversation; a visitor identified with a
  `userId` is forgotten, and a chat on screen restarts as an anonymous one.
  `reset()` remains the full logout.
- **Reply buttons.** `botButtonsOf(message)` reads the buttons under a
  message from the team — a bot flow's, or ones an agent added
  (`metadata.bot`: its own words and `{ id, label }` buttons) — and
  `EasyLiveChat.instance.answerButton(message, { buttonId, label })` answers
  one: the label goes as the visitor's own message with
  `reply: { messageId, buttonId }` beside it, so the server records the
  choice. `buttonsOpen(messages, id)` says whether the question is still open,
  `chosenButtonId` / `botReplyOf` which button was chosen. Draw the buttons'
  `text`, not `body`: the body repeats the words with a numbered menu for
  clients that predate buttons.
- **Quick replies.** `quickRepliesOnOffer(messages)` / `quickRepliesOf` — the
  greeting's and the assistant's one-tap answers, only under the newest
  message, as the web widget offers them.
- **Cards.** `messageCardsOf(message)` reads an agent's card, or a carousel of
  up to ten (`metadata.cards`); a card's buttons are links (`url`, http/https
  only — `isSafeCardUrl`, a regular expression rather than Hermes' `URL`) or
  replies (`reply`, answered with `answerButton` and the label `replyLabel`
  gives it, which names the card on a carousel). `parseMessageCard` cleans one.
- **Identity verification.** `identify({ ..., userId, userHash })` — `userId`
  is your app's own id for the signed-in user, `userHash` is
  `HMAC_SHA256(identitySecret, userId)` as hex, computed by YOUR backend (the
  secret never ships in the app). Both go as top-level `userId` / `userHash`
  keys on every `POST /session` — the silent resume as well as the start — and
  are omitted when blank. A workspace with verification off ignores them;
  optional verifies a correct hash and never refuses; enforced refuses a
  `userId` with a missing or wrong hash.
- **A typed refusal.** That 403 `{ error: 'IDENTITY_NOT_VERIFIED', reason }`
  is an `EasyLiveChatError` with the new `IDENTITY_NOT_VERIFIED` code and
  `reason` (`NO_SECRET` / `NO_HASH` / `BAD_HASH`, typed as
  `IdentityRejectionReason`), narrowed by `isIdentityNotVerified(e)`, with a
  message that says what to fix. It reaches `onError` and rejects
  `open()` / `startSession()`, and is never retried.
- **A different person never resumes the last one's chat.** The last
  identified `userId` is remembered on the device (`livechattools:identifiedUserId`,
  the web widget's key; cleared by `reset()`) and compared before every new
  session, the web widget's rule (`visitorChangeFor`): anonymous -> signed in
  keeps the conversation with the identity attached; a different `userId`, or
  an identity without one after one was set, forgets the stored visitor so the
  next person starts fresh. Call `identify()` on every launch before `open()`.
- **Help articles.** `searchHelp(q, { category?, limit? })`,
  `helpArticles({ category?, limit? })` (the top list), `getHelpArticle(id)`
  (also records the view, fire-and-forget) and `rateHelpArticle(id, helpful)`
  on the client — anonymous, after `boot()`. Typed `HelpArticleSummary`,
  `HelpArticle`, `HelpArticleList` (`enabled`, `categories`); unknown fields
  ignored. Views and answers are counted per visitor and app session, which is
  how the workspace's deflection count is judged. `parseHelpMarkdown` (the
  shared help dialect, as a tree — never HTML), `safeHelpHref`,
  `safeHelpImage` and `helpInlineText` are exported for hosts drawing their own.
- `WidgetConfig.helpArticlesEnabled` — the workspace's "Show help articles"
  switch; false from an older server.
- `RATE_LIMITED` (429) and `INVALID_PAYLOAD` error codes.
- Consent checkboxes in the pre-chat form. A workspace can ask the visitor to
  agree to something — its privacy notice, usually — before a chat starts. It
  arrives as a pre-chat field of the new type `'consent'`: `label` is the
  sentence the visitor agrees to (the tenant's own words, up to 500 characters
  — render it verbatim and let it wrap) and the new `PreChatField.policyUrl` an
  optional privacy-policy link. The link is checked with the server's own rule
  (`cleanPolicyUrl`, exported): only an `http:` / `https:` URL survives
  parsing, so a `javascript:` link never reaches `Linking`. A type this SDK
  does not know still reads as `'text'`, and `PostChatFieldType` does not gain
  `'consent'`.
- Opt-in: `EasyLiveChat.instance.supportsConsent` (default `false`, may be set
  before `boot`). The server leaves consent fields out of the config for a
  client that does not ask (`GET /config?caps=consent`), so a host's own
  pre-chat form keeps working on this release exactly as before, and never
  draws a text box labelled "I agree to…". The prebuilt
  `@easylivechat/react-native-ui` turns it on itself; a host with its own form
  turns it on once it renders consent fields.
- `startSession({ fields, consents })` (the new `PreChatSubmission`, a
  superset of `VisitorIdentity`) and `submitOfflineForm({ …, consents })` take
  the ids of the consent fields the visitor ticked — consent is never a
  `fields` value. With consent on and a pre-chat form shown, a new chat sends
  them with `capabilities: ['consent']`; a required one left unticked fails
  with the new `EasyLiveChatErrorCode.CONSENT_REQUIRED` and its `fieldId` —
  checked locally first, and decoded from the server's 400 like any other field
  error. Nothing about consent is declared over a form fetched without consent
  fields, for a host-identified visitor (who never saw the form), or for an
  anonymous start, so the server cannot demand a box nobody drew. An older
  server ignores both the query parameter and the body fields.
- `isConsentField`, `consentFieldsOf`, `validatePreChatConsent` and
  `validateConsents` (the server's own, ported) for a host's own form;
  `validatePreChatField` returns null for a consent field — it has no value to
  check. `RestClient.getConfig` takes `{ consent }`, `SessionArgs.consents` and
  `CONSENT_CAPABILITY` are exported for the advanced surface.

### Fixed

- `identify()` before `boot()` works as the identity docs always implied: the
  facade holds it and `boot()` applies it (it used to throw). The controller
  holds one that arrives while its own `boot()` is still reading storage, too
  — the ordinary un-awaited `boot(); identify(…)` pair judged the identity
  against a stored user id not yet read, so a DIFFERENT person looked like an
  anonymous visitor signing in and resumed the last one's conversation, and
  boot's profile read then clobbered the identity just declared.
- `open()` is single-flight: a call while one runs joins it, so two
  overlapping opens cannot start two sessions. A run that began before an
  identity switch is not joined — it belongs to the previous person — so the
  re-open after a switch still happens.

### Deprecated

- `EasyLiveChatPush`, the stub that said visitor push was impossible. Kept as
  an alias that forwards to `setPushToken` — `isSupported` is now true, and
  `registerDeviceToken(token, { platform })` registers (without a platform it
  rejects with a message saying so, rather than pretending to register).

Matches `easylivechat` 0.1.56.

## [0.1.3] - 2026-10-06

### Added

- An agent's edited or unsent reply follows on the visitor's screen. An agent
  may change or take back a reply for a few minutes after sending it.
  `ChatMessage.editedAt` (with `isEdited()`) carries when it was changed,
  parsed from `message:updated` and from history alike, and is undefined when
  absent or malformed rather than the epoch. The edit itself replaces the
  message by id, in place, with the new `body`, as `message:updated` already
  did. `parseOptionalDate` is exported alongside `parseDate`.
- The new `message:deleted` event (`{ id, conversationId }`): the unsent message
  leaves `messages` with no placeholder, Telegram-style, and comes off
  `unreadCount` if it was counted there. Nothing that lands late — the
  read-receipt `message:updated` the server fans out seconds after a reply, a
  `message:new`, a reconnect backfill page — brings it back.
- Unsent while away. A message unsent while the visitor was not listening
  (socket down, app suspended or closed) comes down too: the session open or
  restore, every page of history and the reconnect backfill now carry
  `unsentIds` (`SessionResult.unsentIds`, `MessagePage.unsentIds`, parsed by the
  exported `parseUnsentIds`; empty from an older server), and any of those
  messages is removed and remembered.
- `EasyLiveChat.instance.onMessageDeleted(fn)` and the `useOnMessageDeleted`
  hook, beside `onMessage` / `useOnMessage`: called with a `DeletedMessage`
  (`id`, `conversationId`) once per id, for the live event and for each id a
  history response lists the first time the session hears of it. Use it to
  withdraw a notification or anything else derived from the message;
  `messages` already drops it. `WidgetSocketHandlers.onMessageDeleted` receives
  the same object. Matches `easylivechat` 0.1.55.

## [0.1.2] - 2026-09-29

### Changed

- `open()` no longer costs three serial round trips before anything can be
  drawn. `boot()` is deliberately offline, so every request the first open
  needs is one the visitor waits through after tapping — and the first of them
  could not return anything. The resume probe is keyed on the visitor id, and
  on a genuine first open `boot()` minted that id moments earlier, so there was
  nothing on the server to find. It is now skipped whenever the id is freshly
  minted, and the flag is cleared as soon as a session exists under it so a
  reopen still resumes. The config load and the resume probe also run
  concurrently rather than one after the other: they are independent, and
  `open()` sets the final phase itself in either case. A first open pays one
  round trip where it used to pay three.

## [0.1.1] - 2026-09-28

### Fixed

- A message sent while the socket was down could sit on the sending clock for
  ever. `message:new` is live-only, so its echo is recovered by the reconnect
  backfill — which merged by id, and an id cannot match an optimistic row that
  has not been given one yet. The thread showed the message twice and told the
  visitor the copy the agent already had was still sending. The backfill now
  reconciles a server row against the pending row it belongs to, by the same
  body match the live echo uses. Nothing else rescued it: the 20s ack timeout
  is a `setTimeout` that does not run while the app is suspended, which is
  exactly when sockets drop, and firing it marks the row failed rather than
  sent. `easylivechat` has the same hole.

## [0.1.0] - 2026-09-08

### Added

- First release: feature parity with the Flutter SDK
  (`easylivechat` 0.1.50 / `easylivechat_ui` 0.1.65).
- Widget protocol client: `GET /config`, `POST /session` (mint + resume),
  `GET /messages`, `POST /offline-form`, feedback, post-chat survey,
  `POST /visitor/heartbeat` and `POST /api/uploads` with real upload progress.
- Socket.IO `/widgets` (full chat, JWT in `auth`) and `/widget-presence`
  (receive-only, pre-chat outreach) namespaces.
- `SessionController`: the phase state machine, optimistic send with FIFO
  echo reconciliation, gap-safe reconnect backfill, single-flight token
  re-mint, read-receipt watermark, session-boundary tracking and heartbeat.
- Reactive stores plus React hooks over `useSyncExternalStore`, safe to use
  before `boot()`.
- `EasyLiveChatPush` stub — background push is a documented non-goal.
