# @easylivechat/react-native-ui

Prebuilt, themeable React Native chat UI for
[EasyLiveChat](https://livechattools.com): launcher bubble, chat screen,
pre-chat form, attachments, voice notes, help articles, CSAT and post-chat
survey — all driven by your workspace's widget config, and translated into 13
languages.

Re-exports the whole headless core, so **this is the only package you install**.

---

## Install

```sh
npx expo install \
  @easylivechat/react-native-ui \
  expo-secure-store @react-native-async-storage/async-storage
```

Those two are required peers: `SecureAsyncStorage` keeps the session token,
the visitor's profile and the user id they were identified as in the keychain
(`expo-secure-store`), and the opaque visitor and conversation ids in
AsyncStorage.

**Give the SDK a random source.** The visitor id is a credential, so it must be
a real v4 UUID. Install `expo-crypto` and wire it once, before `boot()` — or
import `react-native-get-random-values` at your entry point, which the SDK
picks up by itself. See
[the core README](../easylivechat-react-native#give-it-a-random-source--one-line-and-it-matters).

```ts
import * as Crypto from 'expo-crypto';
import { setUuidGenerator } from '@easylivechat/react-native-ui';
setUuidGenerator(Crypto.randomUUID);
```

Everything else is optional, and only pulled in when the matching feature is
used:

| optional peer | needed for | if missing |
|---|---|---|
| `expo-image` | disk-cached avatars, image attachments and card images | falls back to RN's `Image` (no disk cache) |
| `expo-image-picker` | the built-in "Photo" attach option | supply `onPickAttachments` instead |
| `expo-document-picker` | the built-in "File" attach option | supply `onPickAttachments` instead |
| `expo-audio` | voice notes **and** the incoming-message chime | a voice note becomes a download chip; the chime is silent |
| `expo-file-system` | caching a voice note before it plays — the real length on screen, and a seek bar that works | the note streams instead: no length until played, and no seeking on iOS |
| `expo-linking` | nothing in this version — links open through React Native's own `Linking` | nothing changes |

No icon font and no SVG peer: every glyph is drawn from plain `View`s. No
gesture library either: the image viewer's pinch, pan and double-tap read the
touches every `View` already gets, on iOS and Android alike.

## Platform setup

### iOS

Attachments use the photo library, a picker you supply may use the camera, and
voice messages use the microphone. Each needs its usage string: without one
the Expo module refuses the request, so the attach or record button simply
does nothing — and any code that asks iOS directly without it gets the app
terminated. With Expo, in `app.json`:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSPhotoLibraryUsageDescription": "Attach images to your support conversation.",
        "NSCameraUsageDescription": "Take a photo to send to support.",
        "NSMicrophoneUsageDescription": "Record a voice message for support."
      }
    },
    "plugins": [
      ["expo-image-picker", {
        "photosPermission": "Attach images to your support conversation.",
        "cameraPermission": "Take a photo to send to support."
      }],
      ["expo-audio", { "microphonePermission": "Record a voice message for support." }]
    ]
  }
}
```

In a bare app, put the same three keys in `ios/<App>/Info.plist`.

- **Photo library** — required for the built-in "Photo" option.
- **Camera** — the built-in option opens the library, not the camera, so the
  SDK never asks for it. But `expo-image-picker`'s config plugin writes a
  camera string whether or not you use it: give it your own wording (as above)
  rather than the generic default, or `"cameraPermission": false` to leave it
  out. A host whose own `onPickAttachments` takes photos needs it for real.
- **Microphone** — required once your workspace turns voice messages on.

If you supply your own picker through `onPickAttachments` and never enable
voice messages, none of these are needed for the chat.

### Android

Nothing for the default setup: photos and files go through the system pickers.
Voice messages bring `RECORD_AUDIO` into your merged manifest through
`expo-audio`; it is only requested when a visitor taps the microphone, and the
microphone only appears when your workspace turns voice messages on. If you
will never use them, do not install `expo-audio` — or keep it for the chime
and block the permission:

```json
{ "expo": { "android": { "blockedPermissions": ["android.permission.RECORD_AUDIO"] } } }
```

In a bare app: `<uses-permission android:name="android.permission.RECORD_AUDIO" tools:node="remove" />`
in `android/app/src/main/AndroidManifest.xml` (with
`xmlns:tools="http://schemas.android.com/tools"` on `<manifest>`).

**Supported:** iOS and Android, React Native ≥ 0.76 (old and new
architecture). Web is not supported — the web product is the embeddable
script-tag widget, which you already have in your dashboard.

## Quick start

```tsx
import {
  EasyLiveChat,
  EasyLiveChatLauncher,
  SecureAsyncStorage,
} from '@easylivechat/react-native-ui';

