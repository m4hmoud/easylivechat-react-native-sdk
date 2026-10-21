import { EasyLiveChat, type WidgetConfig, parseWidgetConfig } from '@easylivechat/react-native';
import { act, cleanup, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Appearance, Text } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { EasyLiveChatLauncher } from '../src/launcher';
import { stringsFor } from '../src/l10n';
import {
  type EasyLiveChatTheme,
  ERROR_COLOR,
  ERROR_COLOR_DARK,
  contrastRatio,
  errorColorOf,
  inkOf,
  themeFromConfig,
} from '../src/theme';
import { useEasyLiveChatTheme } from '../src/use-theme';
import { ClosedNoticeView } from '../src/views/closed-notice-view';
import { FieldError, TextField } from '../src/views/form-controls';
import { MessageBubble } from '../src/views/message-bubble';
import { QueueNotice } from '../src/views/queue-notice-view';
import { bootOffline, isHost, message, setUnread, setWidgetConfig, styleOf } from './support';

/**
 * Dark mode (C2) — the workspace's `colorScheme` (`light` | `dark` | `auto`)
 * and the web widget's dark palette (`widgetPalette`, packages/shared
 * widget-theme.ts): the brand stays where a visitor sees it, the light
 * surfaces become a dark ground and card, the brand as ink is nudged until it
 * reads. `auto` follows the device, live. A host's explicit theme still wins.
 */
const appearance = Appearance as unknown as { __setColorScheme(s: 'light' | 'dark' | null): void };
function deviceScheme(s: 'light' | 'dark') {
  act(() => appearance.__setColorScheme(s));
}

const look = (colorScheme: string, extra: Record<string, unknown> = {}): WidgetConfig =>
  parseWidgetConfig({
    primaryColor: '#2563EB',
    backgroundColor: '#FFFFFF',
    textColor: '#111827',
    colorScheme,
    ...extra,
  });

beforeAll(bootOffline);
afterAll(() => EasyLiveChat.instance.shutdown());
afterEach(() => {
  cleanup();
  deviceScheme('light');
  setWidgetConfig(null);
  setUnread(0);
});

