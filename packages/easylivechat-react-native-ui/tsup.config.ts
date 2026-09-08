import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: false,
  target: 'es2021',
  loader: { '.json': 'json' },
  // Everything native stays external: the UI package must never bundle a
  // peer, and every optional peer (`expo-audio`, pickers, `expo-image`) is
  // required lazily so a host that skips it is not forced to install it.
  external: [
    'react',
    'react-native',
    '@easylivechat/react-native',
    '@react-native-async-storage/async-storage',
    'expo-audio',
    'expo-document-picker',
    'expo-image',
    'expo-image-picker',
    'expo-linking',
    'expo-secure-store',
  ],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});
