# Changelog

All notable changes to `@easylivechat/react-native` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
