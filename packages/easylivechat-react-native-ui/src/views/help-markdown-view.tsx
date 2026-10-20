import {
  type HelpBlock,
  type HelpInline,
  parseHelpMarkdown,
  safeHelpHref,
} from '@easylivechat/react-native';
import React, { useCallback, useMemo } from 'react';
import { Linking, Platform, StyleSheet, Text, type TextStyle, View } from 'react-native';

import { type Direction, directionStyles, useDirection } from '../direction';
import { BrokenImageIcon } from '../icons';
import { type EasyLiveChatTheme, withAlpha } from '../theme';
import { RemoteImage } from './remote-image';

/**
 * Opens a link tapped inside a help article. The address has already been
 * checked — only http(s), mailto: and tel: ever reach it.
 */
export type ElcOpenLink = (url: string) => void | Promise<void>;

/**
 * A help article's body, drawn from the parsed tree with plain `View`s and
 * `Text`s.
 *
 * No WebView and no HTML, ever: the body is text a tenant typed (or pasted
 * from somewhere), so it is parsed into a small fixed set of nodes and each is
 * drawn as the component it is. Raw HTML in an article shows as the
 * characters it is. Links open through React Native's `Linking` — or your
 * `onOpenLink` — and only for http(s), mailto: and tel:, re-checked here at
 * the moment of the tap.
 *
 * The article lays out in ONE direction: `direction` when given — pass the
 * article's own (`helpArticleDirection`) when its language differs from the
 * app's, an Arabic article in an English app — else the chat's. Lists and
 * quotes put their marker on the reading side; code reads left-to-right
 * whatever surrounds it. Matches `ElcHelpMarkdown` in `easylivechat_ui`.
 */
export interface HelpMarkdownViewProps {
  /** The article body, in the help-markdown dialect. */
  source: string;
  theme: EasyLiveChatTheme;
  /** The article's own reading direction. Defaults to the chat's. */
  direction?: Direction;
  /**
   * A link was tapped. Omitted: the platform opens it (browser, mail app,
   * dialer) through `Linking`.
   */
  onOpenLink?: ElcOpenLink;
}

export function HelpMarkdownView({
  source,
  theme,
  direction,
  onOpenLink,
}: HelpMarkdownViewProps): React.JSX.Element {
  const blocks = useMemo(() => parseHelpMarkdown(source), [source]);
  const chatDirection = useDirection();
  const dir = direction ?? chatDirection;
  const open = useCallback(
    (href: string) => {
      void openHelpLink(href, onOpenLink);
    },
    [onOpenLink],
  );
  return (
    <View>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} theme={theme} direction={dir} onOpen={open} />
      ))}
    </View>
  );
}

/**
 * Open an article link: through `onOpenLink` when given, else `Linking`.
 * Never throws — a device with no handler, or a hook that fails, does nothing.
 */
export async function openHelpLink(href: string, onOpenLink?: ElcOpenLink): Promise<void> {
  // The parser already refused anything else; checked again because this is
  // the line that actually hands the address on.
  const safe = safeHelpHref(href);
  if (safe == null) return;
  try {
    if (onOpenLink != null) {
      await onOpenLink(safe);
    } else {
      await Linking.openURL(safe);
    }
  } catch {
    // No handler installed, or the host's hook refused — nothing to show.
  }
}

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

function BlockView({
  block,
  theme,
  direction,
  onOpen,
}: {
  block: HelpBlock;
  theme: EasyLiveChatTheme;
  direction: Direction;
  onOpen: (href: string) => void;
}): React.JSX.Element {
  const ds = directionStyles(direction);
  const body: TextStyle = { color: theme.text };

  switch (block.type) {
    case 'heading':
      return (
        <Text
          accessibilityRole="header"
          style={[
            block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3,
            ds.textStart,
            body,
          ]}
        >
          {renderInlines(block.children, theme, onOpen)}
        </Text>
      );

    case 'paragraph':
      return (
        <View style={styles.block}>
          {paragraphRuns(block.children).map((run, i) =>
            run.kind === 'image' ? (
              <HelpImage key={i} src={run.node.src} alt={run.node.alt} theme={theme} />
            ) : (
              <Text key={i} style={[styles.paragraph, ds.textStart, body]}>
                {renderInlines(run.nodes, theme, onOpen)}
              </Text>
            ),
          )}
        </View>
      );

    case 'list':
      return (
        <View style={styles.block}>
          {block.items.map((item, i) => (
            <View key={i} style={[styles.listRow, { flexDirection: ds.row }]}>
              <Text style={[styles.paragraph, styles.marker, body]}>
                {block.ordered ? `${block.start + i}.` : '•'}
              </Text>
              <Text style={[styles.paragraph, styles.listText, ds.textStart, body]}>
                {renderInlines(item, theme, onOpen)}
              </Text>
            </View>
          ))}
        </View>
      );

    case 'quote':
      return (
        <View style={[styles.block, { flexDirection: ds.row }]}>
          <View style={[styles.quoteBar, { backgroundColor: withAlpha(theme.primary, 0.45) }]} />
          <View style={styles.quoteBody}>
            {block.children.map((child, i) => (
              <BlockView
                key={i}
                block={child}
                theme={{ ...theme, text: withAlpha(theme.text, 0.8) }}
                direction={direction}
                onOpen={onOpen}
              />
            ))}
          </View>
        </View>
      );

    case 'code': {
      // Code reads left-to-right whatever surrounds it.
      const ltr = directionStyles('ltr');
      return (
        <View style={[styles.block, styles.codeBox, { backgroundColor: theme.surface }]}>
          <Text selectable style={[styles.code, ltr.textStart, body]}>
            {block.text}
          </Text>
        </View>
      );
    }

    case 'rule':
      return <View style={[styles.rule, { backgroundColor: withAlpha(theme.text, 0.12) }]} />;
  }
}

