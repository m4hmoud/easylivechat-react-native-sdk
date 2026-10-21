# Tests: React Native under Vitest

`bun run test` runs every `packages/*/test/**/*.test.ts(x)` in Node, with no
Metro, no Babel and no simulator. The core's tests are plain logic; the UI's
also **render components** — `*.render.test.tsx` — with
`@testing-library/react-native` (RNTL) on `react-test-renderer`.

## How React Native is provided

The real `react-native` package cannot load in Node: its entry point is Flow
source that only Metro's Babel preset parses, and much of it calls native
modules. So `react-native` resolves to **`react-native-mock.ts`**, a small
stand-in that renders:

- every component is a host element with React Native's own name (`View`,
  `Text`, `TextInput`, `Image`, `ScrollView`, `Modal`, …), so RNTL's queries
  (`getByText`, `getByRole`, `getByLabelText`) and `fireEvent` work as they do
  against a device build;
- `Pressable` resolves function `style` / `children` with `{ pressed: false }`
  and blocks a press when `disabled` through `onStartShouldSetResponder` — the
  same signal RNTL reads from the real one;
- `FlatList` renders every row (no virtualisation) plus its header, footer and
  empty slots;
- `Animated` keeps real values: `setValue` and every animation land on the
  value **at once** (a loop runs its body once), and `__getValue()` reads it
  back, so a test can assert a transform without waiting out an ease;
- the platform APIs the SDK calls (`Platform`, `I18nManager`, `Linking`,
  `AccessibilityInfo`, `Keyboard`, `Dimensions`, …) are present; `Linking`,
  `AccessibilityInfo.announceForAccessibility` and `Keyboard.dismiss` are
  `vi.fn()`s to assert on;
- the device is light: `Appearance.__setColorScheme('dark')` (inside `act`)
  turns it dark, and `useColorScheme` follows it live, as on a device — put it
  back in `afterEach`.

An API the stand-in does not list **throws on use**. That is deliberate — it
keeps the core honest about not depending on React Native, and it means a new
call into React Native is added here on purpose.

## The wiring (`setup-rn.ts`)

- `vi.mock('react-native', …)` serves the stand-in to the SDK's own modules
  (ES imports, which Vitest intercepts).
- RNTL is CommonJS loaded by Node and calls `require('react-native')` itself,
  which `vi.mock` never sees. A `Module._load` hook answers that one call with
  the same object.
- The optional native peers — `expo-image`, `expo-audio`, `expo-file-system`,
  the pickers, `expo-secure-store`, AsyncStorage — are mocked as **not
  installed**. The SDK must degrade without each of them anyway, and the real
  packages would fail the same way, slower. A test that wants one present
  mocks it in its own file (its `vi.mock` replaces the setup's), e.g.
  `voice-note.render.test.tsx` (`expo-audio`) and `storage-impl.test.ts`
  (the secure store, which also enforces the real key rule).
- `requestAnimationFrame` is defined, as React Native's runtime defines it.

## Writing a render test

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { afterEach, it, expect } from 'vitest';

afterEach(cleanup); // Vitest has no globals here, so RNTL cannot auto-clean.

it('…', () => {
  render(<MessageBubble … />);
  fireEvent.press(screen.getByText('Yes'));
});
```

Helpers in `packages/easylivechat-react-native-ui/test/support.ts`:
`message()` builds a `ChatMessage` from its wire shape through the core's own
parser; `bootOffline()` boots the SDK with in-memory storage and no network
(a send fails locally, as with no connection); `setMessages()` /
`setVisitorMode()` put a transcript or an availability on screen, and
`setConnection()`, `setWidgetConfig()`, `setQueue()` and `setUnread()` the rest
of what the controller holds; `flush()` drains microtasks (fake-timer safe),
`settle()` waits out a lazy `import()`.

**There is no layout engine**, so nothing has a position. RTL is asserted the
way the SDK implements it: it never relies on the host's direction and writes
`row` / `row-reverse` from the chat's own, and the host here is LTR — so
`row-reverse` *is* right-to-left on screen. `rowOf()`, `leftToRight()` and
`runsRightToLeft()` read that; `styleOf()` flattens a style.

Two traps:

- Never compare test instances with `toBe`/`toEqual` — a failing diff tries to
  print the whole tree and runs the worker out of memory. Compare a prop or a
  `type` instead.
- A component that lazily imports a peer on mount (the voice-note tile) can
  finish that import during the NEXT test and write a module-level cache that
  test just reset. Let it land: `await settle()` before `cleanup()`.

Device behaviour the stand-in cannot show — real gestures, real layout, real
playback — is still checked in `example/`.
