import { Linking } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stringsFor } from '../src/l10n';
import { openHelpLink } from '../src/views/help-markdown-view';
import { helpArticleDirection } from '../src/views/help-view';

/**
 * The pure halves of the help article view: which way an article faces and
 * what a tap is allowed to open. Drawing is in help-screen.render.test.tsx.
 */
describe('helpArticleDirection', () => {
  const article = (locale: string | null, title: string, body = '') => ({ locale, title, body });

  it('follows the article’s language when the server says which', () => {
    expect(helpArticleDirection(article('ar', 'Hello'), 'ltr')).toBe('rtl');
    expect(helpArticleDirection(article('ckb', 'Hello'), 'ltr')).toBe('rtl');
    expect(helpArticleDirection(article('ur-PK', 'Hello'), 'ltr')).toBe('rtl');
    // The language wins over the script of its first word.
    expect(helpArticleDirection(article('en', 'مرحبا'), 'rtl')).toBe('ltr');
  });

  it('else reads its first strong character, title first', () => {
    expect(helpArticleDirection(article(null, 'مرحبا in English'), 'ltr')).toBe('rtl');
    expect(helpArticleDirection(article(null, '123', 'Open Settings'), 'rtl')).toBe('ltr');
  });

  it('else keeps the screen’s', () => {
    expect(helpArticleDirection(article(null, '123', '— 456'), 'rtl')).toBe('rtl');
    expect(helpArticleDirection(article(null, '', ''), 'ltr')).toBe('ltr');
  });
});

describe('openHelpLink', () => {
  const openURL = Linking.openURL as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => openURL.mockClear());

  it('opens http(s), mailto and tel through Linking', async () => {
    await openHelpLink('https://acme.com/help');
    await openHelpLink('mailto:help@acme.com');
    await openHelpLink('tel:+9647700000000');
    expect(openURL.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'https://acme.com/help',
      'mailto:help@acme.com',
      'tel:+9647700000000',
    ]);
  });

  it('refuses every other scheme at the moment of the tap', async () => {
    const hook = vi.fn();
    for (const href of [
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'intent://scan/#Intent;scheme=zxing;end',
      'file:///etc/passwd',
    ]) {
      await openHelpLink(href);
      await openHelpLink(href, hook);
    }
    expect(openURL).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
  });

  it('hands a checked link to the host’s onOpenLink instead of the platform', async () => {
    const hook = vi.fn();
    await openHelpLink('https://acme.com/guide', hook);
    expect(hook).toHaveBeenCalledWith('https://acme.com/guide');
    expect(openURL).not.toHaveBeenCalled();
  });

  it('never throws when the platform, or the hook, refuses', async () => {
    openURL.mockRejectedValueOnce(new Error('no handler'));
    await expect(openHelpLink('https://acme.com')).resolves.toBeUndefined();
    await expect(
      openHelpLink('https://acme.com', () => Promise.reject(new Error('nope'))),
    ).resolves.toBeUndefined();
  });
});

describe('help chrome strings', () => {
  it('are translated, not English, in the RTL locales', () => {
    const keys = [
      'helpTitle',
      'helpBrowse',
      'helpSearchPlaceholder',
      'helpSearchClear',
      'helpTopArticles',
      'helpResultsFound',
      'helpLoading',
      'helpLoadFailed',
      'helpArticleUnavailable',
      'helpWasHelpful',
      'helpFeedbackThanks',
      'helpStartChat',
      'helpBack',
    ];
    for (const locale of ['ar', 'ckb', 'kmr', 'ur']) {
      const s = stringsFor(locale);
      for (const key of keys) {
        expect(s.t(key), `${locale}.${key}`).not.toBe(stringsFor('en').t(key));
      }
    }
  });

  it('are worded as in the web widget and easylivechat_ui', () => {
    const en = stringsFor('en');
    expect(en.t('helpTitle')).toBe('Help articles');
    expect(en.t('helpBrowse')).toBe('Browse help articles');
    expect(en.t('helpTopArticles')).toBe('Popular articles');
    expect(en.t('helpNoResults')).toBe('No articles match your search.');
    expect(en.t('helpResultsFound')).toBe('Articles found: {n}');
    expect(en.t('helpStartChat')).toBe('Start a chat');
  });
});
