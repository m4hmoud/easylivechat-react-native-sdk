# Changelog

All notable changes to `@easylivechat/react-native` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
