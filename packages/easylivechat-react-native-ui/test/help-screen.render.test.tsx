import {
  type HelpArticle,
  type HelpArticleList,
  type HelpArticleSummary,
  EasyLiveChatError,
} from '@easylivechat/react-native';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EasyLiveChatScreen } from '../src/chat-screen';
import { DirectionProvider } from '../src/direction';
import { EasyLiveChatHelpScreen } from '../src/help-screen';
import { __resetOverrides } from '../src/l10n';
import { HelpMarkdownView } from '../src/views/help-markdown-view';
import { type ElcHelpApi, offerHelpEntry } from '../src/views/help-view';
import { THEME, elapse, flush, message, rowOf, runsRightToLeft, styleOf } from './support';

/**
 * Port of `help_screen_widget_test.dart`: list → search → article → "Was this
 * helpful?" → chat.
 *
 * Driven through a fake `ElcHelpApi`, so it needs neither a booted SDK nor a
 * network. Also covers the renderer's link handling (only checked schemes are
 * tappable) and RTL: an Arabic visitor gets the Arabic chrome laid out
 * right-to-left.
 */
const summary = (id: string, title: string, excerpt = ''): HelpArticleSummary => ({
  id,
  title,
  excerpt,
  category: null,
  updatedAt: null,
});

class FakeApi implements ElcHelpApi {
  queries: string[] = [];
  opened: string[] = [];
  ratings: Array<[string, boolean]> = [];
  failLists = 0;

  async list(query: string): Promise<HelpArticleList> {
    this.queries.push(query);
    if (this.failLists > 0) {
      this.failLists--;
      throw new EasyLiveChatError('NETWORK');
    }
    if (query === '') {
      return {
        enabled: true,
        categories: [],
        articles: [summary('a1', 'Reset your password', 'Open Settings'), summary('a2', 'Shipping times')],
      };
    }
    if (query === 'zzz') return { enabled: true, categories: [], articles: [] };
    return { enabled: true, categories: [], articles: [summary('a2', 'Shipping times')] };
  }

  async article(id: string): Promise<HelpArticle> {
    this.opened.push(id);
    if (id === 'gone') throw new EasyLiveChatError('NOT_FOUND', { httpStatus: 404 });
    if (id === 'flaky' && this.opened.filter((o) => o === 'flaky').length === 1) {
      throw new EasyLiveChatError('NETWORK');
    }
    if (id === 'ar') {
      return {
        id,
        title: 'إعادة تعيين كلمة المرور',
        body: 'افتح **الإعدادات**\n\n```\nnpm install\n```',
        category: null,
        locale: 'ar',
        updatedAt: null,
        url: '',
      };
    }
    return {
      id,
      title: 'Reset your password',
      body: '## Steps\n\n1. Open **Settings**\n2. Read [the guide](https://acme.com/guide)',
      category: null,
      locale: 'en',
      updatedAt: null,
      url: '',
    };
  }

  async rate(id: string, helpful: boolean): Promise<void> {
    this.ratings.push([id, helpful]);
  }
}

async function open(props: Partial<React.ComponentProps<typeof EasyLiveChatHelpScreen>> & { api: ElcHelpApi }) {
  render(<EasyLiveChatHelpScreen {...props} />);
  await flush();
}

async function typeQuery(text: string): Promise<void> {
  fireEvent.changeText(screen.getByLabelText('Search help articles'), text);
  await flush();
}

