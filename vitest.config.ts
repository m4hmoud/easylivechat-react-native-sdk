import { defineConfig } from 'vitest/config';

// One project: the core is plain TS/JS (it touches `react-native` only for
// AppState/Platform), and the UI's helpers and components run against the
// rendering stand-in in test/react-native-mock.ts — components are rendered
// with @testing-library/react-native, without Metro or Babel. How that is
// wired, and its limits: test/README.md.
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
