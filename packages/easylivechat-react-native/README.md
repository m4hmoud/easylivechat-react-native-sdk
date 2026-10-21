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
| `transcriptEmailEnabled`, `replyEmailEnabled` | `useTranscriptEmailEnabled`, `useReplyEmailEnabled` | `boolean` | Whether to offer the two emails (see Emails to the visitor) |

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
  identity. `reset()` drops every identity key, and works even when the SDK
  was never booted this session, which is the common case for a logout that
  never opened the chat.
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

## Reactions

The visitor can react to the team's messages — one emoji per message, as on
WhatsApp: another replaces theirs, the same one takes it back — and sees the
team's reactions on their own messages. Never an agent's name: the server sends
only the visitor's view.

```ts
import {
  QUICK_REACTIONS, // ['👍', '❤️', '😂', '😮', '😢', '🙏'], the quick row on every client
  canReactTo,
  groupReactions,
  reactionsOf,
  toggledReaction,
} from '@easylivechat/react-native';

// Chips under a bubble: one per emoji, `mine` for the visitor's own.
for (const chip of groupReactions(reactionsOf(message))) {
  // chip.emoji, chip.count, chip.mine
}

// A tap on 👍 under one of the team's messages — sets it, or takes it back.
if (canReactTo(message)) {
  await EasyLiveChat.instance.react(message.id, toggledReaction(message, '👍'));
}
```

`react()` shows the change at once and puts it back if the server refuses
(resolving `false`; it never rejects). Reactions arriving from the team — or
from the visitor's other device — land on `message.reactions` by themselves,
live (`message:reactions`); a reaction is not a message, so it moves no unread
count and fires no `onMessage`.

## Link previews

When a message carries a link the server fetches the page once and stores a
preview on the message, usually a moment after it arrives
(`message:updated`). Read it — checked — with `linkPreviewOf`:

```ts
import { linkPreviewOf } from '@easylivechat/react-native';

const preview = config?.linkPreviews !== false ? linkPreviewOf(message) : null;
// preview.url (http/https only), preview.title, preview.description?,
// preview.siteName, preview.imageUrl? (an /uploads/… path: resolveUrl it).
```

Everything in a preview was written by a stranger's page: it is text, capped
in length, and the picture is the server's own upload or https. A card message
never has one.

## Light and dark

`widgetConfig.colorScheme` is the workspace's choice: `light`, `dark`, or
`auto` — follow the device. A server older than the setting sends nothing,
which reads as `light`.

```ts
import { resolveColorScheme } from '@easylivechat/react-native';
import { useColorScheme } from 'react-native';

const scheme = resolveColorScheme(config.colorScheme, useColorScheme() === 'dark');
```

The UI package derives the dark palette from your workspace's colours the way
the web widget does; the launcher's `launcherSize` and `launcherLabel` come
with the same config.

## Waiting in the queue

While the visitor waits for a person, `queue` says where they stand — place,
an estimate in minutes, and the workspace's own notice with both already
filled in by the server, in the visitor's language. It is a notice above the
conversation, never a screen of its own, and it clears itself the moment
anyone from the team is there: the chat assigned, a team message, someone (or
the assistant) typing.

```ts
const queue = useQueueStatus(); // or EasyLiveChat.instance.queue
if (queue) {
  // queue.text — verbatim; queue.position (0 = unknown); queue.minutes (0 = unknown)
}
```

## Emails to the visitor

The web widget's two emails, over the same endpoints. Offer each only while its
switch is on in the workspace — `transcriptEmailEnabled` and
`replyEmailEnabled` (stores, `useTranscriptEmailEnabled()` /
`useReplyEmailEnabled()`, and on `ConfigResponse`; false from an older server).
Addresses come back masked, `j•••@example.com`: the device may not be the
visitor's own. All three need a conversation, and reject `NO_TOKEN` before
there is one.

**Email me this chat** — this conversation, or, on the screen after the chat,
the one that just ended:

```ts
const { emailHint } = await EasyLiveChat.instance.visitorEmail(); // null: none on file

await EasyLiveChat.instance.emailTranscript();                            // to the address on file
const { sentTo } = await EasyLiveChat.instance.emailTranscript({ email: 'jo@example.com' });
```

It rejects with the server's code: `NO_CONTACT_EMAIL` (no address given and
none on file — ask for one), `INVALID_EMAIL`, `EMAIL_UNSUBSCRIBED`,
`TRANSCRIPT_RATE_LIMITED`.

**Get the reply by email** — ask once the visitor has written while nobody can
answer (you are closed, they are waiting in the queue, or nobody is
accepting), and only when `visitorEmail()` found no address:

```ts
const { emailHint } = await EasyLiveChat.instance.setVisitorEmail('jo@example.com');
```

The address goes on the visitor's contact. If they have left by the time the
team answers, the reply is emailed to them with a **Reply in the chat** link
back into the conversation (see Resume from an emailed link). It rejects with
`INVALID_EMAIL` or `EMAIL_UNSUBSCRIBED`. An identity-verified visitor keeps
the address already on file; the answer then names that one.

The UI package draws both, by the widget's rules.

## Resume from an emailed link

The **Reply in the chat** link in those emails is your site's address with
`#elc_chat=<token>` on the end — or our own chat page with `#resume=<token>`,
for a workspace whose widget is on no site of its own. On the web the widget
opens that conversation. In your app, hand the URL to `resumeFromLink`: it
trades the token with the server for the visitor that conversation belongs to,
becomes that visitor, and resumes — so the chat screen opens on the
conversation the email was about, on whichever device it was opened.

