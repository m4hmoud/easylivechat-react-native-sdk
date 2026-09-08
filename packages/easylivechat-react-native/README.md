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

await EasyLiveChat.instance.open();
EasyLiveChat.instance.sendMessage('Hi there');
```

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

## The `identify` / `reset` contract

```ts
// Before open(): skips the pre-chat form and starts as this person.
EasyLiveChat.instance.identify({ name, email, phone, fields: { userId } });

// Your app's LOGOUT path.
await EasyLiveChat.instance.reset({ storage });
```

- **`identify()` is authoritative**, not a merge. Anything you no longer supply
  is *cleared*, so a previous user's email cannot leak out of secure storage
  into the new session.
- **`reset()` is not `shutdown()`.** `shutdown()` only clears memory; the
  durable `visitorId` survives it, so the next `boot()` resolves the *same*
  contact and resumes the *same* conversation. That is right for a returning
  customer and wrong for a signed-out one — on a shared device (a restaurant
  tablet, a POS terminal) the next person would inherit the last one's
  identity. `reset()` drops every identity key and works even when the SDK was
  never booted this session, which is the common case for a logout that never
  opened the chat.
- The transcript is **not** deleted. This abandons the identity, not the
  history.

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

## Limitations

- **Background push notifications are not implemented.** "An agent replied
  while the app was closed" needs a server-side *visitor* push registry and
  fan-out; the backend currently pushes to agents only, and this SDK is not
  permitted to change the server. `EasyLiveChatPush` is a documented stub. Use
  your own push infrastructure and call `EasyLiveChat.instance.open()` on tap.
- **Agent-side features are out of scope.** This is the visitor SDK.
- **Web is not supported.** The web product is the embeddable widget (a script
  tag).
- **`customCss` is a no-op.** It is parsed off the wire and ignored — raw CSS
  cannot map to React Native styles. Theme via the UI package's
  `themeOverride`.

## License

MIT
