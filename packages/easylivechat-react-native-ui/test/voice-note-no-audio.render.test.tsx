import { EasyLiveChat } from '@easylivechat/react-native';
import { cleanup, render, screen } from '@testing-library/react-native';
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DirectionProvider } from '../src/direction';
import { DownloadIcon, PlayIcon } from '../src/icons';
import { stringsFor } from '../src/l10n';
import { MessageBubble } from '../src/views/message-bubble';
import { __resetVoicePlayback } from '../src/views/voice-note-tile';
import { THEME, bootOffline, message, settle } from './support';

/**
 * `expo-audio` is an OPTIONAL peer: a host that never enables voice messages
 * does not install it — and a visitor of that host can still be SENT a voice
 * note, from another channel. The note must not become a dead play button.
 *
 * Its own file because the setup's "not installed" default is what is under
 * test, and a file that has loaded a mocked `expo-audio` keeps it.
 */
beforeAll(bootOffline);
afterAll(() => EasyLiveChat.instance.shutdown());
afterEach(async () => {
  await settle();
  cleanup();
  vi.restoreAllMocks();
});

describe('a voice note with no audio peer installed', () => {
  it('degrades to its download chip, so the file is never unreachable', async () => {
    __resetVoicePlayback();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(
      <DirectionProvider value="ltr">
        <MessageBubble
          message={message({
            senderType: 'customer',
            body: '',
            contentType: 'AUDIO',
            attachmentUrls: ['/uploads/t1/2026-09/note.m4a'],
          })}
          theme={THEME}
          showAgentName={false}
          showAgentAvatar={false}
          strings={stringsFor('en')}
          agentLastReadAt={null}
          onOpenImage={() => undefined}
        />
      </DirectionProvider>,
    );
    await settle();
    expect(screen.UNSAFE_queryAllByType(PlayIcon)).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(DownloadIcon)).toHaveLength(1);
    // …and says why, for the developer.
    expect(String(warn.mock.calls[0]?.[0])).toContain('expo-audio is not installed');
  });
});