await EasyLiveChat.instance.boot(
  { apiBase: 'https://api.livechattools.com', tenantSlug: 'your-workspace' },
  // Durable storage for the visitor id + session. Without it the visitor is
  // a stranger on every launch and their history is lost.
  { storage: new SecureAsyncStorage() },
);

export default function App() {
  return (
    <View style={{ flex: 1 }}>
      <YourApp />
      {/* Last, so it floats over everything; it positions itself. */}
      <EasyLiveChatLauncher />
    </View>
  );
}
```

`tenantSlug` is your workspace slug — the one in your dashboard URL
(`your-workspace.livechattools.com`).

Or open the chat from your own button or menu entry and skip the launcher:

```tsx
<EasyLiveChatScreen showAppBar onRequestClose={() => navigation.goBack()} />
```

`EasyLiveChatScreen` is a normal component — put it in a stack screen, a tab,
a modal. Both integrations are in [`example/`](../../example).

## What the visitor sees

The screen follows `EasyLiveChat.instance.phase` (`useEasyLiveChatPhase()`),
and you do not have to manage any of it:

| Phase | Screen |
|---|---|
| `idle` / `loading` / `resuming` | A spinner while your workspace config loads (an error and Retry if it cannot) |
| `prechat` | The pre-chat form you configured — skipped if you `identify` |
| `chat` | The conversation: thread, composer, a notice while you are closed, and the visitor's place while they wait in the queue |
| `feedback` | Your post-chat survey, or the built-in CSAT |
| `offline` | Your closed notice |

Out-of-hours behaviour is a dashboard setting, not a client one — take a
message, show a notice, or accept chats anyway. The notice says what the web
widget's does: the one you wrote in Settings → Availability, whatever else is
going on; without one, that your AI assistant can help in the meantime while it
covers, or our own words in the visitor's language — never an invitation to
leave a message where none is taken — and when you are back.

Cards your agents send are drawn as cards — image, title, text, link buttons
and reply buttons, several as a carousel. The quick replies you set on the
greeting, and the AI assistant's Yes / No when it offers to hand over, are
one-tap buttons under the message. A link in a message gets the preview card
your server made for it (site, title, a line of description, its picture) while
Widget settings has link previews on. The visitor reacts to your team's messages
with a long press — 👍 ❤️ 😂 😮 😢 🙏, or any emoji from the + (a search over
their names, the categories, the ones they used last), one per message, the
same again takes it back — and sees your agents' reactions on theirs. Pictures open full-screen with pinch,
double-tap and pan. Voice notes play in place, with their length and a seek
bar. Everything follows your workspace's colours — in light or dark, as Widget
settings chooses, `auto` following the visitor's phone — and the visitor's
language and direction. The launcher takes its size and its words ("Chat with
us") from Widget settings too.

With the visitor emails on in your workspace, the two the web widget offers are
here as well, as cards above the thread — never a pop-up. **Email me this
chat**: the envelope beside the × (`showAppBar`), once the conversation has
something in it, and a row above the survey once it has ended; one tap sends it
to the address on file, shown masked, or the visitor types another. **Get the
reply by email**: asked once per conversation, after the visitor has written
while nobody can answer — you are closed, they are waiting in the queue, or
nobody is accepting — and only if you have no address for them, so a reply that
comes after they left still reaches them.

## Recipes

### Identify a signed-in user

Call before opening. The pre-chat form is skipped and the agent sees who they
are talking to.

```ts
EasyLiveChat.instance.identify({
  name: user.name,
  email: user.email,
  phone: user.phone,
  fields: { plan: 'pro' }, // shown to the agent
  // Identity verification: your BACKEND computes
  // userHash = hex(HMAC_SHA256(identitySecret, userId)).
  userId: user.id,
  userHash: user.chatHash,
});
```

With `userId` the SDK also keeps one visitor per person: a different user
signing in on the device, or an identity without a `userId` after one was set,
starts a fresh visitor, so nobody resumes the previous person's conversation.
Call it on every launch before the chat opens. On sign-out:

```ts
await EasyLiveChat.instance.reset({ storage }); // the same storage you boot with
```

A workspace that **enforces** verification refuses a missing or wrong hash:
the chat does not start, the visitor sees "something went wrong", and
`EasyLiveChat.instance.onError` carries an error for which
`isIdentityNotVerified(e)` is true, with a `reason` saying what to fix. See the
core package's README.

### Show an unread badge

```tsx
import { useUnreadCount } from '@easylivechat/react-native-ui';

