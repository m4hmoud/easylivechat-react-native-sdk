import { type ChatMessage, EasyLiveChat, parseWidgetConfig } from '@easylivechat/react-native';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DirectionProvider } from '../src/direction';
import { __resetOverrides, stringsFor } from '../src/l10n';
import { LinkPreviewCard } from '../src/views/link-preview-card';
import { MessageBubble } from '../src/views/message-bubble';
import { ThreadView } from '../src/views/thread-view';
import {
  RTL_THEME,
  THEME,
  bootOffline,
  isHost,
  message,
  setMessages,
  setWidgetConfig,
  styleOf,
} from './support';

/**
 * Link previews (C2) — the web widget's `components/LinkPreview.tsx`: the
 * server's card under a message with a link in it. The site, the page's
 * title, a line of its description and its picture; tappable, http/https
 * only; a picture that will not load simply goes.
 */
const PREVIEW = {
  url: 'https://shop.example.com/shoes/42',
  title: 'Trail runner 42',
  description: 'Light, grippy, waterproof.',
  siteName: 'Example Shop',
  imageUrl: '/uploads/previews/abc.jpg',
};

function withPreview(
  id: string,
  senderType: 'agent' | 'customer',
  preview: Record<string, unknown> = PREVIEW,
  extra: Record<string, unknown> = {},
): ChatMessage {
  return message({
    id,
    senderType,
    body: `Have a look: ${String(preview.url)}`,
    metadata: { linkPreview: preview },
    ...extra,
  });
}

function bubble(m: ChatMessage, opts: { rtl?: boolean; showLinkPreview?: boolean } = {}) {
  render(
    <DirectionProvider value={opts.rtl ? 'rtl' : 'ltr'}>
      <MessageBubble
        message={m}
        theme={opts.rtl ? RTL_THEME : THEME}
        showAgentName
        showAgentAvatar={false}
        strings={stringsFor(opts.rtl ? 'ar' : 'en')}
        agentLastReadAt={null}
        onOpenImage={() => undefined}
        showLinkPreview={opts.showLinkPreview}
      />
    </DirectionProvider>,
  );
}

const card = (): ReactTestInstance => screen.UNSAFE_getByType(LinkPreviewCard);

beforeAll(bootOffline);
afterAll(() => EasyLiveChat.instance.shutdown());
afterEach(() => {
  cleanup();
  setMessages([]);
  setWidgetConfig(null);
  vi.mocked(Linking.openURL).mockClear();
  __resetOverrides();
});

describe('the link preview card', () => {
  it('draws the site, the title and the description under the message', () => {
    bubble(withPreview('a1', 'agent'));
    expect(screen.getByText('Example Shop')).toBeTruthy();
    expect(screen.getByText('Trail runner 42')).toBeTruthy();
    expect(screen.getByText('Light, grippy, waterproof.')).toBeTruthy();
    // The words of the message are still the bubble's.
    expect(screen.getByText(/Have a look:/)).toBeTruthy();
  });

  it('is under the visitor’s own messages too', () => {
    bubble(withPreview('m1', 'customer'));
    expect(screen.getByText('Trail runner 42')).toBeTruthy();
  });

  it('opens the page in the browser', () => {
    bubble(withPreview('a1', 'agent'));
    fireEvent.press(screen.getByText('Trail runner 42'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://shop.example.com/shoes/42');
  });

  it('never draws a preview of anything but http(s)', () => {
    bubble(withPreview('a1', 'agent', { ...PREVIEW, url: 'javascript:alert(1)' }));
    expect(screen.UNSAFE_queryAllByType(LinkPreviewCard)).toHaveLength(0);
    expect(screen.queryByText('Trail runner 42')).toBeNull();
  });

  it('shows the server’s picture, resolved against the API', () => {
    bubble(withPreview('a1', 'agent'));
    const image = card().findAll((n) => isHost(n, 'Image'))[0]!;
    expect(image.props.source).toEqual({ uri: 'https://api.example.com/uploads/previews/abc.jpg' });
  });

  it('drops the picture — and its gap — when it fails to load', () => {
    bubble(withPreview('a1', 'agent'));
    const before = card().findAll((n) => isHost(n, 'View') && styleOf(n).width === 10);
    expect(before).toHaveLength(1);
    fireEvent(card().findAll((n) => isHost(n, 'Image'))[0]!, 'error');
    expect(card().findAll((n) => isHost(n, 'Image'))).toHaveLength(0);
    expect(card().findAll((n) => isHost(n, 'View') && styleOf(n).width === 10)).toHaveLength(0);
    // The words stay.
    expect(screen.getByText('Trail runner 42')).toBeTruthy();
  });

  it('has no picture when the server gave none', () => {
    bubble(withPreview('a1', 'agent', { ...PREVIEW, imageUrl: undefined }));
    expect(card().findAll((n) => isHost(n, 'Image'))).toHaveLength(0);
  });

  it('is not drawn under a card message', () => {
    bubble(
      withPreview('a1', 'agent', PREVIEW, {
        contentType: 'CARD',
        metadata: { linkPreview: PREVIEW, card: { title: 'Trail runner 42 card' } },
      }),
    );
    expect(screen.getByText('Trail runner 42 card')).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(LinkPreviewCard)).toHaveLength(0);
  });

  it('is not drawn while the bubble is told not to', () => {
    bubble(withPreview('a1', 'agent'), { showLinkPreview: false });
    expect(screen.UNSAFE_queryAllByType(LinkPreviewCard)).toHaveLength(0);
  });

  it('puts the picture at the leading edge, mirrored in RTL — each line facing its own way', () => {
    bubble(withPreview('a1', 'agent', { ...PREVIEW, title: 'حذاء الجري 42', siteName: 'Example Shop' }), { rtl: true });
    const row = card().findAll((n) => isHost(n, 'View') && styleOf(n).flexDirection != null)[0]!;
    // An LTR host with an RTL chat: `row-reverse` IS right-to-left.
    expect(styleOf(row).flexDirection).toBe('row-reverse');
    expect(styleOf(screen.getByText('حذاء الجري 42'))).toMatchObject({ textAlign: 'right', writingDirection: 'rtl' });
    // A Latin site name in an Arabic chat still starts at the left.
    expect(styleOf(screen.getByText('Example Shop'))).toMatchObject({ textAlign: 'left', writingDirection: 'ltr' });
  });
});

describe('in the thread', () => {
  it('follows the workspace’s switch', () => {
    setMessages([withPreview('a1', 'agent')]);
    setWidgetConfig(parseWidgetConfig({ linkPreviews: true }));
    render(<ThreadView theme={THEME} strings={stringsFor('en')} />);
    expect(screen.getByText('Trail runner 42')).toBeTruthy();
    cleanup();

    setWidgetConfig(parseWidgetConfig({ linkPreviews: false }));
    render(<ThreadView theme={THEME} strings={stringsFor('en')} />);
    expect(screen.queryByText('Trail runner 42')).toBeNull();
  });

  it('arrives with the update that brings it, in place', () => {
    const plain = message({ id: 'a1', body: 'Have a look: https://shop.example.com/shoes/42' });
    setMessages([plain]);
    render(<ThreadView theme={THEME} strings={stringsFor('en')} />);
    expect(screen.queryByText('Trail runner 42')).toBeNull();
    setMessages([{ ...plain, metadata: { linkPreview: PREVIEW } }]);
    expect(screen.getByText('Trail runner 42')).toBeTruthy();
  });
});
