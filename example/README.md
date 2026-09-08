# EasyLiveChat SDK — example app

An Expo app that exercises every flow in the SDK from one screen.

```sh
cp .env.example .env      # point at your workspace
bunx expo run:ios         # or: bunx expo run:android
```

## What it demonstrates

| flow | how to reach it |
|---|---|
| anonymous chat | leave the identify fields blank, tap the bubble |
| pre-chat form | same, on a workspace that has one configured |
| identified chat | fill name/email/phone → **identify()** → open |
| attachments | the **+** in the composer (photo or file) |
| voice notes | the mic, on a workspace with voice messages enabled |
| CSAT | **endChat()** on a workspace with no post-chat survey |
| post-chat survey | **endChat()** on a workspace that configured one |
| closed workspace | open outside the tenant's working hours |
| RTL | switch the language chip to العربية / کوردی — the chat mirrors, this app stays LTR |
| logout | **reset()** — the next open is a new contact with no history |

The status block at the top is live SDK state, read straight from the hooks:
phase, connection, unread count, visitor mode, availability reason and the
server-formatted reopening time.

## Notes

- `SecureAsyncStorage` is created **once** at module scope and passed to both
  `boot()` and `reset()` — `reset()` has to work even when the SDK was never
  booted this session.
- Changing the language chip **re-boots** the SDK. That is the supported way to
  re-localize: `boot()` on an already-booted instance adopts the new config, so
  the tenant's own copy comes back in the new language.
- `metro.config.js` teaches Metro about the monorepo and pins one copy of
  `react` / `react-native`, which is the usual "Invalid hook call" trap.
