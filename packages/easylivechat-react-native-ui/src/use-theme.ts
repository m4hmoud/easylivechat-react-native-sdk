import type { WidgetConfig } from '@easylivechat/react-native';
import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import type { Direction } from './direction';
import { type EasyLiveChatTheme, themeFromConfig } from './theme';

/**
 * The theme for `config`, in light or dark as the workspace chose — `auto`
 * follows the device's appearance and re-renders the moment the visitor
 * switches it (React Native's `useColorScheme`). The host's `override` still
 * wins, scheme included; see {@link themeFromConfig}.
 *
 * Every surface of the prebuilt UI resolves its theme through this, so the
 * chat, the launcher, the help screen and the end-chat button always agree.
 * A host drawing its own views around the SDK's can call it too.
 */
export function useEasyLiveChatTheme(
  config: WidgetConfig | null,
  override?: Partial<EasyLiveChatTheme>,
  directionOverride?: Direction,
): EasyLiveChatTheme {
  const deviceScheme = useColorScheme();
  return useMemo(() => {
    const base = themeFromConfig(config, override, deviceScheme);
    return directionOverride != null ? { ...base, direction: directionOverride } : base;
  }, [config, override, deviceScheme, directionOverride]);
}