describe('the palette', () => {
  it('leaves a light workspace exactly as it was, whatever the device', () => {
    const before = themeFromConfig(look('light'));
    expect(before).toMatchObject({
      primary: '#2563eb',
      background: '#ffffff',
      text: '#111827',
      scheme: 'light',
      primaryInk: '#2563eb',
    });
    expect(themeFromConfig(look('light'), undefined, 'dark')).toEqual(before);
    // An older server sends no scheme at all: light.
    expect(themeFromConfig(parseWidgetConfig({}), undefined, 'dark').scheme).toBe('light');
  });

  it('derives dark from the same colours as the web widget: ground, card, text and ink', () => {
    // `widgetPalette(look, 'dark')` from packages/shared gives, for this look:
    // ground #131721, card #1e222d, text #ECEDEF, ink #5c8af0.
    const t = themeFromConfig(look('dark'));
    expect(t.scheme).toBe('dark');
    // The brand stays the brand.
    expect(t.primary).toBe('#2563eb');
    // The widget's own ground (#121316) and card (#1E1F23), 5% toward the brand.
    expect(t.background).toBe('#131721');
    expect(t.surface).toBe('#1e222d');
    expect(t.text).toBe('#ECEDEF');
    expect(t.primaryInk).toBe('#5c8af0');
  });

  it('reads at 4.5:1 or better, text and ink, for a spread of brands', () => {
    for (const primaryColor of ['#2563EB', '#000000', '#1E3A8A', '#7C3AED', '#DC2626', '#FACC15', '#FFFFFF', '#0F766E']) {
      const t = themeFromConfig(look('dark', { primaryColor }));
      expect(contrastRatio(t.text, t.surface), primaryColor).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.text, t.background), primaryColor).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(inkOf(t), t.surface), primaryColor).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps a brand ink that already reads, and nudges one that does not', () => {
    const light = themeFromConfig(look('dark', { primaryColor: '#60A5FA' }));
    expect(light.primaryInk).toBe('#60a5fa');
    const navy = themeFromConfig(look('dark', { primaryColor: '#1E3A8A' }));
    // The same step toward white the web widget takes (`accentInk`).
    expect(navy.primaryInk).toBe('#7889b9');
    expect(navy.primary).toBe('#1e3a8a');
  });

  it('keeps a workspace’s own dark theme', () => {
    const t = themeFromConfig(look('dark', { backgroundColor: '#0B0B0F', textColor: '#F5F5F5' }));
    expect(t.background).toBe('#0b0b0f');
    expect(t.text).toBe('#f5f5f5');
  });

  it('replaces a tenant text colour that would not read on dark', () => {
    expect(themeFromConfig(look('dark', { textColor: '#111827' })).text).toBe('#ECEDEF');
  });

  it('follows the device for auto', () => {
    expect(themeFromConfig(look('auto'), undefined, 'dark').scheme).toBe('dark');
    expect(themeFromConfig(look('auto'), undefined, 'light').scheme).toBe('light');
    expect(themeFromConfig(look('auto'), undefined, null).scheme).toBe('light');
  });

  it('lets a host pin the scheme', () => {
    expect(themeFromConfig(look('dark'), { scheme: 'light' }).background).toBe('#ffffff');
    expect(themeFromConfig(look('light'), { scheme: 'dark' }).scheme).toBe('dark');
  });

  it('takes a host’s own surfaces at their word, and fills the gaps from the same scheme', () => {
    // A host painting a white page keeps a light chat on a dark device.
    const t = themeFromConfig(look('auto'), { background: '#FFFFFF' }, 'dark');
    expect(t.scheme).toBe('light');
    expect(t.text).toBe('#111827');
    // …and a host painting it dark gets dark text tokens to match.
    const d = themeFromConfig(look('light'), { background: '#000000' });
    expect(d.scheme).toBe('dark');
    expect(d.text).toBe('#ECEDEF');
  });

  it('lets a brand-only override keep dark mode', () => {
    const t = themeFromConfig(look('dark'), { primary: '#16A34A' });
    expect(t.scheme).toBe('dark');
    expect(t.primary).toBe('#16A34A');
    expect(contrastRatio(inkOf(t), t.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('never takes the direction from the override', () => {
    expect(themeFromConfig(look('dark', { direction: 'rtl' }), { direction: 'ltr' }).direction).toBe('rtl');
  });

  it('turns the destructive red to one that reads on dark', () => {
    expect(errorColorOf(themeFromConfig(look('dark')))).toBe(ERROR_COLOR_DARK);
    expect(errorColorOf(themeFromConfig(look('light')))).toBe(ERROR_COLOR);
    expect(errorColorOf(undefined)).toBe(ERROR_COLOR);
  });
});

describe('following the device', () => {
  function Probe({ config, override }: { config: WidgetConfig | null; override?: Partial<EasyLiveChatTheme> }) {
    const theme = useEasyLiveChatTheme(config, override);
    return <Text testID="probe">{`${theme.scheme} ${theme.background}`}</Text>;
  }

  it('re-renders the moment the visitor switches their appearance', () => {
    render(<Probe config={look('auto')} />);
    expect(screen.getByTestId('probe').props.children).toBe('light #ffffff');
    deviceScheme('dark');
    expect(screen.getByTestId('probe').props.children).toBe('dark #131721');
    deviceScheme('light');
    expect(screen.getByTestId('probe').props.children).toBe('light #ffffff');
  });

  it('stays put for a workspace that chose', () => {
    render(<Probe config={look('light')} />);
    deviceScheme('dark');
    expect(screen.getByTestId('probe').props.children).toBe('light #ffffff');
  });

  it('is light before the config arrives', () => {
    deviceScheme('dark');
    render(<Probe config={null} />);
    expect(screen.getByTestId('probe').props.children).toBe('light #FFFFFF');
  });
});

/** The nearest host view above `node` that paints a background. */
function paintedBy(node: ReactTestInstance): ReactTestInstance {
  let at: ReactTestInstance | null = node.parent;
  while (at != null && !(isHost(at, 'View') && styleOf(at).backgroundColor != null)) at = at.parent;
  if (at == null) throw new Error('nothing paints behind this node');
  return at;
}

describe('the views in dark', () => {
  const dark = () => themeFromConfig(look('dark'));

  it('paint the team’s bubble on the dark card, the visitor’s in the brand', () => {
    const theme = dark();
    for (const senderType of ['agent', 'customer'] as const) {
      render(
        <MessageBubble
          message={message({ id: senderType, senderType, body: `From ${senderType}` })}
          theme={theme}
          showAgentName
          showAgentAvatar={false}
          strings={stringsFor('en')}
          agentLastReadAt={null}
          onOpenImage={() => undefined}
        />,
      );
      const words = screen.getByText(`From ${senderType}`);
      expect(styleOf(paintedBy(words)).backgroundColor).toBe(
        senderType === 'agent' ? theme.surface : theme.primary,
      );
      expect(styleOf(words).color).toBe(senderType === 'agent' ? theme.text : '#FFFFFF');
      cleanup();
    }
  });

  it('draw a link in the team’s bubble in the ink, not the raw brand', () => {
    const theme = themeFromConfig(look('dark', { primaryColor: '#1E3A8A' }));
    render(
      <MessageBubble
        message={message({ id: 'a1', body: 'See https://example.com' })}
        theme={theme}
        showAgentName
        showAgentAvatar={false}
        strings={stringsFor('en')}
        agentLastReadAt={null}
        onOpenImage={() => undefined}
      />,
    );
    const link = screen.getByRole('link');
    expect(styleOf(link).color).toBe(theme.primaryInk);
    expect(styleOf(link).color).not.toBe(theme.primary);
  });

  it('paint the closed screen and the queue notice on the dark ground and card', () => {
    const theme = dark();
    render(<ClosedNoticeView config={look('dark')} theme={theme} strings={stringsFor('en')} />);
    const title = screen.getByText("We're not available right now");
    expect(styleOf(title).color).toBe(theme.text);
    expect(styleOf(paintedBy(title)).backgroundColor).toBe(theme.background);
    cleanup();

    render(<QueueNotice theme={theme} strings={stringsFor('en')} queue={{ position: 2, minutes: 5, text: 'Hang on' }} />);
    expect(styleOf(paintedBy(screen.getByText('Queue'))).backgroundColor).toBe(theme.surface);
  });

  it('give fields the dark keyboard and a red that reads', () => {
    const theme = dark();
    render(
      <>
        <TextField value="" onChangeText={() => undefined} hasError={false} theme={theme} />
        <FieldError message="Required" theme={theme} />
      </>,
    );
    expect(screen.UNSAFE_getByType('TextInput' as never).props.keyboardAppearance).toBe('dark');
    expect(styleOf(screen.getByText('Required')).color).toBe(ERROR_COLOR_DARK);
    cleanup();

    render(<TextField value="" onChangeText={() => undefined} hasError={false} theme={themeFromConfig(look('light'))} />);
    expect(screen.UNSAFE_getByType('TextInput' as never).props.keyboardAppearance).toBe('default');
  });

  it('keep the launcher in the brand, with its badge ringed in the dark ground', () => {
    setWidgetConfig(look('auto'));
    setUnread(3);
    deviceScheme('dark');
    render(<EasyLiveChatLauncher />);
    const button = screen.getByRole('button');
    expect(styleOf(button).backgroundColor).toBe('#2563eb');
    const badge = screen.getByLabelText('3');
    expect(styleOf(badge).borderColor).toBe(themeFromConfig(look('auto'), undefined, 'dark').background);
  });
});
