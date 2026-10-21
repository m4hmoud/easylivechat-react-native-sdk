import {
  type WidgetConfig,
  type WorkspaceAvailabilityView,
  EasyLiveChat,
  substituteVisitorVariables,
  useWorkspaceAvailability,
} from '@easylivechat/react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useDirectionStyles } from '../direction';
import { ChatBubbleIcon } from '../icons';
import type { Strings } from '../l10n';
import { type EasyLiveChatTheme, inkOf, withAlpha } from '../theme';
import { RemoteImage } from './remote-image';

/**
 * What the closed/busy notice says — the banner above the thread and the full
 * closed screen alike. The web widget's `closedBannerText` (Embed.tsx), so a
 * visitor reads the same sentence in either client:
 *
 * 1. The business's own notice (`offlineInfoText`, Settings → Availability)
 *    ALWAYS wins — their words, whatever the mode or the assistant.
 * 2. With the composer locked (`NOTICE_ONLY`) nothing invites a message: the
 *    reopening time IS the notice, else "we'll be back soon".
 * 3. Busy is not shut: everyone's busy — or, while the AI assistant covers,
 *    that it can help in the meantime.
 * 4. Shut: "leave your message" — or, while the assistant covers, that it can
 *    help — then the reopening time, which stays: it is when a PERSON is back.
 *
 * Deliberately NOT `offlineMessage`. That is the leave-a-message prompt from
 * the widget's copy and carries a schema default nobody typed, so preferring
 * it showed every visitor English, invited a message where none is taken, and
 * buried the assistant's notice on the full screen. The server sends
 * `offlineInfoText` as nothing unless a notice was actually written, so
 * reaching step 2 means nobody wrote one — use ours, in the visitor's
 * language.
 *
 * Kept from the SDK's own: a named closure ("We're closed for Eid al-Adha")
 * tells the visitor more than a bare "we're offline", so a holiday says so
 * while nobody covers.
 */
export function closedNoticeText(
  config: WidgetConfig | null,
  strings: Strings,
  availability: Pick<
    WorkspaceAvailabilityView,
    'reason' | 'assistantCovers' | 'composerLocked' | 'closureLabel' | 'nextOpenLocal' | 'nextOpenAt'
  >,
): string {
  const tenantNotice = config?.offlineInfoText?.trim() ?? '';
  if (tenantNotice.length > 0) {
    return substituteVisitorVariables(tenantNotice, {
      name: EasyLiveChat.instance.visitorName,
      defaultName: config?.defaultCustomerName,
    });
  }

  const reopensAt = reopeningTime(availability);
  const backAt = reopensAt != null ? strings.t('backAt').replace('{time}', reopensAt) : null;

  if (availability.composerLocked) return backAt ?? strings.t('closedReadOnly');

  // (False before `boot()`, so an unbooted notice reads as plainly closed.)
  const covers = availability.assistantCovers;
  if (availability.reason === 'NO_AGENTS') {
    return strings.t(covers ? 'noAgentsAssistantNotice' : 'noAgentsNotice');
  }

  const label = availability.closureLabel;
  const closed = covers
    ? strings.t('closedAssistantNotice')
    : availability.reason === 'HOLIDAY' && label != null && label.length > 0
      ? strings.t('closedForLabel').replace('{label}', label)
      : strings.t('closedNotice');
  return backAt != null ? `${closed} ${backAt}` : closed;
}

/**
 * When we next open, on the BUSINESS's clock, formatted SERVER-SIDE.
 * Rendering the instant here would use the device's zone — "back at 09:00"
 * would read 07:00 to a visitor one country over, for a business that opens at
 * nine. An older server sends only the instant, which is shown in device time
 * rather than dropping the reopening time entirely.
 */
function reopeningTime(
  availability: Pick<WorkspaceAvailabilityView, 'nextOpenLocal' | 'nextOpenAt'>,
): string | null {
  const local = availability.nextOpenLocal;
  if (local != null && local.length > 0) return local;
  const next = availability.nextOpenAt;
  if (next == null) return null;
  const hh = String(next.getHours()).padStart(2, '0');
  const mm = String(next.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
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
        { width: size, height: size, backgroundColor: withAlpha(inkOf(theme), 0.08) },
      ]}
    >
      <ChatBubbleIcon color={withAlpha(inkOf(theme), 0.55)} size={32} />
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
 * Says what the banner would — {@link closedNoticeText} — under a title that
 * states the situation on its own.
 */
export function ClosedNoticeView({
  config,
  theme,
  strings,
}: ClosedNoticeViewProps): React.JSX.Element {
  const availability = useWorkspaceAvailability();
  const message = closedNoticeText(config, strings, availability);

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
 * the expectation about reply time rather than blocking anything. The words
 * are {@link closedNoticeText}: the business's own notice when it wrote one,
 * the assistant's while it covers, ours otherwise.
 */
export function ClosedNoticeBanner({
  config,
  theme,
  strings,
}: ClosedNoticeBannerProps): React.JSX.Element {
  const dir = useDirectionStyles();
  const availability = useWorkspaceAvailability();
  const message = closedNoticeText(config, strings, availability);

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
