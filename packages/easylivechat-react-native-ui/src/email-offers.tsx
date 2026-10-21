import {
  EasyLiveChat,
  EasyLiveChatError,
  createStore,
  isFromCustomer,
  useEasyLiveChatMessages,
  useEasyLiveChatPhase,
  useEasyLiveChatStore,
  useQueueStatus,
  useReplyEmailEnabled,
  useTranscriptEmailEnabled,
  useWidgetConfig,
  useWorkspaceAvailability,
} from '@easylivechat/react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useDirectionStyles } from './direction';
import { ChevronIcon, MailIcon } from './icons';
import { type Strings, stringsFor } from './l10n';
import { MAX_FONT_SCALE } from './text-scaling';
import { type EasyLiveChatTheme, inkOf, withAlpha } from './theme';
import { useEasyLiveChatTheme } from './use-theme';
import { EmailCard, type EmailCardResult } from './views/email-card';

/**
 * The web widget's two emails to the visitor (apps/widget Embed.tsx §7b),
 * drawn the way it draws them and offered by its rules:
 *
 * - **"Email me this chat"** — from the ⋯ menu on the web; here the app bar's
 *   envelope, or {@link EasyLiveChatEmailTranscriptButton} in a host's own
 *   header — once there is a conversation with something in it, and on the
 *   screen after the chat for the one that just ended.
 * - **"Get the reply by email"** — asked once per conversation, unprompted,
 *   once the visitor has written while nobody can answer (closed, waiting in
 *   the queue, nobody accepting) and only of someone with no address on file;
 *   never while the workspace takes no messages.
 *
 * Both only while the workspace's switch is on, and both inline cards at the
 * top of the chat — never a modal.
 */

/** "Email me this chat" was asked for and its card is up. */
const transcriptCard = createStore(false);

/**
 * Conversations already asked "Get the reply by email" in this run of the
 * app, answered or not — the web keeps the same per browser.
 */
const notifyAsked = new Set<string>();

/** Open the "Email me this chat" card in the chat screen. */
export function openEmailTranscript(): void {
  transcriptCard.set(true);
}

function closeEmailTranscript(): void {
  transcriptCard.set(false);
}

/** Forget what this run of the app asked — for tests. */
export function __resetEmailOffers(): void {
  transcriptCard.set(false);
  notifyAsked.clear();
}

export interface EmailTranscriptOffer {
  /**
   * "Email me this chat" is on offer now: the workspace's switch is on and
   * there is a conversation on screen with something in it.
   */
  available: boolean;
  /** Open its card in the chat screen. */
  open: () => void;
}

/**
 * For a host whose header takes a callback rather than a node — the
 * equivalent of {@link EasyLiveChatEmailTranscriptButton}. The card opens in
 * `EasyLiveChatScreen`, so the screen must be the one on display.
 */
export function useEmailTranscriptOffer(): EmailTranscriptOffer {
  const enabled = useTranscriptEmailEnabled();
  const phase = useEasyLiveChatPhase();
  const messages = useEasyLiveChatMessages();
  const available =
    enabled &&
    phase === 'chat' &&
    EasyLiveChat.instance.conversationId != null &&
    messages.some((m) => m.senderType !== 'system');
  return { available, open: openEmailTranscript };
}

export interface EasyLiveChatEmailTranscriptButtonProps {
  /** Chrome locale override — same contract as the screen's `locale` prop. */
  locale?: string;
  /** Icon colour; defaults to the theme's text colour. */
  color?: string;
  /** Pass the chat screen's `themeOverride` result to keep them identical. */
  theme?: EasyLiveChatTheme;
}

/**
 * "Email me this chat" as an envelope for a host's own header, beside
 * `EasyLiveChatEndChatButton`. Renders only while it is on offer
 * ({@link useEmailTranscriptOffer}); a tap opens the card in the chat screen.
 * The screen's own app bar (`showAppBar`) already carries one.
 */
export function EasyLiveChatEmailTranscriptButton({
  locale,
  color,
  theme,
}: EasyLiveChatEmailTranscriptButtonProps): React.JSX.Element | null {
  const offer = useEmailTranscriptOffer();
  const config = useWidgetConfig();
  // Before the early return: a hook may not be skipped on some renders.
  const ownTheme = useEasyLiveChatTheme(config);
  if (!offer.available) return null;
  const strings = stringsFor(locale ?? config?.locale);
  return (
    <Pressable
      onPress={offer.open}
      accessibilityRole="button"
      accessibilityLabel={strings.t('emailTranscript')}
      hitSlop={8}
      style={styles.iconButton}
    >
      <MailIcon color={color ?? (theme ?? ownTheme).text} size={20} />
    </Pressable>
  );
}