function SupportTab() {
  const unread = useUnreadCount();
  return (
    <View>
      <SupportIcon />
      {unread > 0 ? <Badge>{unread > 99 ? '99+' : unread}</Badge> : null}
    </View>
  );
}
```

The launcher already carries one.

### End the conversation

Backing out of the chat screen does **not** end the conversation — reopening
resumes it with its history, which is what visitors expect, and the agent still
sees it live. Ending is explicit:

```tsx
<EasyLiveChatEndChatButton />
```

It appears only while a conversation is live, confirms first, then shows the
post-chat survey in place. (`showAppBar` on the screen draws both: back, which
leaves, and ×, which ends.) To trigger it from your own header, render
`EndChatDialog`, or call `EasyLiveChat.instance.endChat()` directly — it
returns whether a post-chat step will follow. Use the return value; you cannot
infer it from the phase afterwards, because the phase is driven by the
server's close echo, which is deliberately ignored for a conversation already
closed or already rated.

### Email me this chat from your own header

`showAppBar` draws the envelope itself. With your own header, put
`EasyLiveChatEmailTranscriptButton` beside `EasyLiveChatEndChatButton` — it
renders only while the email is on offer, and opens the card in the chat
screen:

```tsx
<EasyLiveChatEmailTranscriptButton theme={theme} />
```

A header that takes a callback rather than a node uses
`useEmailTranscriptOffer()` — `{ available, open }`. "Get the reply by email"
needs nothing from you.

### Open the chat from an emailed link

Your workspace's emails to a visitor who has left carry a **Reply in the chat**
link to your site, with `#elc_chat=<token>` on the end. If your app handles
links to your site, hand the URL to the SDK and open the chat screen when it
says yes:

```ts
if (await EasyLiveChat.instance.resumeFromLink(url)) navigation.navigate('Chat');
```

The full recipe, for expo-router and React Navigation, is in the core
package's README.

### Help articles

With the workspace's "Show help articles" switch on, the chat screen offers
**Browse help articles** above the pre-chat form, the thread and the closed
notice until the visitor has written. It opens search over your top articles,
the article itself, "Was this helpful?", and "Still need help? Start a chat",
which comes back to the chat. `showHelpArticles={false}` keeps it out. Give
help its own entry in your app too:

```tsx
const config = useWidgetConfig();

{config?.helpArticlesEnabled ? (
  <EasyLiveChatHelpScreen
    onClose={() => navigation.goBack()}
    // Optional: route "Start a chat" yourself. Omitted, the help screen turns
    // into the chat screen in place.
    onStartChat={() => navigation.navigate('Chat')}
    // Optional: handle article links yourself. Omitted, `Linking` opens them.
    onOpenLink={(url) => openInAppBrowser(url)}
  />
) : null}
```

`showAppBar={false}` drops the screen's own header when your navigator draws
one; `initialArticleId` opens straight on an article. Article bodies are drawn
natively by `HelpMarkdownView` — headings, lists, **bold**, *italic*, `code`,
links and images — with no HTML and no WebView; only http(s)/mailto:/tel:
links and http(s) images are ever live. Each article reads in its own
language's direction (`helpArticleDirection`). Use `HelpMarkdownView`
directly if you build your own help UI on the core's `searchHelp()` /
`getHelpArticle()`.