type ParagraphRun =
  | { kind: 'text'; nodes: HelpInline[] }
  | { kind: 'image'; node: Extract<HelpInline, { type: 'image' }> };

/**
 * A paragraph split around its images. An image cannot sit inside a `Text`
 * with any control over its size, so each one becomes a block of its own
 * between the runs of text either side.
 */
function paragraphRuns(children: readonly HelpInline[]): ParagraphRun[] {
  const runs: ParagraphRun[] = [];
  let current: HelpInline[] = [];
  const flush = (): void => {
    // A run that is only line breaks around an image would be an empty line.
    if (current.some((n) => n.type !== 'break')) runs.push({ kind: 'text', nodes: current });
    current = [];
  };
  for (const node of children) {
    if (node.type === 'image') {
      flush();
      runs.push({ kind: 'image', node });
    } else {
      current.push(node);
    }
  }
  flush();
  return runs;
}

function renderInlines(
  nodes: readonly HelpInline[],
  theme: EasyLiveChatTheme,
  onOpen: (href: string) => void,
): React.ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return <React.Fragment key={i}>{node.text}</React.Fragment>;
      case 'break':
        return <React.Fragment key={i}>{'\n'}</React.Fragment>;
      case 'strong':
        return (
          <Text key={i} style={styles.strong}>
            {renderInlines(node.children, theme, onOpen)}
          </Text>
        );
      case 'em':
        return (
          <Text key={i} style={styles.em}>
            {renderInlines(node.children, theme, onOpen)}
          </Text>
        );
      case 'code':
        return (
          <Text key={i} style={[styles.inlineCode, { backgroundColor: theme.surface }]}>
            {node.text}
          </Text>
        );
      case 'link':
        return (
          <Text
            key={i}
            accessibilityRole="link"
            onPress={() => onOpen(node.href)}
            style={[styles.link, { color: theme.primary, textDecorationColor: theme.primary }]}
          >
            {renderInlines(node.children, theme, onOpen)}
          </Text>
        );
      case 'image':
        // Only reached inside a heading or a list item, where an image has no
        // room: its description stands in for it.
        return <React.Fragment key={i}>{node.alt}</React.Fragment>;
    }
  });
}

function HelpImage({
  src,
  alt,
  theme,
}: {
  src: string;
  alt: string;
  theme: EasyLiveChatTheme;
}): React.JSX.Element {
  const label = alt.length > 0 ? alt : undefined;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={styles.imageBox}
    >
      <RemoteImage
        uri={src}
        style={[styles.image, { backgroundColor: withAlpha(theme.text, 0.04) }]}
        contentFit="contain"
        theme={theme}
        fallback={
          <View style={[styles.brokenImage, { backgroundColor: withAlpha(theme.text, 0.04) }]}>
            <BrokenImageIcon color={withAlpha(theme.text, 0.4)} size={22} />
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: 12 },
  h1: { fontSize: 22, lineHeight: 28, fontWeight: '700', marginTop: 4, marginBottom: 10 },
  h2: { fontSize: 19, lineHeight: 25, fontWeight: '700', marginTop: 4, marginBottom: 8 },
  h3: { fontSize: 16, lineHeight: 22, fontWeight: '700', marginTop: 2, marginBottom: 6 },
  paragraph: { fontSize: 15, lineHeight: 22 },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  link: { textDecorationLine: 'underline', fontWeight: '600' },
  inlineCode: { fontFamily: MONO, fontSize: 13 },
  listRow: { alignItems: 'flex-start', marginBottom: 4 },
  marker: { minWidth: 22, textAlign: 'center' },
  listText: { flex: 1 },
  quoteBar: { width: 3, borderRadius: 2, marginHorizontal: 2 },
  quoteBody: { flex: 1, paddingHorizontal: 10 },
  codeBox: { borderRadius: 8, padding: 12 },
  code: { fontFamily: MONO, fontSize: 13, lineHeight: 19 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
  imageBox: { marginVertical: 6 },
  image: { width: '100%', height: 200, borderRadius: 8 },
  brokenImage: {
    width: '100%',
    height: 120,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
