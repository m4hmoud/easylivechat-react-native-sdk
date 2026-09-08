# @easylivechat/react-native-ui

Prebuilt, themeable React Native chat UI for
[EasyLiveChat](https://livechattools.com): launcher bubble, chat screen,
pre-chat form, attachments, voice notes, CSAT and post-chat survey — all driven
by your workspace's widget config.

Re-exports the whole headless core, so **this is the only package you install**.

---

## Install

```sh
npx expo install \
  @easylivechat/react-native-ui \
  expo-crypto expo-secure-store @react-native-async-storage/async-storage
```

Those three are required. `expo-crypto` also needs one line of wiring — see
[the core README](../easylivechat-react-native#give-it-a-random-source--one-line-and-it-matters):

```ts
import * as Crypto from 'expo-crypto';
import { setUuidGenerator } from '@easylivechat/react-native-ui';
setUuidGenerator(Crypto.randomUUID);
```

Everything else is optional, and only pulled in when the matching feature is
used:

| optional peer | needed for | if missing |
|---|---|---|
| `expo-image` | disk-cached avatars and image attachments | falls back to RN's `Image` (no disk cache) |
| `expo-image-picker` | the built-in "Photo" attach option | supply `onPickAttachments` instead |
| `expo-document-picker` | the built-in "File" attach option | supply `onPickAttachments` instead |
| `expo-audio` | voice notes **and** the incoming-message chime | both degrade to silence |

**A host that will never enable voice messages should not install `expo-audio`
and should not ship a microphone permission.** When you do enable it, add
`NSMicrophoneUsageDescription` (iOS) and `RECORD_AUDIO` (Android) to your own
app — without them the OS terminates the app the moment recording starts.

No icon font and no SVG peer: every glyph is drawn from plain `View`s.

## Quick start

```tsx
import {
  EasyLiveChat,
  EasyLiveChatLauncher,
  SecureAsyncStorage,
} from '@easylivechat/react-native-ui';

await EasyLiveChat.instance.boot(
  { apiBase: 'https://api.livechattools.com', tenantSlug: 'acme' },
  { storage: new SecureAsyncStorage() },
);

export default function App() {
  return (
    <View style={{ flex: 1 }}>
      <YourApp />
      <EasyLiveChatLauncher />
    </View>
  );
}
```

Or push the screen yourself:

```tsx
<EasyLiveChatScreen showAppBar onRequestClose={() => navigation.goBack()} />
```

## Leaving vs ending

They are **different actions**, deliberately.

- Backing out of the chat screen does **not** end the conversation — the
  visitor can leave mid-chat and be resumed right where they were.
- Ending is explicit: `<EasyLiveChatEndChatButton />` confirms first, and the
  post-chat survey then appears **in place** on the screen.

`endChat()` returns whether a post-chat step will follow. Use the return value;
you cannot infer it from the phase afterwards, because the phase is driven by
the server's close echo, which is deliberately ignored for a conversation
already closed or already rated.

## Theming

```tsx
<EasyLiveChatScreen themeOverride={{ primary: '#111827', background: '#0B1120' }} />
```

Colours come from the workspace config; any field you pass wins.
**`direction` is never taken from the override** — layout direction is a
function of locale and content, not branding, so a colours-only override cannot
silently force an RTL workspace to LTR. Use the explicit `directionOverride`
prop if you genuinely need to force it.

## Localization and RTL

53+ chrome strings ship in 13 locales
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
waiting on a release.

**Tenant-authored copy is never localized.** `welcomeTitle`,
`welcomeSubtitle`, `offlineMessage` and every form label come from the
dashboard per language and are rendered verbatim.

The chat mirrors for `ar`/`ckb`/`kmr`/`ur` **while your host app stays LTR**.
The SDK never calls `I18nManager.forceRTL` — that is process-global, needs an
app restart, and would flip your app too. Direction is passed down through
context and applied with `row-reverse`, `textAlign` and `writingDirection`.

The composer additionally follows the **text**: it turns around on the first
strongly-directional character the visitor types, remembers what they last
wrote for when the box is empty, and falls back to the device language and then
the workspace direction.

## Attachments

The built-in pickers upload a `{ uri }` file reference, which RN's `FormData`
streams straight off disk. To use your own sheet:

```tsx
<EasyLiveChatScreen
  onPickAttachments={async () => [
    { data: { uri }, filename: 'photo.jpg', contentType: 'image/jpeg' },
  ]}
/>
```

## Limitations

Background push is **not implemented** — see the core package's README. Web is
not supported. `customCss` is a documented no-op.

## License

MIT