### Match your app's theme

```tsx
<EasyLiveChatScreen themeOverride={{ primary: '#111827', background: '#0B1120' }} />
```

Colours come from your dashboard so non-developers can rebrand without a
release; any field you pass wins. **`direction` is never taken from the
override** — layout direction follows the locale and the content, not
branding, so a colours-only override cannot silently force an RTL workspace to
LTR. Use the explicit `directionOverride` prop if you genuinely need to.

**Light and dark.** Widget settings chooses: `light` (the look every widget had
before, and what an older server means), `dark`, or `auto` — the visitor's
phone, followed live. Dark is derived from your colours as the web widget does
it: your brand stays on the launcher, the visitor's bubbles and the send
button; the page and cards become a dark ground tinted toward it; links and
outlined buttons use `theme.primaryInk`, your brand lightened until it reads.
Your override still wins — pin the scheme, or paint the surfaces yourself and
the SDK fills the rest from the scheme your colours are for:

```tsx
// Always light, whatever the workspace or the phone says.
<EasyLiveChatScreen themeOverride={{ scheme: 'light' }} />

// Your own dark surfaces; the text and the ink follow them.
<EasyLiveChatScreen themeOverride={{ background: '#0B1120', surface: '#141B2D' }} />
```

Drawing views of your own beside the SDK's? `useEasyLiveChatTheme(config,
themeOverride)` gives you the same resolved theme, and re-renders when the
phone switches.

### Language and RTL

122 chrome strings ship in 13 locales
(`en ar ckb de es fr hi it kmr pt tr ur zh`). Resolution order: host-forced
locale → the `locale` prop → server workspace locale → device locale → `en`,
matching on the language subtag only (`pt-BR` → `pt`). `ku` maps to `ckb`
(Sorani); `kmr` is Badini/Kurmanji.

```tsx
<EasyLiveChatScreen
  locale="ckb"
  strings={{ send: 'Send it' }}                    // every locale
  stringsByLocale={{ ckb: { send: 'بنێرە' } }}      // wins, key by key
/>
```

`stringsByLocale` also lets you add a language the SDK does not ship, without
waiting on a release. Key names follow `easylivechat_ui`'s, so an override map
written for one SDK reads the same in the other.

**Tenant-authored copy is never localized.** `welcomeTitle`,
`welcomeSubtitle`, `offlineMessage` and every form label come from the
dashboard per language and are rendered verbatim.

The chat mirrors for `ar`/`ckb`/`kmr`/`ur` **while your host app stays LTR** —
and stays right in an app that is itself RTL. The SDK never calls
`I18nManager.forceRTL`: that is process-global, needs an app restart, and
would flip your app too. Direction is passed down through context and applied
against the host's own (`row-reverse`, `textAlign`, `writingDirection`, and
corners and insets that land on the chat's side).

The composer additionally follows the **text**: it turns around on the first
strongly-directional character the visitor types, remembers what they last
wrote for when the box is empty, and falls back to the device language and then
the workspace direction.

### Your own attachment picker

The built-in pickers upload a `{ uri }` file reference, which RN's `FormData`
streams straight off disk. To use your own sheet:

```tsx
<EasyLiveChatScreen
  onPickAttachments={async () => [
    { data: { uri }, filename: 'photo.jpg', contentType: 'image/jpeg' },
  ]}
