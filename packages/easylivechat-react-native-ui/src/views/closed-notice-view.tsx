import {
  type WidgetConfig,
  EasyLiveChat,
  substituteVisitorVariables,
  useWorkspaceAvailability,
} from '@easylivechat/react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useDirectionStyles } from '../direction';
import { ChatBubbleIcon } from '../icons';
import type { Strings } from '../l10n';
import { type EasyLiveChatTheme, withAlpha } from '../theme';
import { RemoteImage } from './remote-image';

/**
 * The default closed notice.
 *
 * Being SHUT and being UNDERSTAFFED are different states and read differently
 * to a visitor: "back at 09:00" is actionable, "everyone's busy" is not. The
 * server tells us which via `reason`.
 */
function defaultNotice(
  strings: Strings,
  availability: ReturnType<typeof useWorkspaceAvailability>,
): string {
  if (availability.reason === 'NO_AGENTS') return strings.t('noAgentsNotice');

  // A named closure ("Closed for Eid al-Adha") tells the visitor far more than
  // a generic "we're offline", so prefer it when the server sent one.
  const label = availability.closureLabel;
  const head =
    availability.reason === 'HOLIDAY' && label != null && label.length > 0
      ? strings.t('closedForLabel').replace('{label}', label)
      : strings.t('closedNotice');

  // The BUSINESS's clock, formatted SERVER-SIDE. Rendering the instant here
  // would use the device's zone — "back at 09:00" would read 07:00 to a
  // visitor one country over, for a business that opens at nine.
  const local = availability.nextOpenLocal;
  if (local != null && local.length > 0) {
    return `${head} ${strings.t('backAt').replace('{time}', local)}`;
  }

  // Older server: fall back to the instant in device-local time rather than
  // dropping the reopening time entirely.
  const next = availability.nextOpenAt;
  if (next == null) return head;
  const hh = String(next.getHours()).padStart(2, '0');
  const mm = String(next.getMinutes()).padStart(2, '0');
  return `${head} ${strings.t('backAt').replace('{time}', `${hh}:${mm}`)}`;
}

/**
 * The business's own logo, or a neutral placeholder when it has none or the
 * image fails to load — an empty gap where a logo should be looks broken.
 */
function BusinessMark({
  logoUrl,
  theme,
}: {
  logoUrl?: string;
  theme: EasyLiveChatTheme;
}): React.JSX.Element {
  const size = 76;
  const fallback = (
    <View
      style={[
        styles.mark,
        { width: size, height: size, backgroundColor: withAlpha(theme.primary, 0.08) },
      ]}
    >
      <ChatBubbleIcon color={withAlpha(theme.primary, 0.55)} size={32} />
    </View>
  );
  const url = logoUrl?.trim();
  if (url == null || url.length === 0) return fallback;
  return (
    <View style={[styles.mark, { width: size, height: size, overflow: 'hidden' }]}>
      <RemoteImage
        uri={EasyLiveChat.instance.resolveUrl(url)}
        style={{ width: size, height: size }}
        theme={theme}
        fallback={fallback}
        placeholder={fallback}
      />
    </View>
  );
}

export interface ClosedNoticeViewProps {
  config: WidgetConfig;
  theme: EasyLiveChatTheme;
  strings: Strings;
}

/**
 * Shown when the workspace is closed AND no conversation can be started.
 *
 * This REPLACED a ticket/offline form. That form was a dead end: whatever the
 * visitor typed was filed as a separate record instead of becoming a
 * conversation, so it never appeared in the thread and the visitor had no way
 * to follow it up.
 *
 * In the normal (messaging-mode) path the visitor is not sent here at all —
 * they get the ordinary chat with {@link ClosedNoticeBanner} above it and can
 * write straight away. This view is the narrow fallback for tenants configured
 * to refuse new chats.
 *
 * Prefers the tenant's own wording (`offlineMessage`), falling back to the
 * localized default.
 */
export function ClosedNoticeView({
  config,
  theme,
  strings,
}: ClosedNoticeViewProps): React.JSX.Element {
  const availability = useWorkspaceAvailability();
  const tenantCopy = config.offlineMessage.trim();
  const message =
    tenantCopy.length > 0
      ? substituteVisitorVariables(tenantCopy, {
          name: EasyLiveChat.instance.visitorName,
          defaultName: config.defaultCustomerName,
        })
      : defaultNotice(strings, availability);

  return (
    <View style={[styles.centered, { backgroundColor: theme.background }]}>
      <BusinessMark logoUrl={config.logoUrl} theme={theme} />
      {/* Stated first and in full contrast: whatever the tenant's body copy
          says, the visitor learns the state from this line alone. */}
      <Text style={[styles.title, { color: theme.text }]}>{strings.t('unavailableTitle')}</Text>
      <Text style={[styles.body, { color: withAlpha(theme.text, 0.7) }]}>{message}</Text>
    </View>
  );
}

export interface ClosedNoticeBannerProps {
  config: WidgetConfig | null;
  theme: EasyLiveChatTheme;
  strings: Strings;
}

/**
 * The slim banner pinned above the thread while the workspace is closed.
 *
 * The visitor keeps a WORKING composer — their message becomes a PENDING
 * conversation that is auto-assigned when the team comes back — so this sets
 * the expectation about reply time rather than blocking anything.
 */
export function ClosedNoticeBanner({
  config,
  theme,
  strings,
}: ClosedNoticeBannerProps): React.JSX.Element {
  const dir = useDirectionStyles();
  const availability = useWorkspaceAvailability();
  const tenantCopy = config?.offlineMessage.trim() ?? '';
  const message =
    tenantCopy.length > 0
      ? substituteVisitorVariables(tenantCopy, {
          name: EasyLiveChat.instance.visitorName,
          defaultName: config?.defaultCustomerName,
        })
      : defaultNotice(strings, availability);

  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: theme.surface, borderBottomColor: withAlpha(theme.text, 0.12) },
      ]}
    >
      <Text style={[styles.bannerText, dir.textStart, { color: withAlpha(theme.text, 0.7) }]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
  },
  mark: { borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  title: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 20,
  },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10 },
  banner: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  bannerText: { fontSize: 13, lineHeight: 19 },
});
