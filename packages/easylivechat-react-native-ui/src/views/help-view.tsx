import {
  type ChatMessage,
  type HelpArticle,
  type HelpArticleList,
  type HelpArticleSummary,
  type WidgetConfig,
  EasyLiveChat,
  EasyLiveChatError,
  EasyLiveChatErrorCode,
  HELP_SEARCH_MIN_LENGTH,
  isFromCustomer,
} from '@easylivechat/react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { isRtlLanguage, textDirectionOf } from '../bidi';
import { type Direction, directionStyles, useDirectionStyles } from '../direction';
import { ArticleIcon, BackIcon, ChevronIcon, CloseIcon, SearchIcon } from '../icons';
import type { Strings } from '../l10n';
import { MAX_FONT_SCALE } from '../text-scaling';
import { type EasyLiveChatTheme, withAlpha } from '../theme';
import { PrimaryButton } from './form-controls';
import { type ElcOpenLink, HelpMarkdownView } from './help-markdown-view';

/**
 * Where the help UI reads its articles. The default is the booted SDK
 * (`EasyLiveChat.instance`); tests — or a host with its own cache — pass
 * their own.
 */
export interface ElcHelpApi {
  /** The top articles for an empty (or one-character) `query`, else a search. */
  list(query: string): Promise<HelpArticleList>;
  /** One article in full. Rejects `NOT_FOUND` for one that has gone. */
  article(id: string): Promise<HelpArticle>;
  /** "Was this helpful?" */
  rate(id: string, helpful: boolean): Promise<void>;
}

/** The booted SDK. `async`, so "not booted" arrives as a rejection. */
export const SDK_HELP_API: ElcHelpApi = {
  async list(query) {
    const q = query.trim();
    return q.length < HELP_SEARCH_MIN_LENGTH
      ? EasyLiveChat.instance.helpArticles()
      : EasyLiveChat.instance.searchHelp(q);
  },
  async article(id) {
    // Also records the view — the SDK does that, fire-and-forget.
    return EasyLiveChat.instance.getHelpArticle(id);
  },
  async rate(id, helpful) {
    return EasyLiveChat.instance.rateHelpArticle(id, helpful);
  },
};

export interface HelpViewProps {
  theme: EasyLiveChatTheme;
  strings: Strings;
  /**
   * Leave help — the header's back button while the LIST is showing (from an
   * article it always goes back to the list). Omitted: no back button there.
   */
  onClose?: () => void;
  /**
   * "Still need help? Start a chat", under every article and the list.
   * Omitted: not offered — e.g. while the workspace takes no new chats.
   */
  onStartChat?: () => void;
  /**
   * A link inside an article was tapped. Omitted: the platform opens it
   * (browser, mail app, dialer).
   */
  onOpenLink?: ElcOpenLink;
  /**
   * Draw the header: back and the title. On by default. Off, an article gets
   * a "Back" of its own above it, so the list is never out of reach.
   */
  showAppBar?: boolean;
  /** Open straight onto one article. Back returns to the list. */
  initialArticleId?: string;
  /** Article source; defaults to the booted SDK. */
  api?: ElcHelpApi;
}

/** Wait this long after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 300;

/** One- and zero-character queries both mean "the top articles". */
function effectiveQuery(raw: string): string {
  const q = raw.trim();
  return q.length < HELP_SEARCH_MIN_LENGTH ? '' : q;
}

/**
 * An article's own reading direction: from its language when the server says
 * which, else from its first strongly-directional character, else `fallback`
 * (the screen's). An Arabic article listed in an English app reads
 * right-to-left from its title down.
 */
export function helpArticleDirection(
  article: Pick<HelpArticle, 'locale' | 'title' | 'body'>,
  fallback: Direction,
): Direction {
  if (article.locale != null) return isRtlLanguage(article.locale) ? 'rtl' : 'ltr';
  return textDirectionOf(`${article.title} ${article.body}`) ?? fallback;
}

/**
 * Whether the chat should offer its help entry: the workspace shows help
 * articles and the visitor has not written anything yet (once they have, the
 * conversation is the help).
 */