// ── what the cards send ───────────────────────────────────────────────────

function codeOf(e: unknown): string {
  return e instanceof EasyLiveChatError ? e.code : '';
}

/** "Email me this chat", with the widget's wording for each refusal. */
async function sendTranscript(
  email: string | null,
  strings: Strings,
  onHint: (hint: string | null) => void,
): Promise<EmailCardResult> {
  try {
    const { sentTo } = await EasyLiveChat.instance.emailTranscript(email != null ? { email } : {});
    if (sentTo.length === 0) return { ok: false, message: strings.t('emailFailed') };
    onHint(sentTo);
    return { ok: true, hint: sentTo };
  } catch (e) {
    const code = codeOf(e);
    if (
      code === 'TRANSCRIPT_RATE_LIMITED' ||
      code === 'RATE_LIMITED' ||
      (e instanceof EasyLiveChatError && e.httpStatus === 429)
    ) {
      return { ok: false, message: strings.t('emailRateLimited') };
    }
    if (code === 'EMAIL_UNSUBSCRIBED') return { ok: false, message: strings.t('emailUnsubscribed') };
    if (code === 'INVALID_EMAIL' || code === 'NO_CONTACT_EMAIL') {
      // There is no address on file after all: the card asks for one.
      if (code === 'NO_CONTACT_EMAIL') onHint(null);
      return { ok: false, message: strings.t('invalidEmail') };
    }
    return { ok: false, message: strings.t('emailFailed') };
  }
}

/** "Get the reply by email": the address goes on the visitor's contact. */
async function saveReplyEmail(email: string | null, strings: Strings): Promise<EmailCardResult> {
  if (email == null) return { ok: false, message: strings.t('invalidEmail') };
  try {
    const { emailHint } = await EasyLiveChat.instance.setVisitorEmail(email);
    if (emailHint.length === 0) return { ok: false, message: strings.t('emailFailed') };
    return { ok: true, hint: emailHint };
  } catch (e) {
    const code = codeOf(e);
    if (code === 'EMAIL_UNSUBSCRIBED') return { ok: false, message: strings.t('emailUnsubscribed') };
    if (code === 'INVALID_EMAIL') return { ok: false, message: strings.t('invalidEmail') };
    return { ok: false, message: strings.t('emailFailed') };
  }
}

/** The address on the visitor's contact (masked), or null — none, or not known. */
async function loadEmailHint(): Promise<string | null> {
  try {
    return (await EasyLiveChat.instance.visitorEmail()).emailHint;
  } catch {
    return null;
  }
}

/**
 * The address on file for `conversationId`'s visitor — `undefined` until it
 * has been asked, which is only once there is a conversation and an email
 * could be offered, not for every visitor who opens the chat.
 */
function useEmailHint(
  conversationId: string | null,
  enabled: boolean,
): [string | null | undefined, (hint: string | null) => void, () => void] {
  const [hint, setHint] = useState<string | null | undefined>(undefined);
  const generation = useRef(0);

  const reload = useCallback(() => {
    const at = ++generation.current;
    void loadEmailHint().then((h) => {
      if (generation.current === at) setHint(h);
    });
  }, []);

  useEffect(() => {
    setHint(undefined);
    if (conversationId == null || !enabled) {
      generation.current++;
      return;
    }
    reload();
  }, [conversationId, enabled, reload]);

  const set = useCallback((h: string | null) => {
    generation.current++;
    setHint(h);
  }, []);

  return [hint, set, reload];
}

// ── in the chat ───────────────────────────────────────────────────────────

/**
 * The email cards above the thread, in the chat phase: "Email me this chat"
 * when asked for, and "Get the reply by email" when its moment comes. Drawn by
 * `EasyLiveChatScreen`.
 */
