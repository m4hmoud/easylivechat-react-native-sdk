import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2021',
  // React Native hosts consume `src/index.ts` through Metro (see the
  // "react-native" field); these builds are for Node/Jest/Vitest and for any
  // bundler that ignores that field.
  external: ['react', 'react-native', 'expo-crypto'],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});