export function offerHelpEntry(
  config: Pick<WidgetConfig, 'helpArticlesEnabled'> | null,
  messages: readonly ChatMessage[],
): boolean {
  if (config?.helpArticlesEnabled !== true) return false;
  return !messages.some(isFromCustomer);
}

function isGone(e: unknown): boolean {
  return (
    e instanceof EasyLiveChatError &&
    (e.code === EasyLiveChatErrorCode.NOT_FOUND || e.httpStatus === 404)
  );
}

type ArticleState = 'loading' | 'ready' | 'missing' | 'failed';

/**
 * The workspace's help articles: a search field over the top articles, an
 * article reader with "Was this helpful?", and "Still need help? Start a
 * chat" at the foot of both — the same screens, states and wording as
 * `EasyLiveChatHelpScreen` in `easylivechat_ui` and the web widget.
 *
 * Needs a booted SDK only — no session — so it can stand in front of the chat
 * or on its own screen. Render it only when `widgetConfig.helpArticlesEnabled`
 * is true; with the switch off the list simply comes back empty.
 */
export function HelpView({
  theme,
  strings,
  onClose,
  onStartChat,
  onOpenLink,
  showAppBar = true,
  initialArticleId,
  api = SDK_HELP_API,
}: HelpViewProps): React.JSX.Element {
  const apiRef = useRef(api);
  apiRef.current = api;
  const mounted = useRef(true);

  // ── the list ──
  // Its state lives here, not in the list, so coming back from an article
  // finds the query and the results exactly as they were left.
  const [query, setQuery] = useState('');
  const [list, setList] = useState<HelpArticleList | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listFailed, setListFailed] = useState(false);
  /** The query `list` answers ('' for the top articles). */
  const [listedQuery, setListedQuery] = useState<string | null>(null);
  const listSeq = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read inside callbacks that must not be rebuilt on every keystroke.
  const listedRef = useRef<string | null>(null);
  const failedRef = useRef(false);
  listedRef.current = listedQuery;
  failedRef.current = listFailed;

  const loadList = useCallback(async (raw: string) => {
    const q = effectiveQuery(raw);
    // Drops a slow answer that a newer query has overtaken.
    const seq = ++listSeq.current;
    setListLoading(true);
    setListFailed(false);
    try {
      const res = await apiRef.current.list(q);
      if (!mounted.current || seq !== listSeq.current) return;
      setList(res);
      setListedQuery(q);
      setListLoading(false);
    } catch {
      if (!mounted.current || seq !== listSeq.current) return;
      setListLoading(false);
      setListFailed(true);
    }
  }, []);

  const onQueryChange = useCallback(
    (raw: string) => {
      setQuery(raw);
      if (debounce.current != null) clearTimeout(debounce.current);
      debounce.current = null;
      // Below the minimum the server lists the top articles whatever the
      // query says, so the first character must not refetch the same list.
      if (effectiveQuery(raw) === listedRef.current && !failedRef.current) return;
      debounce.current = setTimeout(() => {
        debounce.current = null;
        void loadList(raw);
      }, SEARCH_DEBOUNCE_MS);
    },
    [loadList],
  );

  const searchNow = useCallback(() => {
    if (debounce.current != null) clearTimeout(debounce.current);
    debounce.current = null;
    void loadList(query);
  }, [loadList, query]);

  const clearQuery = useCallback(() => onQueryChange(''), [onQueryChange]);

  // ── the article ──
  const [articleId, setArticleId] = useState<string | null>(null);
  const [article, setArticle] = useState<HelpArticle | null>(null);
  const [articleState, setArticleState] = useState<ArticleState>('loading');
  const articleSeq = useRef(0);
  /** "Was this helpful?" answers given on this screen, by article id. */
  const [answers, setAnswers] = useState<Record<string, boolean>>({});

  const openArticle = useCallback(async (id: string) => {
    const seq = ++articleSeq.current;
    setArticleId(id);
    setArticle(null);
    setArticleState('loading');
    try {
      const a = await apiRef.current.article(id);
      if (!mounted.current || seq !== articleSeq.current) return;
      setArticle(a);
      setArticleState('ready');
    } catch (e) {
      if (!mounted.current || seq !== articleSeq.current) return;
      setArticleState(isGone(e) ? 'missing' : 'failed');
    }
  }, []);

  const closeArticle = useCallback(() => {
    articleSeq.current++;
    setArticleId(null);
    setArticle(null);
  }, []);

  const answer = useCallback((id: string, helpful: boolean) => {
    setAnswers((prev) => ({ ...prev, [id]: helpful }));
    // Low stakes: the thanks stays even if the count does not land.
    apiRef.current.rate(id, helpful).catch(() => undefined);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadList('');
    if (initialArticleId != null && initialArticleId.length > 0) void openArticle(initialArticleId);
    return () => {
      mounted.current = false;
      if (debounce.current != null) clearTimeout(debounce.current);
    };
    // Once, on mount: a new `initialArticleId` is a new screen.
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {showAppBar ? (
        <HelpHeader
          theme={theme}
          strings={strings}
          onBack={articleId != null ? closeArticle : onClose}
        />
      ) : null}
      {articleId != null ? (
        <HelpArticleView
          articleId={articleId}
          article={article}
          state={articleState}
          answer={article != null ? answers[article.id] : undefined}
          theme={theme}
          strings={strings}
          ownBack={!showAppBar}
          onBack={closeArticle}
          onRetry={() => void openArticle(articleId)}
          onAnswer={answer}
          onOpenLink={onOpenLink}
          onStartChat={onStartChat}
        />
      ) : (
        <HelpListView
          query={query}
          onQueryChange={onQueryChange}
          onSubmit={searchNow}
          onClear={clearQuery}
          list={list}
          loading={listLoading}
          failed={listFailed}
          searching={(listedQuery ?? '').length > 0}
          theme={theme}
          strings={strings}
          onOpen={(id) => void openArticle(id)}
          onRetry={searchNow}
          onStartChat={onStartChat}
        />
      )}
    </View>
  );
}

