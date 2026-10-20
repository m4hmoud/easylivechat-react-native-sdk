import { type ChatMessage, EasyLiveChat } from '@easylivechat/react-native';
import { cleanup, render, screen } from '@testing-library/react-native';
import React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DirectionProvider } from '../src/direction';
import { BrokenImageIcon, DownloadIcon, FileIcon, PlayIcon } from '../src/icons';
import { stringsFor } from '../src/l10n';
import { MessageBubble } from '../src/views/message-bubble';
import { VoiceNoteTile, __resetVoicePlayback } from '../src/views/voice-note-tile';
import { THEME, bootOffline, message, settle } from './support';

/**
 * Port of `voice_note_widget_test.dart`: a voice note is something you listen
 * to.
 *
 * The SDK could record and send them, but the thread rendered what came back
 * through the generic attachment path: the visitor's own recording appeared
 * as a uuid with a download arrow beside it, and hearing it meant saving a
 * file and leaving the chat.
 */
// Present here, with a player that knows its length at once. (The setup makes
// it absent everywhere else; voice-note-no-audio.render.test.tsx is that case.)
vi.mock('expo-audio', () => ({
  createAudioPlayer: () => ({
    duration: 4,
    currentTime: 0,
    playing: false,
    play: () => undefined,
    pause: () => undefined,
    seekTo: () => undefined,
    remove: () => undefined,
  }),
}));

const voice = (wire: Record<string, unknown> = {}): ChatMessage =>
  message({
    id: 'm1',
    senderType: 'customer',
    body: '',
    contentType: 'AUDIO',
    createdAt: new Date(Date.UTC(2026, 8, 14, 15, 50)).toISOString(),
    ...wire,
  });

function pump(m: ChatMessage, rtl = false) {
  render(
    <DirectionProvider value={rtl ? 'rtl' : 'ltr'}>
      <MessageBubble
        message={m}
        theme={{ ...THEME, direction: rtl ? 'rtl' : 'ltr' }}
        showAgentName={false}
        showAgentAvatar={false}
        strings={stringsFor('en')}
        agentLastReadAt={null}
        onOpenImage={() => undefined}
      />
    </DirectionProvider>,
  );
}

const tiles = () => screen.UNSAFE_queryAllByType(VoiceNoteTile);
const chips = () => screen.UNSAFE_queryAllByType(DownloadIcon);

beforeAll(bootOffline);
afterAll(() => EasyLiveChat.instance.shutdown());
beforeEach(() => {
  __resetVoicePlayback();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(async () => {
  // Every tile starts a lazy `import('expo-audio')` on mount. Let them land
  // inside the test that started them: one resolving during the NEXT test
  // writes the module-level peer cache after that test reset it.
  await settle();
  cleanup();
  vi.restoreAllMocks();
});

describe('a voice note in the thread', () => {
  it('plays instead of offering a download', () => {
    // Exactly what the composer produces: the upload returns a uuid path and
    // the send puts it in the flat url list, with no rich attachment.
    pump(voice({ attachmentUrls: ['/uploads/t1/2026-09/15ff7ad3-c699-4bbe.m4a'] }));
    expect(tiles()).toHaveLength(1);
    // The download chip is what the bug looked like.
    expect(chips()).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(FileIcon)).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(PlayIcon)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Play voice message' })).toBeTruthy();
  });

  it('says what it is until it knows how long it is — then its length', async () => {
    pump(voice({ attachmentUrls: ['/uploads/t1/2026-09/note.m4a'] }));
    // The file is fetched up front; until it arrives there is no length.
    expect(screen.getByText('Voice message')).toBeTruthy();
    await settle();
    expect(screen.getByText('0:04')).toBeTruthy();
    expect(screen.queryByText('Voice message')).toBeNull();
  });

  it('the rehosted attachment plays on its kind, not its extension', () => {
    // `kind` comes from the mime type, so it catches a container this end has
    // never heard of — here a url with no extension at all.
    pump(voice({ attachments: [{ url: '/uploads/t1/2026-09/15ff7ad3', mime: 'audio/mp4', kind: 'audio' }] }));
    expect(tiles()).toHaveLength(1);
    expect(chips()).toHaveLength(0);
  });

  it('every container the API accepts for audio plays', () => {
    for (const ext of ['m4a', 'mp3', 'ogg', 'oga', 'opus', 'aac', 'amr', 'wav']) {
      pump(voice({ attachmentUrls: [`/uploads/t1/2026-09/note.${ext}`] }));
      expect(tiles(), `.${ext} should play`).toHaveLength(1);
      cleanup();
    }
  });

  it('a real file still gets its download chip', () => {
    pump(voice({ attachmentUrls: ['/uploads/t1/2026-09/invoice.pdf'] }));
    expect(tiles()).toHaveLength(0);
    expect(chips()).toHaveLength(1);
  });

  it('a .webm is a video, and stays a chip', () => {
    // The API rewraps a browser-recorded audio .webm to .ogg on upload, so one
    // arriving with that extension really is a video.
    pump(voice({ attachmentUrls: ['/uploads/t1/2026-09/clip.webm'] }));
    expect(tiles()).toHaveLength(0);
    expect(chips()).toHaveLength(1);
  });

  it('a placeholder url is never mistaken for playable audio', () => {
    pump(voice({ attachmentUrls: ['wa:media:1234'] }));
    expect(tiles()).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(BrokenImageIcon)).toHaveLength(1);
  });

  it('lays out in RTL, its controls on the reading side', () => {
    pump(voice({ attachmentUrls: ['/uploads/t1/2026-09/15ff7ad3.m4a'] }), true);
    expect(tiles()).toHaveLength(1);
    expect(tiles()[0]!.props.dir.direction).toBe('rtl');
  });

  it('is the whole card, with no bubble around it', () => {
    // It already rounds its own corners; a bubble around it is a second card
    // holding a first one — on the visitor's own side the full accent colour.
    pump(voice({ attachmentUrls: ['/uploads/t1/2026-09/note.m4a'] }));
    expect(tiles()[0]!.props.background).toBe(THEME.primary);
  });

  it('a note WITH a caption stays inlaid in its bubble', () => {
    pump(voice({ body: 'have a listen', attachmentUrls: ['/uploads/t1/2026-09/note.m4a'] }));
    expect(tiles()[0]!.props.background).toBeUndefined();
  });
});
