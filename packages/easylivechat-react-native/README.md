# @easylivechat/react-native

Headless React Native client for [EasyLiveChat](https://livechattools.com)
real-time customer support: sessions, messages, attachments, typing, presence
and pre/post-chat forms over HTTP and Socket.IO.

**No UI, no JSX.** If you want prebuilt components, install
[`@easylivechat/react-native-ui`](../easylivechat-react-native-ui) instead — it
re-exports everything here, so you only need one package.

---

## Install

```sh
npx expo install @easylivechat/react-native expo-crypto
```

### Give it a random source — one line, and it matters

The `visitorId` must be a real v4 UUID: it is the only credential on the
presence namespace, and the key the server resolves the contact by. Do ONE of:

```ts
// Either — polyfills Web Crypto; the SDK finds it on its own.
import 'react-native-get-random-values';

// Or — inject explicitly, before boot().
import * as Crypto from 'expo-crypto';
import { setUuidGenerator } from '@easylivechat/react-native';
setUuidGenerator(Crypto.randomUUID);
```

Without either, the SDK warns loudly and falls back to `Math.random()`.

> The SDK deliberately does not `require('expo-crypto')` itself. Metro resolves
> `require` **statically**: a literal specifier would make an optional peer a
> hard build-time dependency for every host, and a computed one never resolves
> at runtime — which silently degrades every host to `Math.random()`. Injection
> has no bundler failure mode and lets you use whatever source you trust.

Targets **Expo SDK 52+** / **React Native 0.76+** (New Architecture) and React
18+.

## Quick start

```ts
import { EasyLiveChat } from '@easylivechat/react-native';

await EasyLiveChat.instance.boot(
  {
    apiBase: 'https://api.livechattools.com',
    tenantSlug: 'acme',
    contentLocale: 'en',
  },
  { storage: myDurableStorage },
);

// Optional: skip the pre-chat form for a user you already know. Add userId +
// userHash to verify who they are (see "Identity verification").
EasyLiveChat.instance.identify({ name: 'Jane', email: 'jane@example.com' });

// Start a new conversation, or resume the open one with its history.
await EasyLiveChat.instance.open();
EasyLiveChat.instance.sendMessage('Hi there');
```

`tenantSlug` is your workspace slug — the one in your dashboard URL
(`acme.livechattools.com`).

### Storage is required for production

The default is `InMemoryStorage`, which is **not durable**. If the `visitorId`
does not survive a cold start, every relaunch creates a new server-side contact
and orphans the visitor's prior conversations and CSAT.

`@easylivechat/react-native-ui` ships `SecureAsyncStorage`, which splits by
sensitivity (JWT + profile → `expo-secure-store`; visitorId + conversationId →
AsyncStorage). Or implement three methods yourself:

```ts
interface EasyLiveChatStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
```

Tokens are credentials — put them somewhere encrypted, not plain AsyncStorage.

## How it fits together

`EasyLiveChat.instance` is a singleton facade over a state machine. You drive
it with a handful of methods and render from its stores — it never calls into
your UI.

```
boot()  →  open()  →  [prechat] → chat → feedback
                          ↑                  │
                          └── endChat() ─────┘
```

| Store | Hook | Type | Use it for |
|---|---|---|---|
| `phase` | `useEasyLiveChatPhase` | `ChatPhase` | Which screen to show |
| `messages` | `useEasyLiveChatMessages` | `readonly ChatMessage[]` | The thread |
| `agentTyping` | `useAgentTyping` | `boolean` | Typing indicator — a person or the assistant |
| `assistantTyping` | `useAssistantTyping` | `boolean` | …and whether it is the assistant |
| `unreadCount` | `useUnreadCount` | `number` | Badge |
| `connection` | `useConnectionState` | `ConnectionState` | "Reconnecting…" |
| `widgetConfig` | `useWidgetConfig` | `WidgetConfig \| null` | Colours, copy, forms from the dashboard |
| `agentLastReadAt` | `useAgentLastReadAt` | `Date \| null` | Read ticks (see Read receipts) |
| `isOpen`, `visitorMode`, `assistantCovers`, … | `useWorkspaceAvailability` | one object | Whether the workspace is taking chats, and what to say if not |

`ChatPhase` is `idle`, `loading`, `resuming`, `prechat`, `chat`, `feedback`,
`offline`. `ConnectionState` is `disconnected`, `connecting`, `connected`,
`reconnecting`.

## React bindings

Every hook is **safe before `boot()`** — a launcher can mount first — and
re-subscribes automatically once the SDK boots, without the component
remounting.

```tsx
import {
  useEasyLiveChat,
  useEasyLiveChatMessages,
  useEasyLiveChatPhase,
  useWorkspaceAvailability,
} from '@easylivechat/react-native';

function Thread() {
  const chat = useEasyLiveChat();
  const messages = useEasyLiveChatMessages();
  const phase = useEasyLiveChatPhase();
  const { workspaceClosed, composerLocked } = useWorkspaceAvailability();
  // …
}
```

Hosts using Redux / Zustand / MobX can bind the stores directly instead —
`chat.phase`, `chat.messages`, `chat.unreadCount` … each exposes
`get()` / `subscribe(fn)`.

## Sending

```ts
const { optimistic, serverMessageId } = EasyLiveChat.instance.sendMessage('Hello');
```

Returns at once with a `SendResult`. Its `optimistic` message is already in
`messages`, so it renders immediately; `serverMessageId` resolves to the
server's id when the send is acknowledged (bounded at 20 seconds). A send that
fails is marked `failed` rather than vanishing — `resend(message)` retries it.
`receiptFor(message, agentLastReadAt)` turns all of that into the bubble's
state (see Read receipts).

Attachments are two steps: upload, then send the returned URL.

```ts
const file = await EasyLiveChat.instance.uploadBytes({
  data: { uri: picked.uri }, // streamed off disk; a Blob / ArrayBuffer works too
  filename: picked.name,
  contentType: picked.mimeType,
  onProgress: (p) => setProgress(p), // 0..1
});
EasyLiveChat.instance.sendMessage('', { attachmentUrls: [file.url] });
```

`file.url` is server-relative; `resolveUrl()` makes any `/uploads/…` path
loadable.

## History

`open()` gives you the current visit. A returning customer's earlier visits sit
behind a cursor rather than landing on screen — so ask, don't assume:

```ts
if (EasyLiveChat.instance.hasOlderHistory) {
  const page = await EasyLiveChat.instance.loadOlderMessages();
}
```

`hasOlderHistory` is the only reliable signal: a scoped first page cannot be
told from a complete one by looking at what arrived. A brand-new conversation
reports `false`.

## Message events

`chat.messages` is the thread as it stands; two subscriptions tell you what
happened to it, for anything you derive from messages yourself (a notification,
a preview, a copy in your own store). Both return their unsubscribe, can be
taken before `boot()`, and have hooks:

```ts
const off = EasyLiveChat.instance.onMessage((m) => { /* a new message arrived */ });

const offDeleted = EasyLiveChat.instance.onMessageDeleted(({ id, conversationId }) => {
  // An agent unsent this message.
  notifications.cancelFor(id);
});

// In a component:
useOnMessage(onNew);
useOnMessageDeleted(onDeleted);
```

An agent may edit or unsend a reply for a few minutes after sending it. An edit
replaces the message in `messages` by id, in place, with the new `body` and
`editedAt` set (`isEdited(message)`) — show "edited" beside the time. An unsent
message leaves `messages` with no placeholder, and `onMessageDeleted` fires once
per id: for the live event, and for every id a history response lists as
unsent the first time the session hears of it — so a message unsent while the
app was closed still comes down, and the callback can name one this device only
ever saw as a push notification.

## Forms

Both forms are authored in the dashboard and arrive in `widgetConfig` — render
`preChatForm.fields` yourself, then:

```ts
await EasyLiveChat.instance.startSession({ fields: { order_id: '123' } });
```

Values are keyed by field **id**. `validatePreChatField(field, value)` mirrors
the server's rules, so you can pre-validate for UX; a field the server refuses
fails with its code (`REQUIRED`, `INVALID_EMAIL`, …) and `fieldId`.

### Consent checkboxes

A workspace can add consent checkboxes to its pre-chat form (a field of type
`'consent'` — `consentFieldsOf(form)` lists them): `label` is the sentence the
visitor agrees to (tenant copy, up to 500 characters — render it verbatim and
let it wrap) and `policyUrl` an optional `http(s)` privacy-policy link to open
outside the app. The server only sends them to a client that says it can draw
them, so a form of your own opts in, and passes the ticked ids — consent is
never a `fields` value:

```ts
EasyLiveChat.instance.supportsConsent = true; // before open()
await EasyLiveChat.instance.startSession({
  fields: { name: 'Ada' },
  consents: ['privacy'], // the consent field ids the visitor ticked
});
```

A required one left unticked fails with `CONSENT_REQUIRED` and its `fieldId`,
like any other field error (`validateConsents(form, ticked)` checks it up
front). The prebuilt `@easylivechat/react-native-ui` form does all of this
itself.

### After the chat

`endChat()` resolves `true` when a post-chat step should follow — keep the chat
on screen for it — and `false` when there is nothing left to show. Render
`postChatForm` (or, when it has no fields, the built-in rating) and submit:

```ts
await EasyLiveChat.instance.submitPostChat({ rating: '5' }); // keyed by field id
await EasyLiveChat.instance.submitFeedback({ rating: 5, comment: 'Quick!' });
```

Both are one-shot: an already-answered survey resolves normally, and a second
rating rejects with `ALREADY_RATED` (the prompt is not offered again either
way). Outside the chat, `submitOfflineForm({ name, email, message })` leaves a
message for the team.

## The `identify` / `reset` contract

```ts
// Before open(): skips the pre-chat form and starts as this person. May be
// called before boot() — it is held and applied once boot has run.
EasyLiveChat.instance.identify({ name, email, phone, fields: { plan: 'pro' } });

// Your user signed out, the SDK stays booted.
EasyLiveChat.instance.clearIdentity();

// Your app's full LOGOUT path.
await EasyLiveChat.instance.reset({ storage });
```

- **`identify()` is authoritative**, not a merge. Anything you no longer supply
  is *cleared*, so a previous user's email cannot leak out of secure storage
  into the new session.
- **`clearIdentity()`** drops the identity and the cached profile without
  tearing anything down. A name/email-only visitor keeps their visitorId and
  conversation, as an anonymous visitor would; one identified with a `userId`
  is forgotten (a fresh visitorId, nothing to resume), because the next person
  on the device may be someone else.
- **`reset()` is not `shutdown()`.** `shutdown()` only clears memory; the
  durable `visitorId` survives it, so the next `boot()` resolves the *same*
  contact and resumes the *same* conversation. That is right for a returning
  customer and wrong for a signed-out one — on a shared device (a restaurant
  tablet, a POS terminal) the next person would inherit the last one's
  identity. `reset()` drops every identity key, and the device's push
  registration for that visitor, and works even when the SDK was never booted
  this session, which is the common case for a logout that never opened the
  chat.
- The transcript is **not** deleted. This abandons the identity, not the
  history.

## Identity verification

When the workspace verifies identities (Settings -> AI assistant -> "Know who
is signed in"), pass your own user id and the hash YOUR BACKEND made of it —
never ship the secret in the app:

```ts
// Your backend: userHash = hex(HMAC_SHA256(identitySecret, userId))
const { userId, userHash } = await myBackend.chatIdentity();
EasyLiveChat.instance.identify({ name, email, userId, userHash });
await EasyLiveChat.instance.open();
```

Both are sent on every session call. A workspace that ENFORCES verification
refuses a missing or wrong hash with a typed error:

```ts
import { isIdentityNotVerified } from '@easylivechat/react-native';

EasyLiveChat.instance.onError((e) => {
  if (isIdentityNotVerified(e)) console.warn('identity refused:', e.reason); // NO_SECRET | NO_HASH | BAD_HASH
});
```

**Declare the identity on every launch, before the chat opens.** A different
`userId` on this device (or an identity without one after one was set, or a
chat opened with none) starts a fresh visitor, so the next person never resumes
the last one's conversation; an anonymous visitor who signs in keeps theirs.
Anonymous visitors are never refused.

## The AI assistant

A workspace can answer visitors with its AI assistant, over the same
connection as everyone else. Three things tell your UI about it:

```ts
import { isFromAssistant, useAssistantTyping, useWorkspaceAvailability } from '@easylivechat/react-native';

// A reply the assistant wrote — say so beside it. Only replies the server
// marks (`metadata.assistant`); the automatic greeting is not one.
isFromAssistant(message);

// The typing row: `useAgentTyping()` is true for anyone composing, this says
// it is the assistant ("Assistant is typing…"). It holds until the reply
// lands — a reply can take ten seconds, far past a person's 4-second clear.
const assistantTyping = useAssistantTyping();

// While the assistant answers messages, "we're closed, leave a message" is
// untrue: say it can help in the meantime instead.
const { workspaceClosed, assistantCovers } = useWorkspaceAvailability();
```

The same values are on the facade as stores: `assistantTyping` and
`assistantCovers`.

## Cards and quick replies

An agent can send a card — an image, a title, a short text and buttons — and a
greeting, a bot flow or the assistant can offer one-tap answers. All of them
arrive on ordinary messages with a plain-text `body` fallback, so a UI that
ignores them still shows something sensible.

```ts
import {
  botButtonsOf,
  buttonsOpen,
  messageCardsOf,
  quickRepliesOnOffer,
  replyLabel,
} from '@easylivechat/react-native';

// One card, or a carousel of up to ten. Draw them INSTEAD of body + attachments.
for (const card of messageCardsOf(message)) {
  // card.imageUrl may be /uploads/…: resolveUrl(it). Each button is a link
  // (button.url, http/https only) or a reply (button.reply, its id).
}

// Reply buttons under a message, while the question is still open.
const bot = botButtonsOf(message);
if (bot && buttonsOpen(messages, message.id)) {
  // Draw bot.text (not body — it repeats the words with a numbered menu).
  // A tap: EasyLiveChat.instance.answerButton(message, { buttonId: b.id, label: b.label });
  // A card's reply button: label = replyLabel(message, button.reply, button.label).
}

// Quick replies: only the newest message offers them, until anyone says more.
const offer = quickRepliesOnOffer(messages);
// offer?.replies under the message offer.messageId; a tap is sendMessage(reply).
```

## Help articles

```ts
const config = EasyLiveChat.instance.widgetConfig.get();
if (config?.helpArticlesEnabled) {
  const { articles } = await EasyLiveChat.instance.searchHelp('refund'); // ranked, no AI key
  const top = await EasyLiveChat.instance.helpArticles();                 // the workspace's order
  const article = await EasyLiveChat.instance.getHelpArticle(articles[0].id); // records the view
  await EasyLiveChat.instance.rateHelpArticle(article.id, true);
}
```

`article.body` is markdown in the help dialect — draw it from
`parseHelpMarkdown(article.body)`, never as HTML (the UI package's
`HelpMarkdownView` does).

## Push notifications

A reply that lands while your app is closed can ring the visitor's phone. Hand
the SDK the Firebase (FCM) token your app already receives — the server sends
through FCM on iOS too:

```ts
import messaging from '@react-native-firebase/messaging';
import { Platform } from 'react-native';

const token = await messaging().getToken();
await EasyLiveChat.instance.setPushToken(token, {
  platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
  appVersion: '2.4.0', // optional
});
```

The SDK adds no push dependency of its own, so your project keeps one Firebase
setup and one permission prompt. Call it as soon as you have a token — before
`boot()` or before the visitor has opened a chat is fine, and the normal case:
the registration is held until there is a session to authenticate it with.
Call it again when the token rotates (the old registration is dropped first),
and pass `null` to stop. An identity switch, `clearIdentity()` for a
`userId`-identified visitor and `reset()` drop the previous person's
registration by themselves; the token itself is kept for the next person's
session.

The notification is always sent. Nothing is suppressed server-side, because a
connected socket is not a person looking at the screen — skip it in your own
foreground handler when the chat is already on screen:

```ts
messaging().onMessage(async (m) => {
  if (m.data?.type === 'visitor.message' && chatIsVisible) return;
  // …otherwise show it yourself.
});
```

`data` carries `type`, `conversationId`, `messageId` and `tenantId`, so a tap
can open the right conversation (`EasyLiveChat.instance.open()`).

> `EasyLiveChatPush` — the stub earlier versions shipped while push was not
> possible — is kept as a deprecated alias that forwards to `setPushToken`.

## Errors

Failures surface on a subscription rather than throwing out of the calls above,
so a dropped network never crashes a render:

```ts
EasyLiveChat.instance.onError((e) => console.warn(String(e))); // or useOnError(fn)
```

Token expiry, reconnects and re-mints are handled internally. Every error is an
`EasyLiveChatError` with a `code` (`EasyLiveChatErrorCode`), a `fieldId` for a
form field, and `httpStatus` when the server answered. A refused identity claim
is `isIdentityNotVerified(e)`, with the server's `reason`. The calls a host
awaits for an answer — `open()`, `startSession()`, the forms, uploads, help —
also reject with the same typed error.

## System messages

Transfer and session notices arrive as messages with `senderType === 'system'`
carrying a structured `metadata.i18n` key instead of baked-in copy, so you can
render them in the visitor's language: `systemI18nKey(message)` and
`systemI18nParam(message, 'name')`. Render the key if you have a translation,
and fall back to `body`.

## Re-localizing

`boot()` on an already-booted instance **adopts the new config** rather than
returning early, so re-boot whenever your app language changes:

```ts
await EasyLiveChat.instance.boot({ ...config, contentLocale: 'ckb' });
```

`locale` and `contentLocale` are two different things:

| field | what it is | who reads it |
|---|---|---|
| `locale` | free-form; a readable language **name** is fine | agents, in the dashboard |
| `contentLocale` | a language **code** (`en`, `ar`, `ckb`, `kmr`) | the server, to pick the translation of the tenant's own copy |

This package holds no user-facing strings of its own; chrome strings live in
`@easylivechat/react-native-ui`.

## Read receipts

Two mechanisms, both needed. Render from the one rule rather than re-deriving:

```ts
import { receiptFor } from '@easylivechat/react-native';

const receipt = receiptFor(message, chat.agentLastReadAt.get());
// 'pending' | 'sent' | 'read' | 'failed' | null
```

There is deliberately no `delivered` state: other channels get that from a
provider webhook, but a message to an SDK visitor is stored by our own server,
so "stored" and "delivered" are the same instant.

Call `markRead()` while the thread is on screen — it clears the local badge
**and** tells the server, which is what turns the agent's ticks green.

## Troubleshooting

**"EasyLiveChat.boot() must be called before use."** An action (`open()`,
`sendMessage()` …) ran before `boot()` resolved. Await it during startup.
`identify()`, `clearIdentity()`, `setPushToken()`, `supportsConsent`, the
`on…` subscriptions, the stores and the hooks are safe before boot.

**The visitor is new on every launch.** You are on `InMemoryStorage` — see
Storage above.

**The visitor is new on every launch, and you use `userId`.** `identify()` is
not being called before the chat opens on each launch, so the SDK reads the
launch as a sign-out. Declare the identity every time.

**Nothing arrives after a reconnect.** The client backfills on reconnect; if
you also cache messages yourself, reconcile on message `id` rather than
appending.

**Tenant copy is in the wrong language after a language switch.** `boot()` is
safe to call again with a new config — it adopts the change rather than
ignoring it.

**The typing row disappears while the assistant is still answering.** Read
`useAgentTyping()` and `useAssistantTyping()` from this version; anything that
clears the row on a timer of its own reintroduces the bug.

## Limitations

- **Agent-side features are out of scope.** This is the visitor SDK.
- **Web is not supported.** The web product is the embeddable widget (a script
  tag).
- **`customCss` is a no-op.** It is parsed off the wire and ignored — raw CSS
  cannot map to React Native styles. Theme via the UI package's
  `themeOverride`.

## Server

Talks to an EasyLiveChat workspace over the same anonymous widget protocol as
the web widget and the Flutter SDK, and needs no server changes. Create a
workspace at [livechattools.com](https://livechattools.com).

## License

MIT