function HelpHeader({
  theme,
  strings,
  onBack,
}: {
  theme: EasyLiveChatTheme;
  strings: Strings;
  onBack?: () => void;
}): React.JSX.Element {
  const dir = useDirectionStyles();
  return (
    <View
      style={[
        styles.header,
        { flexDirection: dir.row, borderBottomColor: withAlpha(theme.text, 0.08) },
      ]}
    >
      {onBack != null ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={strings.t('helpBack')}
          hitSlop={8}
          style={styles.headerButton}
        >
          {/* Directional: points the way back in either reading direction. */}
          <View style={dir.mirror}>
            <BackIcon color={theme.text} size={20} />
          </View>
        </Pressable>
      ) : (
        <View style={styles.headerInset} />
      )}
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.headerTitle, dir.textStart, { color: theme.text }]}
      >
        {strings.t('helpTitle')}
      </Text>
    </View>
  );
}

function HelpListView({
  query,
  onQueryChange,
  onSubmit,
  onClear,
  list,
  loading,
  failed,
  searching,
  theme,
  strings,
  onOpen,
  onRetry,
  onStartChat,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  list: HelpArticleList | null;
  loading: boolean;
  failed: boolean;
  searching: boolean;
  theme: EasyLiveChatTheme;
  strings: Strings;
  onOpen: (id: string) => void;
  onRetry: () => void;
  onStartChat?: () => void;
}): React.JSX.Element {
  const dir = useDirectionStyles();
  const muted = withAlpha(theme.text, 0.55);
  // The field follows what is typed in it, like the composer: an Arabic query
  // in an English workspace reads right-to-left from its first letter.
  const inputDir = directionStyles(textDirectionOf(query) ?? dir.direction);

  const count = list?.articles.length ?? 0;
  const resultsLabel = strings.t('helpResultsFound').replace('{n}', String(count));

  // Read out after each search; the list itself is not a live region. Android
  // announces the live node below by itself; iOS has no live regions, so it is
  // told.
  useEffect(() => {
    if (!searching || loading || list == null) return;
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(resultsLabel);
  }, [searching, loading, list, resultsLabel]);

  let body: React.ReactNode;
  if (list == null && loading) {
    body = <Spinner theme={theme} strings={strings} />;
  } else if (list == null && failed) {
    body = <Failure theme={theme} strings={strings} onRetry={onRetry} />;
  } else if (list != null) {
    body = (
      <>
        {searching ? (
          <View
            accessible
            accessibilityLabel={resultsLabel}
            accessibilityLiveRegion="polite"
            style={styles.liveRegion}
          />
        ) : count > 0 ? (
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.sectionHeading, dir.textStart, { color: withAlpha(theme.text, 0.6) }]}
          >
            {strings.t('helpTopArticles')}
          </Text>
        ) : null}
        {failed ? <Failure theme={theme} strings={strings} onRetry={onRetry} /> : null}
        {count === 0 && !failed ? (
          <Text style={[styles.notice, { color: withAlpha(theme.text, 0.7) }]}>
            {strings.t('helpNoResults')}
          </Text>
        ) : null}
        {list.articles.map((a) => (
          <HelpArticleRow key={a.id} article={a} theme={theme} onPress={() => onOpen(a.id)} />
        ))}
      </>
    );
  }

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.searchBox,
          {
            flexDirection: dir.row,
            backgroundColor: theme.surface,
            borderColor: withAlpha(theme.text, 0.12),
          },
        ]}
      >
        <SearchIcon color={muted} size={16} />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          onSubmitEditing={onSubmit}
          placeholder={strings.t('helpSearchPlaceholder')}
          placeholderTextColor={withAlpha(theme.text, 0.4)}
          accessibilityLabel={strings.t('helpSearchPlaceholder')}
          returnKeyType="search"
          autoCorrect={false}
          style={[styles.searchInput, inputDir.textStart, { color: theme.text }]}
        />
        {loading && list != null ? (
          <ActivityIndicator size="small" color={muted} accessibilityLabel={strings.t('helpLoading')} />
        ) : null}
        {query.length > 0 ? (
          <Pressable
            onPress={onClear}
            accessibilityRole="button"
            accessibilityLabel={strings.t('helpSearchClear')}
            hitSlop={10}
            style={styles.clearButton}
          >
            <CloseIcon color={muted} size={14} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.listContent}
      >
        {body}
        {onStartChat != null ? (
          <StartChatCard theme={theme} strings={strings} onStartChat={onStartChat} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function HelpArticleRow({
  article,
  theme,
  onPress,
}: {
  article: HelpArticleSummary;
  theme: EasyLiveChatTheme;
  onPress: () => void;
}): React.JSX.Element {
  const dir = useDirectionStyles();
  // Each row reads the way its own title does — an Arabic article listed in an
  // English app keeps its words right-to-left — while the row itself (chevron
  // on the trailing edge) follows the screen.
  const titleDir = directionStyles(textDirectionOf(article.title) ?? dir.direction);
  const excerptDir = directionStyles(textDirectionOf(article.excerpt) ?? titleDir.direction);
  const muted = withAlpha(theme.text, 0.6);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        {
          flexDirection: dir.row,
          borderBottomColor: withAlpha(theme.text, 0.08),
          backgroundColor: pressed ? withAlpha(theme.text, 0.04) : 'transparent',
        },
      ]}
    >
      <View style={styles.rowIcon}>
        <ArticleIcon color={withAlpha(theme.primary, 0.85)} size={20} />
      </View>
      <View style={styles.rowBody}>
        {article.category != null ? (
          <Text numberOfLines={1} style={[styles.rowCategory, titleDir.textStart, { color: muted }]}>
            {article.category}
          </Text>
        ) : null}
        <Text numberOfLines={2} style={[styles.rowTitle, titleDir.textStart, { color: theme.text }]}>
          {article.title}
        </Text>
        {article.excerpt.length > 0 ? (
          <Text numberOfLines={2} style={[styles.rowExcerpt, excerptDir.textStart, { color: muted }]}>
            {article.excerpt}
          </Text>
        ) : null}
      </View>
      <View style={dir.mirror}>
        <ChevronIcon color={withAlpha(theme.text, 0.35)} size={12} />
      </View>
    </Pressable>
  );
}

