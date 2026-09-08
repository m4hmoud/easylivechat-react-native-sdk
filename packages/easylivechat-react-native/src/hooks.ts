import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { EasyLiveChat } from './client';
import type { EasyLiveChatError } from './errors';
import type { ChatMessage } from './models/chat-message';
import type { ProactiveMessage } from './models/results';
import type {
  AvailabilityReason,
  VisitorMode,
  WidgetConfig,
} from './models/widget-config';
import type { ChatPhase, ConnectionState } from './session-controller';
import type { ReadonlyStore } from './store';

/**
 * Bind any SDK store to React.
 *
 * `useSyncExternalStore` is the whole point: it is tearing-free under
 * concurrent rendering, which a `useState` + `useEffect` subscription is not.
 * It calls the snapshot getter on every render and compares by reference, so
 * every store's `get()` must return a stable value between writes — which is
 * exactly what {@link ReadonlyStore} guarantees.
 *
 * Every hook below is safe BEFORE `boot()`: the facade's stores exist from
 * module load and simply report their defaults until a controller appears.
 */
export function useEasyLiveChatStore<T>(store: ReadonlyStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function useEasyLiveChatPhase(): ChatPhase {
  return useEasyLiveChatStore(EasyLiveChat.instance.phase);
}

export function useEasyLiveChatMessages(): readonly ChatMessage[] {
  return useEasyLiveChatStore(EasyLiveChat.instance.messages);
}

export function useWidgetConfig(): WidgetConfig | null {
  return useEasyLiveChatStore(EasyLiveChat.instance.widgetConfig);
}

export function useConnectionState(): ConnectionState {
  return useEasyLiveChatStore(EasyLiveChat.instance.connection);
}

export function useAgentTyping(): boolean {
  return useEasyLiveChatStore(EasyLiveChat.instance.agentTyping);
}

export function useUnreadCount(): number {
  return useEasyLiveChatStore(EasyLiveChat.instance.unreadCount);
}

export function useAgentLastReadAt(): Date | null {
  return useEasyLiveChatStore(EasyLiveChat.instance.agentLastReadAt);
}

export interface WorkspaceAvailabilityView {
  isOpen: boolean;
  agentsAccepting: boolean;
  visitorMode: VisitorMode;
  reason: AvailabilityReason;
  nextOpenAt: Date | null;
  nextOpenLocal: string | null;
  timezone: string | null;
  closureLabel: string | null;
  /** Presentational: show a notice. Never blocks writing. */
  workspaceClosed: boolean;
  /** `visitorMode === 'NOTICE_ONLY'` — disable the composer, do not hide it. */
  composerLocked: boolean;
}

/**
 * Every availability field at once, so a notice banner does not have to bind
 * nine stores by hand.
 *
 * The returned object is memoised on its parts, so it is referentially stable
 * while nothing changes — otherwise it would defeat every `React.memo` below it.
 */
export function useWorkspaceAvailability(): WorkspaceAvailabilityView {
  const elc = EasyLiveChat.instance;
  const isOpen = useEasyLiveChatStore(elc.isOpen);
  const agentsAccepting = useEasyLiveChatStore(elc.agentsAccepting);
  const visitorMode = useEasyLiveChatStore(elc.visitorMode);
  const reason = useEasyLiveChatStore(elc.availabilityReason);
  const nextOpenAt = useEasyLiveChatStore(elc.nextOpenAt);
  const nextOpenLocal = useEasyLiveChatStore(elc.nextOpenLocal);
  const timezone = useEasyLiveChatStore(elc.workspaceTimezone);
  const closureLabel = useEasyLiveChatStore(elc.closureLabel);

  return useMemo(
    () => ({
      isOpen,
      agentsAccepting,
      visitorMode,
      reason,
      nextOpenAt,
      nextOpenLocal,
      timezone,
      closureLabel,
      workspaceClosed: elc.workspaceClosed,
      composerLocked: visitorMode === 'NOTICE_ONLY',
    }),
    [
      elc,
      isOpen,
      agentsAccepting,
      visitorMode,
      reason,
      nextOpenAt,
      nextOpenLocal,
      timezone,
      closureLabel,
    ],
  );
}

/** True once `boot()` has run. Re-renders when the SDK boots or shuts down. */
export function useIsBooted(): boolean {
  const elc = EasyLiveChat.instance;
  const subscribe = useCallback((fn: () => void) => elc.onLifecycleChange(fn), [elc]);
  const snapshot = useCallback(() => elc.isBooted, [elc]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The singleton itself, for actions (`sendMessage`, `open`, `endChat`, …). */
export function useEasyLiveChat(): EasyLiveChat {
  return EasyLiveChat.instance;
}

/** Subscribe to each arriving message for the life of the component. */
export function useOnMessage(fn: (m: ChatMessage) => void): void {
  useEffect(() => EasyLiveChat.instance.onMessage(fn), [fn]);
}

/** Subscribe to proactive agent outreach for the life of the component. */
export function useOnProactiveMessage(fn: (p: ProactiveMessage) => void): void {
  useEffect(() => EasyLiveChat.instance.onProactiveMessage(fn), [fn]);
}

/** Subscribe to SDK errors for the life of the component. */
export function useOnError(fn: (e: EasyLiveChatError) => void): void {
  useEffect(() => EasyLiveChat.instance.onError(fn), [fn]);
}