describe('EasyLiveChatHelpScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    __resetOverrides();
  });

  it('lists the top articles before anything is typed', async () => {
    const api = new FakeApi();
    await open({ api });

    expect(api.queries).toEqual(['']);
    expect(screen.getByText('Popular articles')).toBeTruthy();
    expect(screen.getByText('Reset your password')).toBeTruthy();
    expect(screen.getByText('Shipping times')).toBeTruthy();
    expect(screen.getByText('Still need help?')).toBeTruthy();
    expect(screen.getByText('Help articles')).toBeTruthy();
  });

  it('says it is loading, to a screen reader too', async () => {
    const api = new FakeApi();
    let release: () => void = () => undefined;
    api.list = (q) =>
      new Promise((resolve) => {
        release = () => resolve(FakeApi.prototype.list.call(new FakeApi(), q));
      });
    await open({ api });
    expect(screen.getByLabelText('Loading…')).toBeTruthy();
    release();
    await flush();
    expect(screen.queryByLabelText('Loading…')).toBeNull();
  });

  it('searches once typing pauses, says how many it found, and when nothing matches', async () => {
    const api = new FakeApi();
    await open({ api });

    await typeQuery('ship');
    // Debounced: nothing yet.
    expect(api.queries).toEqual(['']);
    await elapse(350);
    expect(api.queries).toEqual(['', 'ship']);
    expect(screen.queryByText('Reset your password')).toBeNull();
    expect(screen.getByText('Shipping times')).toBeTruthy();
    // A live region for TalkBack, an announcement for VoiceOver.
    const count = screen.getByLabelText('Articles found: 1');
    expect(count.props.accessibilityLiveRegion).toBe('polite');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Articles found: 1');
    expect(screen.queryByText('Popular articles')).toBeNull();

    await typeQuery('zzz');
    await elapse(350);
    expect(screen.getByText('No articles match your search.')).toBeTruthy();

    // Clearing goes back to the top list.
    fireEvent.press(screen.getByLabelText('Clear search'));
    await elapse(350);
    expect(api.queries.at(-1)).toBe('');
    expect(screen.getByText('Popular articles')).toBeTruthy();
    expect(screen.queryByLabelText('Clear search')).toBeNull();
  });

  it('a one-character query is still the top list', async () => {
    const api = new FakeApi();
    await open({ api });
    await typeQuery('s');
    await elapse(350);
    expect(api.queries).toEqual(['']);
  });

  it('a search submitted from the keyboard does not wait', async () => {
    const api = new FakeApi();
    await open({ api });
    await typeQuery('ship');
    fireEvent(screen.getByLabelText('Search help articles'), 'submitEditing');
    await flush();
    expect(api.queries).toEqual(['', 'ship']);
  });

  it('a list that will not load says so, and retries', async () => {
    const api = new FakeApi();
    api.failLists = 1;
    await open({ api });
    expect(screen.getByText('Help articles could not be loaded. Please try again.')).toBeTruthy();

    fireEvent.press(screen.getByText('Retry'));
    await flush();
    expect(screen.getByText('Shipping times')).toBeTruthy();
    expect(screen.queryByText('Help articles could not be loaded. Please try again.')).toBeNull();
  });

  it('opens an article, records the answer, and starts a chat', async () => {
    const api = new FakeApi();
    let startedChat = 0;
    await open({ api, onClose: () => undefined, onStartChat: () => startedChat++ });

    fireEvent.press(screen.getByText('Reset your password'));
    await flush();
    expect(api.opened).toEqual(['a1']);
    expect(screen.getByText('Steps')).toBeTruthy();
    expect(screen.getByText('Was this helpful?')).toBeTruthy();

    fireEvent.press(screen.getByText('Yes'));
    await flush();
    expect(api.ratings).toEqual([['a1', true]]);
    expect(screen.getByText('Thanks for your feedback.')).toBeTruthy();
    expect(screen.queryByText('Was this helpful?')).toBeNull();

    fireEvent.press(screen.getByText('Start a chat'));
    expect(startedChat).toBe(1);

    // Back returns to the list, not out of help.
    fireEvent.press(screen.getByLabelText('Back'));
    await flush();
    expect(screen.getByText('Popular articles')).toBeTruthy();

    // …and the answer is remembered for the rest of the visit.
    fireEvent.press(screen.getByText('Reset your password'));
    await flush();
    expect(screen.getByText('Thanks for your feedback.')).toBeTruthy();
  });

  it('an article that has gone says so — not that something broke', async () => {
    await open({ api: new FakeApi(), initialArticleId: 'gone' });
    expect(screen.getByText('This article is no longer available.')).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();
    // Still a way forward.
    expect(screen.getByText('Start a chat')).toBeTruthy();
  });

  it('an article that will not load offers a retry', async () => {
    const api = new FakeApi();
    await open({ api, initialArticleId: 'flaky' });
    expect(screen.getByText('Help articles could not be loaded. Please try again.')).toBeTruthy();
    fireEvent.press(screen.getByText('Retry'));
    await flush();
    expect(api.opened).toEqual(['flaky', 'flaky']);
    expect(screen.getByText('Steps')).toBeTruthy();
  });

  it('a link in an article goes to onOpenLink', async () => {
    const opened: string[] = [];
    await open({ api: new FakeApi(), initialArticleId: 'a1', onOpenLink: (u) => void opened.push(u) });
    fireEvent.press(screen.getByText('the guide'));
    await flush();
    expect(opened).toEqual(['https://acme.com/guide']);
  });

  it('with no onStartChat, "Start a chat" opens the chat in its place', async () => {
    await open({ api: new FakeApi() });
    expect(screen.UNSAFE_queryByType(EasyLiveChatScreen)).toBeNull();
    fireEvent.press(screen.getByText('Start a chat'));
    expect(screen.UNSAFE_getByType(EasyLiveChatScreen).props.showAppBar).toBe(true);
    expect(screen.queryByText('Popular articles')).toBeNull();
  });

  it('without its own header, an article still has a way back to the list', async () => {
    await open({ api: new FakeApi(), showAppBar: false });
    expect(screen.queryByText('Help articles')).toBeNull();
    fireEvent.press(screen.getByText('Reset your password'));
    await flush();
    fireEvent.press(screen.getByText('Back'));
    await flush();
    expect(screen.getByText('Popular articles')).toBeTruthy();
  });

  it('Arabic chrome, laid out right to left', async () => {
    await open({ api: new FakeApi(), locale: 'ar', directionOverride: 'rtl', onClose: () => undefined });

    expect(screen.getByText('المقالات الأكثر قراءة')).toBeTruthy();
    expect(screen.getByText('ابدأ محادثة')).toBeTruthy();
    // The header runs right to left, so the back arrow — its first child —
    // sits on the reading side: the right edge.
    const header = rowOf(screen.getByText('مقالات المساعدة'));
    expect(runsRightToLeft(header)).toBe(true);
    expect((header.children[0] as ReactTestInstance).props.accessibilityLabel).toBe('رجوع');
    // And the arrow itself is mirrored to point that way.
    const arrow = screen.getByLabelText('رجوع').children[0] as ReactTestInstance;
    expect(styleOf(arrow)).toMatchObject({ transform: [{ scaleX: -1 }] });
  });

  it('an article reads in its own language’s direction, whatever the app’s', async () => {
    await open({ api: new FakeApi(), initialArticleId: 'ar' });
    expect(styleOf(screen.getByText('إعادة تعيين كلمة المرور'))).toMatchObject({
      textAlign: 'right',
      writingDirection: 'rtl',
    });
    const paragraph = screen.getByText(/^افتح/);
    expect(styleOf(paragraph)).toMatchObject({ textAlign: 'right', writingDirection: 'rtl' });
    // Code reads left to right whatever surrounds it.
    expect(styleOf(screen.getByText('npm install'))).toMatchObject({ textAlign: 'left' });
    // The chrome around it stays the screen's.
    expect(styleOf(screen.getByText('Was this helpful?'))).toMatchObject({ textAlign: 'left' });
  });

  it('the list rows are buttons a screen reader can name', async () => {
    await open({ api: new FakeApi() });
    const row = screen.getByRole('button', { name: 'Shipping times' });
    fireEvent.press(row);
    await flush();
    expect(screen.getByText('Was this helpful?')).toBeTruthy();
  });
});