/>
```

## API

Every screen takes `themeOverride`, `directionOverride`, `strings`,
`stringsByLocale` and `locale`.

| Export | Purpose |
|---|---|
| `EasyLiveChatLauncher` | Floating bubble with unread badge. `alignment`, `offset`, `useBottomSheet`, `onPickAttachments`, `showHelpArticles` |
| `EasyLiveChatScreen` | The full chat screen for your own navigation. `showAppBar`, `appBarTitle`, `onRequestClose`, `onPickAttachments`, `showHelpArticles` |
| `EasyLiveChatEndChatButton` / `EndChatDialog` | Explicit end-chat action, with confirmation |
| `EasyLiveChatHelpScreen` | Help articles: search, reader, "Was this helpful?", start a chat. `onClose`, `onStartChat`, `onOpenLink`, `showAppBar`, `initialArticleId` |
| `HelpView` / `HelpMarkdownView` | The help UI without a screen around it; an article body drawn natively (no HTML) |
| `ThreadView`, `MessageBubble`, `ComposerBar`, `PreChatFormView`, `PostChatFormView`, `FeedbackPromptView`, `ClosedNoticeView`, `ClosedNoticeBanner`, `QueueNotice`, `ElcImageViewer` | The pieces the screen is built from |
| `ReactionChips`, `QuickReactionRow`, `LinkPreviewCard` | A bubble's reactions, the quick row a long press opens, and a link's preview card |
| `EmojiPicker`, `EmojiPickerSheet` | The whole picker — search, categories, recent — and the sheet the quick row's + opens; `searchEmoji`, `emojiCatalog` for your own |
| `EasyLiveChatEmailTranscriptButton`, `useEmailTranscriptOffer`, `EmailCard` | "Email me this chat" for your own header, and the card both emails are drawn with |
| `closedNoticeText` | The closed / busy notice's words, as the banner and the closed screen say them |
| `SecureAsyncStorage` | Durable storage default (keychain + AsyncStorage) |
| `overrideAll`, `overrideByLocale`, `setHostLocale`, `stringsFor` | The chrome strings |
| `useEasyLiveChatTheme`, `themeFromConfig`, `inkOf`, `errorColorOf`, `DirectionProvider`, `directionStyles`, `textDirectionOf` | Theming (light and dark) and bidi helpers for your own UI |

The core's API — `boot`, `identify`, `reset`, `open`, `endChat`, `sendMessage`,
`react`, `emailTranscript`, `visitorEmail`, `setVisitorEmail`,
`resumeFromLink`, `searchHelp`, `getHelpArticle`, the stores and the `use…`
hooks — is
re-exported here and documented in
[`@easylivechat/react-native`](../easylivechat-react-native).

## Troubleshooting

**The visitor is a stranger on every launch.** You booted without
`storage: new SecureAsyncStorage()`, so the default in-memory store is used and
the visitor id does not survive a restart.

**"EasyLiveChat is not initialized".** A screen rendered before `boot()`
finished. Await it before rendering the chat (or render it once
`useIsBooted()` is true).

**The launcher is invisible.** It positions itself absolutely against its
parent: render it as the last child of a full-screen `View` (`flex: 1`), not
inside a `ScrollView` or a row.

**Nothing happens when opening.** Check `apiBase` and `tenantSlug` against your
dashboard, and listen to `EasyLiveChat.instance.onError` — configuration
problems surface there rather than throwing.

**Attaching a photo or recording does nothing on iOS.** The usage string is
missing from `Info.plist`, so iOS refuses the request — see
[Platform setup](#platform-setup).

**Voice notes arrive as files.** `expo-audio` is not installed; the console
says `[easylivechat] voice note: expo-audio is not installed`. Install it, or
leave voice messages off.

**"No cryptographic random source found".** Wire `setUuidGenerator` (or import
`react-native-get-random-values`) — see [Install](#install).

**The chat turned dark (or will not).** Widget settings decides: `auto`
follows the phone's appearance, `dark` is always dark, and a workspace created
before dark mode existed is on `light`. To decide it in the app instead, pin
`themeOverride={{ scheme: 'light' }}` (or `'dark'`).

**The chat is left-to-right in Arabic.** The workspace locale decides
direction; pass `locale="ar"` (or `directionOverride="rtl"`) if your app knows
better than the workspace default.

## Want a different UI?

Use [`@easylivechat/react-native`](../easylivechat-react-native) directly. It
is the same protocol and state machine with no components — bind the stores
(or the `use…` hooks) to your own design system.

## Limitations

Notifications to your app's users are your own server's to send, from the
`message.created` webhook — see "Notifications" in the core package's README.
Web is not supported. `customCss` is a documented no-op. The emoji search
matches English names, as on the web.

## License

MIT
