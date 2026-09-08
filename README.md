# EasyLiveChat React Native SDK

The visitor-side SDK for [EasyLiveChat](https://livechattools.com): embed live
customer support into your own React Native app.

Two packages, mirroring the Flutter SDK's split:

| package | what it is |
|---|---|
| [`@easylivechat/react-native`](packages/easylivechat-react-native) | headless protocol client — transport, state machine, reactive stores, React hooks. **No UI.** |
| [`@easylivechat/react-native-ui`](packages/easylivechat-react-native-ui) | prebuilt themeable components. Re-exports the core, so hosts install **one** package. |

The split exists so hosts with their own design system take the core alone and
pay for none of the UI's native dependencies (camera, microphone, image
caching, audio).

Both speak the same anonymous **widget protocol** as the web widget and the
Flutter SDK — HTTP `/api/widget/*` plus Socket.IO `/widgets` and
`/widget-presence`, authenticated by a per-visitor 24-hour widget JWT. **The
SDK requires no server changes.**

---

## Layout

```
react-native-sdk/
  packages/easylivechat-react-native/       # @easylivechat/react-native
  packages/easylivechat-react-native-ui/    # @easylivechat/react-native-ui
  example/                                  # Expo app exercising both
```

## Development

Bun workspaces, run from `react-native-sdk/`:

```sh
bun install          # resolve the workspace
bun run typecheck    # tsc --noEmit across both packages
bun run test         # vitest (173 tests)
bun run build        # ESM + CJS + .d.ts for both packages
```

> `bunfig.toml` pins a **hoisted** node_modules layout. Metro cannot resolve
> Bun's default isolated layout — `@expo/metro-config` requires its own
> transitive dependencies by bare specifier, and Metro's asset resolution
> assumes a flat tree.

### The example app

```sh
cd example
cp .env.example .env          # point it at your workspace
bunx expo run:ios             # or: bunx expo run:android
```

It exercises every flow: anonymous chat, identified chat, the pre-chat form,
attachments, voice notes, CSAT, the post-chat survey, a closed workspace, RTL
locales, and logout via `reset()`.

`bunx expo export --platform ios` bundles it through Metro without a simulator,
which is a fast way to prove the whole import graph resolves.

### Live protocol test

Unit tests run against a fake socket. A Socket.IO **protocol mismatch fails the
handshake silently**, so there is also a live test, skipped unless pointed at a
real workspace:

```sh
ELC_API_BASE=https://api.livechattools.com \
ELC_TENANT_SLUG=acme \
  bunx vitest run live-integration
```

It creates a real conversation — point it at a test tenant.

## Releasing

Version the two together, the way the Flutter pair are:

1. Bump the core's `version` + CHANGELOG.
2. Raise the UI's `@easylivechat/react-native` dependency to match, and bump
   its own version + CHANGELOG.
3. Publish the **core first** — the UI's dependency will not resolve until the
   registry has indexed it.

```sh
cd packages/easylivechat-react-native      && npm publish --access public
cd ../easylivechat-react-native-ui         && npm publish --access public
cd "$(git rev-parse --show-toplevel)"      && scripts/sync-rn-sdk-mirror.sh
```

**The last step is not optional.** Both `package.json`s carry a `repository`
link to the public mirror, so a stale mirror shows the world source that is not
what they would install. The Flutter mirror silently sat five releases behind
for exactly this reason.

## Non-goals

Background push notifications, any server change, agent-side features, web
support, and `customCss`. See the package READMEs.

## License

MIT