function HelpArticleView({
  articleId,
  article,
  state,
  answer,
  theme,
  strings,
  ownBack,
  onBack,
  onRetry,
  onAnswer,
  onOpenLink,
  onStartChat,
}: {
  articleId: string;
  article: HelpArticle | null;
  state: ArticleState;
  answer: boolean | undefined;
  theme: EasyLiveChatTheme;
  strings: Strings;
  /** No header to go back with: draw a back of the article's own. */
  ownBack: boolean;
  onBack: () => void;
  onRetry: () => void;
  onAnswer: (id: string, helpful: boolean) => void;
  onOpenLink?: ElcOpenLink;
  onStartChat?: () => void;
}): React.JSX.Element {
  const dir = useDirectionStyles();

  let body: React.ReactNode = null;
  if (state === 'loading') {
    body = <Spinner theme={theme} strings={strings} />;
  } else if (state === 'missing') {
    body = (
      <Text style={[styles.notice, { color: withAlpha(theme.text, 0.75) }]}>
        {strings.t('helpArticleUnavailable')}
      </Text>
    );
  } else if (state === 'failed' || article == null) {
    body = <Failure theme={theme} strings={strings} onRetry={onRetry} />;
  } else {
    const ad = directionStyles(helpArticleDirection(article, dir.direction));
    body = (
      <>
        <View style={styles.article}>
          <Text accessibilityRole="header" style={[styles.articleTitle, ad.textStart, { color: theme.text }]}>
            {article.title}
          </Text>
          {article.category != null ? (
            <Text style={[styles.articleCategory, ad.textStart, { color: withAlpha(theme.text, 0.6) }]}>
              {article.category}
            </Text>
          ) : null}
          <HelpMarkdownView
            source={article.body}
            theme={theme}
            direction={ad.direction}
            onOpenLink={onOpenLink}
          />
        </View>
        <View style={styles.feedback}>
          <HelpFeedback
            answered={answer != null}
            theme={theme}
            strings={strings}
            onAnswer={(helpful) => onAnswer(article.id.length > 0 ? article.id : articleId, helpful)}
          />
        </View>
      </>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.listContent}>
      {ownBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          hitSlop={6}
          style={[styles.ownBack, { flexDirection: dir.row, alignSelf: dir.alignStart }]}
        >
          <View style={dir.mirror}>
            <BackIcon color={theme.text} size={16} />
          </View>
          <View style={{ width: 6 }} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.ownBackLabel, { color: theme.text }]}>
            {strings.t('helpBack')}
          </Text>
        </Pressable>
      ) : null}
      {body}
      {onStartChat != null ? (
        <StartChatCard theme={theme} strings={strings} onStartChat={onStartChat} />
      ) : null}
    </ScrollView>
  );
}

