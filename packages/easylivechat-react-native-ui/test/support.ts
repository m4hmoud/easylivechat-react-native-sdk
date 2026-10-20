/**
 * Shared fixtures for the UI's render tests.
 *
 * Messages are built through the core's own `parseChatMessage`, from the wire
 * shape, so a field the model gains later is filled in the way production
 * fills it rather than missing from a hand-built literal.
 */
import { type ChatMessage, EasyLiveChat, parseChatMessage } from '@easylivechat/react-native';
import { act } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import type { EasyLiveChatTheme } from '../src/theme';

export const THEME: EasyLiveChatTheme = {
  primary: '#2563EB',
  background: '#FFFFFF',
  surface: '#F3F4F6',
  text: '#111827',
  direction: 'ltr',
};

export const RTL_THEME: EasyLiveChatTheme = { ...THEME, direction: 'rtl' };

const WIRE_SENDER: Record<string, string> = {
  agent: 'AGENT',
  customer: 'CUSTOMER',
  system: 'SYSTEM',
  bot: 'BOT',
};

/** A message from its wire shape, then any model-level overrides on top. */
export function message(
  wire: Record<string, unknown> & { senderType?: string },
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  const sender = wire.senderType ?? 'agent';
  const parsed = parseChatMessage({
    id: 'm1',
    conversationId: 'c1',
    contentType: 'TEXT',
    body: 'hello',
    createdAt: new Date(2026, 9, 6, 10, 1).toISOString(),
    ...wire,
    senderType: WIRE_SENDER[sender] ?? sender,
  });
  return { ...parsed, ...overrides };
}

/**
 * A booted client with no session: urls resolve against the API, and a send
 * fails locally (no socket) the way a dropped connection does.
 */
export async function bootOffline(): Promise<void> {
  await EasyLiveChat.instance.boot({
    apiBase: 'https://api.example.com',
    tenantSlug: 'acme',
    enablePresenceSocket: false,
    enableHeartbeat: false,
  });
}

interface WritableStore<T> {
  get(): T;
  set(next: T): void;
}

/**
 * The controller's own stores, behind the read-only ones the client exposes —
 * the way to put a transcript on screen without a server. (The Flutter tests
 * do the same through the `ValueNotifier` behind each listenable.)
 */
function controllerStores(): {
  messages: WritableStore<readonly ChatMessage[]>;
  visitorMode: WritableStore<string>;
  agentTyping: WritableStore<boolean>;
  assistantTyping: WritableStore<boolean>;
  isOpen: WritableStore<boolean>;
  availabilityReason: WritableStore<string>;
  closureLabel: WritableStore<string | null>;
  nextOpenLocal: WritableStore<string | null>;
  nextOpenAt: WritableStore<Date | null>;
  assistantCovers: WritableStore<boolean>;
} {
  const controller = (EasyLiveChat.instance as unknown as { controller: unknown }).controller;
  if (controller == null) throw new Error('bootOffline() first');
  return controller as ReturnType<typeof controllerStores>;
}

export function setMessages(messages: readonly ChatMessage[]): void {
  act(() => controllerStores().messages.set(messages));
}

export function currentMessages(): readonly ChatMessage[] {
  return EasyLiveChat.instance.messages.get();
}

export function setVisitorMode(mode: 'CHAT' | 'NOTICE_ONLY'): void {
  act(() => controllerStores().visitorMode.set(mode));
}

/**
 * Someone on the team composing — and whether it is the assistant. The core
 * keeps `agentTyping` true while the assistant types, so `assistant` alone
 * never shows a row.
 */
export function setTyping(agent: boolean, assistant = false): void {
  act(() => {
    const c = controllerStores();
    c.agentTyping.set(agent);
    c.assistantTyping.set(assistant);
  });
}

export interface AvailabilityFixture {
  isOpen?: boolean;
  reason?: 'OPEN' | 'AFTER_HOURS' | 'HOLIDAY' | 'NO_AGENTS';
  closureLabel?: string | null;
  nextOpenLocal?: string | null;
  nextOpenAt?: Date | null;
  assistantCovers?: boolean;
}

/**
 * The workspace's availability, as a config fetch or a
 * `workspace:availability` push would leave it. Fields left out reset to an
 * open workspace with nobody covering.
 */
export function setAvailability(a: AvailabilityFixture = {}): void {
  act(() => {
    const c = controllerStores();
    c.isOpen.set(a.isOpen ?? (a.reason == null || a.reason === 'OPEN'));
    c.availabilityReason.set(a.reason ?? 'OPEN');
    c.closureLabel.set(a.closureLabel ?? null);
    c.nextOpenLocal.set(a.nextOpenLocal ?? null);
    c.nextOpenAt.set(a.nextOpenAt ?? null);
    c.assistantCovers.set(a.assistantCovers ?? false);
  });
}

/**
 * Let pending promise callbacks (a fake API's answer, a send's rejection, a
 * lazy import) run. Microtasks only, so it works under fake timers too.
 */
export async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

/**
 * Let a lazy `import()` of an optional peer resolve. Loading a module — even a
 * mocked one — goes through the runner's module loader, which takes
 * macrotasks, not just microtasks. Real timers only.
 */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

/** Advance fake timers by `ms`, inside `act`, then let what they started settle. */
export async function elapse(ms: number): Promise<void> {
  const { vi } = await import('vitest');
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

// ── reading layout without a layout engine ──────────────────────────────────
//
// There is no Yoga under the test renderer, so nothing has a position. What
// the SDK does have is an explicit, physical answer for every row: it never
// leans on the host's direction, it writes `row` or `row-reverse` from the
// chat's own (see `directionStyles`). The host here is LTR (`I18nManager.isRTL`
// is false in the stand-in), so `row-reverse` IS right-to-left on screen.

/** Whether a node is the stand-in's host element `name` (`View`, `Animated.View`, …). */
export function isHost(node: ReactTestInstance, name: string): boolean {
  return (node.type as unknown) === name;
}

/** Flattened style of a test instance (arrays and falsy entries merged). */
export function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const flat = (s: unknown): Record<string, unknown> =>
    Array.isArray(s)
      ? Object.assign({}, ...s.map(flat))
      : s != null && typeof s === 'object'
        ? (s as Record<string, unknown>)
        : {};
  return flat(node.props.style);
}

/** All the text under a node, concatenated. */
export function textOf(node: ReactTestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map(textOf).join('');
}

/** The nearest enclosing host row (`row` / `row-reverse`) of a node. */
export function rowOf(node: ReactTestInstance): ReactTestInstance {
  let at: ReactTestInstance | null = node.parent;
  while (at != null) {
    if (typeof at.type === 'string') {
      const fd = styleOf(at).flexDirection;
      if (fd === 'row' || fd === 'row-reverse') return at;
    }
    at = at.parent;
  }
  throw new Error('no row above this node');
}

/**
 * The texts of a row's children as they appear on screen, left to right —
 * children with no text (spacers, icons) dropped.
 */
export function leftToRight(row: ReactTestInstance): string[] {
  const texts = row.children.map(textOf).filter((t) => t.length > 0);
  return styleOf(row).flexDirection === 'row-reverse' ? texts.reverse() : texts;
}

/** Whether a row's children run right-to-left on screen. */
export function runsRightToLeft(row: ReactTestInstance): boolean {
  return styleOf(row).flexDirection === 'row-reverse';
}