export function ChatEmailOffers({
  theme,
  strings,
}: {
  theme: EasyLiveChatTheme;
  strings: Strings;
}): React.JSX.Element | null {
  const transcriptEnabled = useTranscriptEmailEnabled();
  const replyEnabled = useReplyEmailEnabled();
  const transcriptOpen = useEasyLiveChatStore(transcriptCard);
  const messages = useEasyLiveChatMessages();
  const queue = useQueueStatus();
  const { workspaceClosed, composerLocked, agentsAccepting } = useWorkspaceAvailability();
  const conversationId = EasyLiveChat.instance.conversationId;
  const [hint, setHint, reloadHint] = useEmailHint(conversationId, transcriptEnabled || replyEnabled);
  const [notifyOpen, setNotifyOpen] = useState(false);

  const customerWrote = messages.some(isFromCustomer);
  // Nobody is there to answer now, so the answer may come after they have
  // gone — and then it can only reach them by email.
  const nobodyToAnswer = workspaceClosed || queue != null || !agentsAccepting;

  // Once they have written, while nobody can answer, and only to someone we
  // have no address for. Asked once per chat.
  useEffect(() => {
    if (conversationId == null || notifyOpen) return;
    if (!replyEnabled || composerLocked) return;
    if (hint !== null || !customerWrote || !nobodyToAnswer) return;
    if (notifyAsked.has(conversationId)) return;
    notifyAsked.add(conversationId);
    setNotifyOpen(true);
  }, [conversationId, notifyOpen, replyEnabled, composerLocked, hint, customerWrote, nobodyToAnswer]);

  // A card asked for here belongs to this screen's chat: leaving lets it go.
  useEffect(() => () => closeEmailTranscript(), []);

  const closeNotify = useCallback(() => {
    setNotifyOpen(false);
    // Whatever was saved is on file now; read it back, masked.
    reloadHint();
  }, [reloadHint]);

  const submitTranscript = useCallback(
    (email: string | null) => sendTranscript(email, strings, setHint),
    [strings, setHint],
  );
  const submitNotify = useCallback((email: string | null) => saveReplyEmail(email, strings), [strings]);

  if (transcriptOpen && transcriptEnabled && hint !== undefined) {
    return (
      <EmailCard
        key="transcript"
        mode="transcript"
        emailHint={hint}
        theme={theme}
        strings={strings}
        onSubmit={submitTranscript}
        onClose={closeEmailTranscript}
      />
    );
  }
  if (notifyOpen && replyEnabled) {
    return (
      <EmailCard
        key="notify"
        mode="notify"
        emailHint={null}
        theme={theme}
        strings={strings}
        onSubmit={submitNotify}
        onClose={closeNotify}
      />
    );
  }
  return null;
}

// ── after the chat ────────────────────────────────────────────────────────

/**
 * On the screen after the chat — the survey, the rating, the thanks: a copy
 * of the conversation that just ended, to keep. A row above it that opens the
 * card in place; at the top rather than under the survey, so the keyboard
 * never covers the field.
 */
export function AfterChatEmailOffer({
  theme,
  strings,
}: {
  theme: EasyLiveChatTheme;
  strings: Strings;
}): React.JSX.Element | null {
  const enabled = useTranscriptEmailEnabled();
  const dir = useDirectionStyles();
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null | undefined>(undefined);
  const close = useCallback(() => setOpen(false), []);
  const submit = useCallback(
    (email: string | null) => sendTranscript(email, strings, setHint),
    [strings],
  );

  if (!enabled) return null;
  if (open && hint !== undefined) {
    return (
      <EmailCard
        key="transcript-after"
        mode="transcript"
        emailHint={hint}
        theme={theme}
        strings={strings}
        onSubmit={submit}
        onClose={close}
      />
    );
  }
  return (
    <Pressable
      onPress={() => {
        if (hint !== undefined) {
          setOpen(true);
          return;
        }
        void loadEmailHint().then((h) => {
          setHint(h);
          setOpen(true);
        });
      }}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.offerRow,
        {
          flexDirection: dir.row,
          backgroundColor: withAlpha(theme.primary, pressed ? 0.14 : 0.07),
        },
      ]}
    >
      <MailIcon color={inkOf(theme)} size={18} />
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        numberOfLines={2}
        style={[styles.offerText, dir.textStart, { color: theme.text }]}
      >
        {strings.t('emailTranscript')}
      </Text>
      <View style={dir.mirror}>
        <ChevronIcon color={withAlpha(theme.text, 0.4)} size={12} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  offerRow: {
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 2,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
  },
  offerText: { flex: 1, fontSize: 14, fontWeight: '600', marginHorizontal: 10 },
});