```ts
const opened = await EasyLiveChat.instance.resumeFromLink(url); // or the bare token
```

It resolves `true` once that chat is the open session, and `false` — never
throwing, and changing nothing — for a URL that is not one of ours (answered at
once, with no request, so every link can be tried), a token the server refuses
(expired, another workspace's, a chat that is gone), or no network.
`resumeLinkToken(url)` says synchronously whether a URL carries a token at all.

For the email's link to reach your app, the app has to own your site's links —
universal links (Associated Domains) on iOS, App Links on Android, for the
domain the email points to. The token rides in the URL's fragment, which both
hand over with the URL.

**With expo-router**, in the root layout:

```tsx
// app/_layout.tsx
import * as Linking from 'expo-linking';
import { Stack, router } from 'expo-router';
import { useEffect } from 'react';
import { EasyLiveChat, resumeLinkToken } from '@easylivechat/react-native';

export default function RootLayout() {
  const url = Linking.useURL(); // the link that launched the app, then each one after
  useEffect(() => {
    if (url == null || resumeLinkToken(url) == null) return;
    void EasyLiveChat.instance.resumeFromLink(url).then((opened) => {
      if (opened) router.push('/support'); // your chat screen
    });
  }, [url]);
  return <Stack />;
}
```

expo-router matches the link's own path too — `/` for a link to your home page
— so the visitor lands on that route first and is taken on to the chat.

**With React Navigation** (and React Native's own `Linking`):

```tsx
import { useEffect } from 'react';
import { Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { EasyLiveChat, resumeLinkToken } from '@easylivechat/react-native';

export function useEmailedChatLinks(): void {
  const navigation = useNavigation();
  useEffect(() => {
    const follow = (url: string | null) => {
      if (url == null || resumeLinkToken(url) == null) return;
      void EasyLiveChat.instance.resumeFromLink(url).then((opened) => {
        if (opened) navigation.navigate('Support' as never); // your chat screen
      });
    };
    void Linking.getInitialURL().then(follow); // the link that launched the app
    const sub = Linking.addEventListener('url', ({ url }) => follow(url));
    return () => sub.remove();
  }, [navigation]);
}
```

If your `NavigationContainer` has a `linking` config for the same domain, leave
these URLs out of it, or it routes them as well.

Calling it before `boot()` is fine — the link that launched the app usually
arrives first: it is held and followed once boot has run. Declare the identity
first, as before any open: **an anonymous visitor** (or one identified without
a `userId`) becomes the link's visitor — whoever holds the emailed link gets
what the email showed, the web widget's rule — while **a visitor identified
with a `userId`** only follows a link to the chat this device already holds,
and gets `false` for any other: resumed under their verified identity, someone
else's conversation would become theirs.

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

## Notifications

The SDK does not register devices for notifications. Sending them from our
servers would need your Firebase credentials, and workspaces no longer hand
those over. Notifying your app's users is your own server's job, with the push
setup your app already has — and the workspace tells your server when:

1. Sign your users in to the chat with the id your server knows them by:
   `identify({ userId, userHash })` (see Identity verification). Only a
   verified id is ever handed back — `contact.userId` is `null` otherwise.
2. In the dashboard, **Settings → Webhooks**, add an endpoint on your server
   subscribed to `message.created`.
3. For each delivery that is a reply from the team — `data.message.senderType`
   `AGENT` (a person) or `BOT` (the AI assistant) — and whose
   `data.contact.userId` is set, send your own push to that user's devices.

```ts
// Your server — Express here; any framework does.
import { createHmac, timingSafeEqual } from 'node:crypto';

app.post('/webhooks/easylivechat', express.raw({ type: 'application/json' }), async (req, res) => {
  const body = req.body.toString('utf8');
  const timestamp = req.header('X-Easylivechat-Timestamp') ?? '';
  const expected = `sha256=${createHmac('sha256', process.env.EASYLIVECHAT_WEBHOOK_SECRET!)
    .update(`${timestamp}.${body}`)
    .digest('hex')}`;
  const given = req.header('X-Easylivechat-Signature-V2') ?? '';
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300; // refuse a replay
  if (!fresh || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return res.sendStatus(401);
  }
  res.sendStatus(200); // answer at once; a failed delivery is retried

  const { id, event, data } = JSON.parse(body);
  if (event !== 'message.created') return;
  const { conversationId, message, contact } = data;
  if (message.senderType !== 'AGENT' && message.senderType !== 'BOT') return; // the visitor's own, a notice
  if (!contact?.userId) return; // not one of your signed-in users
  if (await alreadySent(id)) return; // a retry carries the same id
  await sendPushToUser(contact.userId, {
    title: 'New reply',
    body: message.body || 'Sent an attachment',
    data: { conversationId },
  });
});
```

In the app, skip the notification when the chat is already on screen — the
app is the only thing that knows — and open the chat on a tap (your chat
screen, or `EasyLiveChat.instance.open()`).

`setPushToken()` and `EasyLiveChatPush` are kept as deprecated no-ops so an
app that calls them keeps compiling: nothing is sent and nothing is kept.
Remove the calls.

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
`identify()`, `clearIdentity()`, `resumeFromLink()`, `supportsConsent`, the
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
