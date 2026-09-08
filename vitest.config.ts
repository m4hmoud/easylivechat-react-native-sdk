import { defineConfig } from 'vitest/config';

// One project: the core is plain TS/JS (it touches `react-native` only for
// AppState/Platform, both stubbed in test/setup-rn.ts), and the UI's pure
// helpers — bidi, l10n, linkify, chime rules, theme — are testable the same
// way. Component rendering is covered by the example app; RNTL would pull the
// whole Metro/Babel toolchain into a Node runner for very little more.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'packages/*/test/**/*.test.tsx'],
    setupFiles: ['./test/setup-rn.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: {
      '@easylivechat/react-native': new URL(
        './packages/easylivechat-react-native/src/index.ts',
        import.meta.url,
      ).pathname,
    },
  },
});
