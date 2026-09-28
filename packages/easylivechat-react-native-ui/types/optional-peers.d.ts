/**
 * Ambient stubs for the OPTIONAL native peers.
 *
 * `expo-audio`, `expo-image`, `expo-image-picker` and `expo-document-picker`
 * are optional peers: a host that never records a voice note, or that supplies
 * its own `onPickAttachments`, must not be forced to install them. Every use
 * site imports them lazily inside a `try`/`catch` and degrades when the import
 * fails.
 *
 * The specifiers stay STATIC so Metro can resolve them for hosts that DO
 * install them — a `import(variable)` would be unresolvable at bundle time.
 * These declarations exist only so `tsc` can compile this package without the
 * peers present; the real call sites cast to their own narrow interfaces, so
 * nothing here is relied on for type safety.
 *
 * Deliberately kept OUT of `src/` and out of `package.json#files`, so it is
 * never published: an ambient `declare module` shipped to consumers would
 * shadow the real types for anyone who does install these packages.
 */
declare module 'expo-audio' {
  const mod: unknown;
  export = mod;
}

declare module 'expo-file-system' {
  const mod: unknown;
  export = mod;
}

declare module 'expo-image' {
  const mod: unknown;
  export = mod;
}

declare module 'expo-image-picker' {
  const mod: unknown;
  export = mod;
}

declare module 'expo-document-picker' {
  const mod: unknown;
  export = mod;
}

declare module 'expo-secure-store' {
  const mod: unknown;
  export = mod;
}

declare module '@react-native-async-storage/async-storage' {
  const mod: unknown;
  export = mod;
}
