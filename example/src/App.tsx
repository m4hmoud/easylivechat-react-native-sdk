import * as Crypto from 'expo-crypto';
import {
  EasyLiveChat,
  EasyLiveChatLauncher,
  EasyLiveChatScreen,
  SecureAsyncStorage,
  setUuidGenerator,
  useConnectionState,
  useEasyLiveChatPhase,
  useIsBooted,
  useUnreadCount,
  useWorkspaceAvailability,
} from '@easylivechat/react-native-ui';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

/**
 * The EasyLiveChat React Native SDK, exercised end to end.
 *
 * Every flow in the SDK README is reachable from this one screen:
 * anonymous chat, identified chat, the pre-chat form, attachments, voice
 * notes, CSAT, the post-chat survey, a closed workspace, an RTL locale, and
 * logout via `reset()`.
 *
 * Point it at your own workspace below (or set the two constants from your
 * environment) and run `expo run:ios` / `expo run:android`.
 */
const API_BASE = process.env.EXPO_PUBLIC_ELC_API_BASE ?? 'https://api.livechattools.com';
const TENANT_SLUG = process.env.EXPO_PUBLIC_ELC_TENANT_SLUG ?? 'acme';
/** The inbox this host routes to. Also selects the per-channel config overrides. */
const CHANNEL = process.env.EXPO_PUBLIC_ELC_CHANNEL ?? '';

/**
 * ONE durable storage instance for the life of the app.
 *
 * It is also passed to `reset()`, which must work when the SDK was never
 * booted this session — the common case for a logout that never opened the
 * chat.
 */
const storage = new SecureAsyncStorage();

/**
 * The visitor id's random source, supplied ONCE before boot.
 *
 * The SDK cannot probe for `expo-crypto` itself: Metro resolves `require`
 * statically, so a computed specifier never resolves at runtime and a literal
 * one would make an optional peer a hard build dependency. Injecting is the
 * host's job — one line — and without it the id degrades to `Math.random()`,
 * which is not acceptable for what is effectively a bearer token on the
 * presence namespace.
 *
 * A host that already imports `react-native-get-random-values` at its entry
 * point needs none of this: the SDK finds the Web Crypto polyfill on its own.
 */
setUuidGenerator(Crypto.randomUUID);

/** The chrome + tenant-copy languages the example can switch between. */
const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
  { code: 'ckb', label: 'کوردی' },
  { code: 'kmr', label: 'Kurmancî' },
  { code: 'tr', label: 'Türkçe' },
] as const;