/** "Was this helpful? Yes / No", then the thanks — answered once per screen. */
function HelpFeedback({
  answered,
  theme,
  strings,
  onAnswer,
}: {
  answered: boolean;
  theme: EasyLiveChatTheme;
  strings: Strings;
  onAnswer: (helpful: boolean) => void;
}): React.JSX.Element {
  const dir = useDirectionStyles();
  if (answered) {
    return (
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.thanks, dir.textStart, { color: withAlpha(theme.text, 0.75) }]}
      >
        {strings.t('helpFeedbackThanks')}
      </Text>
    );
  }
  return (
    <View>
      <Text style={[styles.feedbackQuestion, dir.textStart, { color: theme.text }]}>
        {strings.t('helpWasHelpful')}
      </Text>
      <View style={[styles.feedbackButtons, { flexDirection: dir.row }]}>
        <FeedbackButton label={strings.t('helpYes')} theme={theme} onPress={() => onAnswer(true)} />
        <FeedbackButton label={strings.t('helpNo')} theme={theme} onPress={() => onAnswer(false)} />
      </View>
    </View>
  );
}

function FeedbackButton({
  label,
  theme,
  onPress,
}: {
  label: string;
  theme: EasyLiveChatTheme;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={4}
      style={({ pressed }) => [
        styles.feedbackButton,
        {
          borderColor: withAlpha(theme.text, 0.2),
          backgroundColor: pressed ? withAlpha(theme.text, 0.06) : 'transparent',
        },
      ]}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.feedbackLabel, { color: theme.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** "Still need help? Start a chat", on a card of its own. */
function StartChatCard({
  theme,
  strings,
  onStartChat,
}: {
  theme: EasyLiveChatTheme;
  strings: Strings;
  onStartChat: () => void;
}): React.JSX.Element {
  const dir = useDirectionStyles();
  return (
    <View style={[styles.startChat, { backgroundColor: theme.surface }]}>
      <Text style={[styles.startChatText, dir.textStart, { color: theme.text }]}>
        {strings.t('helpStillNeedHelp')}
      </Text>
      <PrimaryButton label={strings.t('helpStartChat')} onPress={onStartChat} theme={theme} />
    </View>
  );
}

function Spinner({ theme, strings }: { theme: EasyLiveChatTheme; strings: Strings }): React.JSX.Element {
  return (
    <View style={styles.spinner}>
      <ActivityIndicator size="large" color={theme.primary} accessibilityLabel={strings.t('helpLoading')} />
    </View>
  );
}

function Failure({
  theme,
  strings,
  onRetry,
}: {
  theme: EasyLiveChatTheme;
  strings: Strings;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.failure}>
      <Text style={[styles.notice, styles.failureText, { color: withAlpha(theme.text, 0.75) }]}>
        {strings.t('helpLoadFailed')}
      </Text>
      <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={8} style={styles.retry}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.retryLabel, { color: theme.primary }]}>
          {strings.t('retry')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    height: 52,
    alignItems: 'center',
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerInset: { width: 12 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '600', marginHorizontal: 4 },
  searchBox: {
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 44,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 10 },
  clearButton: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 24 },
  // Present for the screen reader only.
  liveRegion: { height: 1 },
  sectionHeading: { fontSize: 13, fontWeight: '600', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  row: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: { width: 28, alignItems: 'center' },
  rowBody: { flex: 1, marginHorizontal: 10 },
  rowCategory: { fontSize: 12, fontWeight: '500', marginBottom: 2 },
  rowTitle: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  rowExcerpt: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  notice: { fontSize: 15, lineHeight: 21, textAlign: 'center', padding: 24 },
  spinner: { padding: 32, alignItems: 'center' },
  failure: { padding: 24, alignItems: 'center' },
  failureText: { padding: 0 },
  retry: { marginTop: 12, paddingHorizontal: 12, paddingVertical: 6 },
  retryLabel: { fontSize: 15, fontWeight: '600' },
  ownBack: { alignItems: 'center', marginHorizontal: 12, marginTop: 8, paddingHorizontal: 6, paddingVertical: 8 },
  ownBackLabel: { fontSize: 15, fontWeight: '500' },
  article: { paddingHorizontal: 20, paddingTop: 16 },
  articleTitle: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  articleCategory: { fontSize: 13, marginTop: 4 },
  feedback: { paddingHorizontal: 20, paddingTop: 24 },
  thanks: { fontSize: 15 },
  feedbackQuestion: { fontSize: 15, fontWeight: '600' },
  // `gap`, not a margin on one side: `marginEnd` resolves against the HOST
  // app's direction, and the chat's can differ.
  feedbackButtons: { marginTop: 10, gap: 12 },
  feedbackButton: {
    minWidth: 76,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackLabel: { fontSize: 15, fontWeight: '600' },
  startChat: { marginHorizontal: 16, marginTop: 24, padding: 16, borderRadius: 14, gap: 12 },
  startChatText: { fontSize: 15, fontWeight: '600' },
});
