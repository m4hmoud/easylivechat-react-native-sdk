import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChat } from '../src/client';
import { useEasyLiveChatMessages, useEasyLiveChatPhase, useWorkspaceAvailability } from '../src/hooks';
import { createStore } from '../src/store';
import { InMemoryStorage } from '../src/storage';
import { useEasyLiveChatStore } from '../src/hooks';
import { configBody, installFakeServer, messageRow, sessionBody, type FakeServer } from './fake-server';
import { latestSocket, resetFakeSockets } from './fake-socket';

vi.mock('socket.io-client', async () => {
  const { fakeIo } = await import('./fake-socket');
  return { io: fakeIo };
});

/**
 * Port-specific: `useSyncExternalStore` SNAPSHOT STABILITY.
 *
 * This is the classic bug in the pattern. React calls the snapshot getter on
 * every render and compares by reference; a getter that builds a fresh array
 * each call never compares equal, so React re-renders forever. Every store
 * here holds its value rather than deriving it on read.
 */
describe('store snapshot stability', () => {
  it('returns the SAME reference until something is written', () => {
    const store = createStore<readonly number[]>([1, 2, 3]);
    expect(store.get()).toBe(store.get());
    const before = store.get();
    store.set([1, 2, 3]); // a different array with equal contents
    expect(store.get()).not.toBe(before);
  });

  it('does not notify on an Object.is-equal write', () => {
    const store = createStore('a');
    let notifications = 0;
    store.subscribe(() => {
      notifications++;
    });
    store.set('a');
    expect(notifications).toBe(0);
    store.set('b');
    expect(notifications).toBe(1);
  });

  it('renders a FINITE number of times when bound through useSyncExternalStore', () => {
    const store = createStore<readonly string[]>(['a']);
    let renders = 0;

    function Probe(): React.ReactElement {
      renders++;
      const value = useEasyLiveChatStore(store);
      // A fresh array here would re-enter the loop if the store derived on read.
      return React.createElement('probe', { count: value.length });
    }

    let tree: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      tree = TestRenderer.create(React.createElement(Probe));
    });
    const afterMount = renders;
    expect(afterMount).toBeLessThan(5);

    act(() => {
      store.set(['a', 'b']);
    });
    // Exactly one more render for one write.
    expect(renders).toBe(afterMount + 1);

    act(() => {
      tree?.unmount();
    });
  });
});

describe('hooks before boot()', () => {
  afterEach(() => {
    EasyLiveChat.instance.shutdown();
  });

  it('are SAFE and return sane defaults', () => {
    // A launcher can mount before the host has booted the SDK. Every hook must
    // return a default in that state and re-subscribe once booted; none may
    // throw.
    expect(EasyLiveChat.instance.isBooted).toBe(false);

    let seen: { phase: string; messages: readonly unknown[]; closed: boolean } | null = null;
    function Probe(): React.ReactElement {
      const phase = useEasyLiveChatPhase();
      const messages = useEasyLiveChatMessages();
      const availability = useWorkspaceAvailability();
      seen = { phase, messages, closed: availability.workspaceClosed };
      return React.createElement('probe');
    }

    let tree: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      tree = TestRenderer.create(React.createElement(Probe));
    });

    expect(seen).toEqual({ phase: 'idle', messages: [], closed: false });
    act(() => {
      tree?.unmount();
    });
  });
});

describe('hooks across a boot', () => {
  let server: FakeServer;

  beforeEach(() => {
    resetFakeSockets();
    server = installFakeServer();
    server.always('/config', { body: configBody() });
    server.always('/session', { body: sessionBody() });
  });

  afterEach(() => {
    EasyLiveChat.instance.shutdown();
    server.restore();
  });

  it('re-subscribes to the new controller WITHOUT the component re-mounting', async () => {
    const phases: string[] = [];
    const counts: number[] = [];

    function Probe(): React.ReactElement {
      phases.push(useEasyLiveChatPhase());
      counts.push(useEasyLiveChatMessages().length);
      return React.createElement('probe');
    }

    let tree: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      tree = TestRenderer.create(React.createElement(Probe));
    });
    expect(phases.at(-1)).toBe('idle');

    // Boot AFTER mount — the component stays put.
    await act(async () => {
      await EasyLiveChat.instance.boot(
        { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
        { storage: new InMemoryStorage() },
      );
      await EasyLiveChat.instance.open();
    });
    expect(phases.at(-1)).toBe('chat');

    // And live socket traffic reaches the same, still-mounted component.
    await act(async () => {
      latestSocket('/widgets').fire('message:new', messageRow({ id: 'm1' }));
    });
    expect(counts.at(-1)).toBe(1);

    act(() => {
      tree?.unmount();
    });
  });

  it('keeps an onMessage subscription taken BEFORE boot', async () => {
    // The launcher's chime subscribes before the host boots; handing it a
    // no-op unsubscribe would mean it never hears a single message.
    const seen: string[] = [];
    const off = EasyLiveChat.instance.onMessage((m) => seen.push(m.id));

    await EasyLiveChat.instance.boot(
      { apiBase: 'https://api.example.com', tenantSlug: 'acme', enableHeartbeat: false },
      { storage: new InMemoryStorage() },
    );
    await EasyLiveChat.instance.open();
    latestSocket('/widgets').fire('message:new', messageRow({ id: 'm1' }));

    expect(seen).toEqual(['m1']);
    off();
    latestSocket('/widgets').fire('message:new', messageRow({ id: 'm2' }));
    expect(seen).toEqual(['m1']);
  });
});
