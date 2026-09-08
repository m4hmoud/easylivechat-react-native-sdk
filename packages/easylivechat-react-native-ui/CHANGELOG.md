# Changelog

All notable changes to `@easylivechat/react-native-ui` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-09-08

### Added

- First release: feature parity with the Flutter SDK
  (`easylivechat` 0.1.50 / `easylivechat_ui` 0.1.65).
- `EasyLiveChatLauncher`, `EasyLiveChatScreen` (phase router),
  `EasyLiveChatEndChatButton`, thread, composer, pre-chat form, post-chat
  survey, CSAT prompt, closed notice and full-screen image viewer.
- `SecureAsyncStorage`: the durable storage production apps should inject.
- 13-locale chrome strings with per-locale host overrides, and RTL that never
  touches `I18nManager.forceRTL`.
- Voice notes, attachments and the incoming-message chime, each behind an
  optional peer so a host pays only for what it enables.
- An icon set drawn from plain `View`s — no icon font, no SVG peer.