describe('offerHelpEntry', () => {
  const on = { helpArticlesEnabled: true };
  const off = { helpArticlesEnabled: false };
  const msg = (senderType: string) => message({ id: `m-${senderType}`, senderType });

  it('only when the workspace shows help', () => {
    expect(offerHelpEntry(off, [])).toBe(false);
    expect(offerHelpEntry(null, [])).toBe(false);
    expect(offerHelpEntry(on, [])).toBe(true);
  });

  it('until the visitor has written', () => {
    expect(offerHelpEntry(on, [msg('agent')])).toBe(true);
    expect(offerHelpEntry(on, [msg('agent'), msg('customer')])).toBe(false);
  });
});

describe('HelpMarkdownView links', () => {
  afterEach(cleanup);

  function body(md: string, opened: string[]) {
    render(
      <DirectionProvider value="ltr">
        <HelpMarkdownView source={md} theme={THEME} onOpenLink={(u) => void opened.push(u)} />
      </DirectionProvider>,
    );
  }

  it('a checked link opens through onOpenLink', async () => {
    const opened: string[] = [];
    body('Read [the guide](https://acme.com/g)', opened);
    expect(screen.getByRole('link', { name: 'the guide' })).toBeTruthy();
    fireEvent.press(screen.getByText('the guide'));
    await flush();
    expect(opened).toEqual(['https://acme.com/g']);
  });

  it('a javascript: link is plain text', () => {
    const opened: string[] = [];
    body('[click me](javascript:alert(1))', opened);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/javascript:alert\(1\)/)).toBeTruthy();
  });

  it('a heading is announced as one', () => {
    body('# Returns', []);
    expect(screen.getByRole('header', { name: 'Returns' })).toBeTruthy();
  });
});