export default function App(): React.JSX.Element {
  const [locale, setLocale] = useState<string>('en');
  const [channel, setChannel] = useState<string>(CHANNEL);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [screenOpen, setScreenOpen] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const booted = useIsBooted();

  const append = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toISOString().slice(11, 19)}  ${line}`, ...prev].slice(0, 40));
  }, []);

  /**
   * Boot (and RE-boot) whenever the app language or channel changes.
   *
   * Re-booting is the supported way to re-localize: `boot()` on an already
   * booted instance adopts the new config rather than returning early, so the
   * tenant's own copy comes back in the new language on the next open.
   */
  useEffect(() => {
    void EasyLiveChat.instance
      .boot(
        {
          apiBase: API_BASE,
          tenantSlug: TENANT_SLUG,
          // Free-form, and what AGENTS see in the dashboard.
          locale: LOCALES.find((l) => l.code === locale)?.label ?? locale,
          // The language CODE that picks the tenant's own copy.
          contentLocale: locale,
          channel: channel.trim().length > 0 ? channel.trim() : undefined,
          attributes: {
            os: `${Platform.OS} ${String(Platform.Version)}`,
            appVersion: '0.1.0',
            surface: 'example-app',
          },
        },
        { storage },
      )
      .then(() => append(`booted (contentLocale=${locale}${channel ? `, channel=${channel}` : ''})`))
      .catch((e: unknown) => append(`boot failed: ${String(e)}`));
  }, [locale, channel, append]);

  useEffect(() => {
    if (!booted) return;
    const offMessage = EasyLiveChat.instance.onMessage((m) =>
      append(`message:new ${m.senderType} ${m.id}`),
    );
    const offProactive = EasyLiveChat.instance.onProactiveMessage((p) =>
      append(`proactive: ${p.message}`),
    );
    const offError = EasyLiveChat.instance.onError((e) => append(`error ${e.code}: ${e.message}`));
    return () => {
      offMessage();
      offProactive();
      offError();
    };
  }, [booted, append]);

  const identify = useCallback(() => {
    // AUTHORITATIVE: whatever is left blank is CLEARED, not merged.
    EasyLiveChat.instance.identify({
      name: name.trim().length > 0 ? name.trim() : undefined,
      email: email.trim().length > 0 ? email.trim() : undefined,
      phone: phone.trim().length > 0 ? phone.trim() : undefined,
      fields: { plan: 'pro', source: 'example-app' },
    });
    append(`identified as ${name || '(anonymous)'}`);
  }, [name, email, phone, append]);

  const logout = useCallback(async () => {
    // The LOGOUT path. Not `shutdown()`: that keeps the durable visitorId, so
    // the next person on this device would inherit the last one's identity.
    await EasyLiveChat.instance.reset({ storage });
    setName('');
    setEmail('');
    setPhone('');
    append('reset() — fresh visitor on next boot');
    // Re-boot so the app has a live SDK again.
    await EasyLiveChat.instance.boot(
      { apiBase: API_BASE, tenantSlug: TENANT_SLUG, contentLocale: locale },
      { storage },
    );
  }, [locale, append]);

  /**
   * Deep links, so the example can be driven without touching the screen.
   *
   * This is a real host pattern too — "open support" from a push notification
   * or an email lands here — but the reason it exists is that it makes every
   * flow scriptable on a simulator:
   *
   *   easylivechatexample://open
   *   easylivechatexample://end
   *   easylivechatexample://close
   *   easylivechatexample://reset
   *   easylivechatexample://locale?code=ckb
   *   easylivechatexample://identify?name=Ada&email=ada@example.com
   */
  const handleUrl = useCallback(
    (url: string) => {
      // Parsed by hand against RN's own `Linking`: `expo-linking` is a native
      // module, and a scheme this simple does not justify one.
      const [head, query = ''] = url.split('://')[1]?.split('?') ?? [];
      const action = (head ?? '').replace(/\/+$/, '');
      const params = new URLSearchParams(query);
      const q = (key: string): string | undefined => {
        const v = params.get(key);
        return v != null && v.length > 0 ? v : undefined;
      };
      append(`deep link: ${action}`);
      switch (action) {
        case 'open':
          setScreenOpen(true);
          return;
        case 'close':
          setScreenOpen(false);
          return;
        case 'end':
          void EasyLiveChat.instance
            .endChat()
            .then((willShowPostChat) => append(`endChat → post-chat: ${String(willShowPostChat)}`))
            .catch((e: unknown) => append(`endChat failed: ${String(e)}`));
          return;
        case 'reset':
          void logout();
          return;
        case 'locale': {
          const code = q('code');
          if (code != null) setLocale(code);
          return;
        }
        case 'identify': {
          const n = q('name') ?? '';
          const e = q('email') ?? '';
          const p = q('phone') ?? '';
          setName(n);
          setEmail(e);
          setPhone(p);
          EasyLiveChat.instance.identify({
            name: n.length > 0 ? n : undefined,
            email: e.length > 0 ? e : undefined,
            phone: p.length > 0 ? p : undefined,
            fields: { plan: 'pro', source: 'example-app' },
          });
          append(`identified as ${n || '(anonymous)'}`);
          return;
        }
        default:
          append(`unknown deep link: ${action}`);
      }
    },
    [append, logout],
  );

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    void Linking.getInitialURL().then((url) => {
      if (url != null) handleUrl(url);
    });
    return () => sub.remove();
  }, [handleUrl]);


  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>EasyLiveChat SDK</Text>
        <Text style={styles.subtitle}>
          {API_BASE} · {TENANT_SLUG}
        </Text>

        <Status />

        <Section title="Chrome + tenant-copy language">
          <View style={styles.chips}>
            {LOCALES.map((l) => (
              <Chip
                key={l.code}
                label={l.label}
                active={locale === l.code}
                onPress={() => setLocale(l.code)}
              />
            ))}
          </View>
          <Text style={styles.hint}>
            ar / ckb / kmr are RTL. The chat mirrors; this host app stays LTR.
          </Text>
        </Section>

        <Section title="Inbox channel (optional)">
          <TextInput
            value={channel}
            onChangeText={setChannel}
            placeholder="rider, driver, …"
            autoCapitalize="none"
            style={styles.input}
          />
          <Text style={styles.hint}>
            Routes the conversation AND selects the per-channel config overrides.
          </Text>
        </Section>

        <Section title="Identify (skips the pre-chat form)">
          <TextInput value={name} onChangeText={setName} placeholder="Name" style={styles.input} />
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
          />
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="Phone"
            keyboardType="phone-pad"
            style={styles.input}
          />
          <Button label="identify()" onPress={identify} />
          <Text style={styles.hint}>
            Leave everything blank and open the chat to see the anonymous / pre-chat path.
          </Text>
        </Section>

        <Section title="Open the chat">
          <Button label="Push the full screen" onPress={() => setScreenOpen(true)} />
          <Text style={styles.hint}>
            Or tap the floating bubble, bottom-{'right'} — it carries the unread badge.
          </Text>
        </Section>

        <Section title="Session">
          <Button label="refreshAvailability()" onPress={() => void EasyLiveChat.instance.refreshAvailability()} />
          <Button
            label="endChat()"
            onPress={() => {
              void EasyLiveChat.instance
                .endChat()
                .then((willShowPostChat) =>
                  append(`endChat → post-chat step follows: ${String(willShowPostChat)}`),
                );
            }}
          />
          <Button label="reset()  (logout)" onPress={() => void logout()} destructive />
        </Section>

        <Section title="Events">
          {log.length === 0 ? (
            <Text style={styles.hint}>Nothing yet.</Text>
          ) : (
            log.map((line, i) => (
              <Text key={i} style={styles.logLine} numberOfLines={2}>
                {line}
              </Text>
            ))
          )}
        </Section>
      </ScrollView>

      {/* The launcher sits over the app, exactly as a host would place it. */}
      <EasyLiveChatLauncher locale={locale} />

      <Modal
        visible={screenOpen}
        animationType="slide"
        onRequestClose={() => setScreenOpen(false)}
      >
        <EasyLiveChatScreen
          locale={locale}
          showAppBar
          onRequestClose={() => setScreenOpen(false)}
          // A per-locale chrome override, showing how a host adds or replaces
          // wording without waiting on an SDK release.
          stringsByLocale={{ en: { startChat: 'Start chat →' } }}
        />
      </Modal>
    </SafeAreaView>
  );
}

/** Live SDK state, straight from the hooks. */
function Status(): React.JSX.Element {
  const booted = useIsBooted();
  const phase = useEasyLiveChatPhase();
  const connection = useConnectionState();
  const unread = useUnreadCount();
  const availability = useWorkspaceAvailability();

  return (
    <View style={styles.status}>
      <Row label="booted" value={String(booted)} />
      <Row label="phase" value={phase} />
      <Row label="connection" value={connection} />
      <Row label="unread" value={String(unread)} />
      <Row label="visitorMode" value={availability.visitorMode} />
      <Row label="reason" value={availability.reason} />
      <Row label="workspaceClosed" value={String(availability.workspaceClosed)} />
      <Row label="composerLocked" value={String(availability.composerLocked)} />
      {availability.nextOpenLocal != null ? (
        <Row
          label="back at"
          value={`${availability.nextOpenLocal} (${availability.timezone ?? '?'})`}
        />
      ) : null}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Button({
  label,
  onPress,
  destructive,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        destructive === true ? styles.buttonDestructive : null,
        pressed ? styles.buttonPressed : null,
      ]}
    >
      <Text style={[styles.buttonLabel, destructive === true ? styles.buttonLabelDestructive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active ? styles.chipActive : null]}>
      <Text style={[styles.chipLabel, active ? styles.chipLabelActive : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 20, paddingBottom: 120 },
  title: { fontSize: 26, fontWeight: '700', color: '#0F172A' },
  subtitle: { fontSize: 12, color: '#64748B', marginTop: 2, marginBottom: 16 },
  status: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  rowLabel: { fontSize: 12, color: '#64748B' },
  rowValue: { fontSize: 12, color: '#0F172A', fontWeight: '600' },
  section: { marginTop: 20 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0F172A',
    marginBottom: 8,
  },
  button: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  buttonPressed: { opacity: 0.75 },
  buttonDestructive: { backgroundColor: '#FEE2E2' },
  buttonLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  buttonLabelDestructive: { color: '#B91C1C' },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginEnd: 8,
    marginBottom: 8,
  },
  chipActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  chipLabel: { fontSize: 14, color: '#334155' },
  chipLabelActive: { color: '#FFFFFF', fontWeight: '600' },
  hint: { fontSize: 12, color: '#64748B', lineHeight: 17, marginTop: 2 },
  logLine: { fontSize: 11, color: '#334155', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
