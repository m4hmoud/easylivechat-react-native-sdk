import React, { createContext, useContext, useMemo } from 'react';
import { I18nManager, type FlexStyle, type TextStyle, type ViewStyle } from 'react-native';

export type Direction = 'ltr' | 'rtl';

/**
 * The chat subtree's layout direction.
 *
 * RTL IN REACT NATIVE IS A TRAP: `I18nManager.forceRTL` is PROCESS-GLOBAL and
 * requires an app restart to take effect, so an SDK must never call it — doing
 * so would flip the HOST app too, and only after the user relaunched. Layout is
 * therefore driven from the resolved direction ourselves: passed down through
 * this context and applied with `row-reverse`, `textAlign` and
 * `writingDirection`.
 *
 * The chat can be RTL inside an LTR host app, and must be.
 *
 * It can also be RTL inside an app that is ALREADY RTL, and that is the case
 * this got wrong. See `directionStyles`.
 */
const DirectionContext = createContext<Direction>('ltr');

export function DirectionProvider({
  value,
  children,
}: {
  value: Direction;
  children: React.ReactNode;
}): React.JSX.Element {
  return <DirectionContext.Provider value={value}>{children}</DirectionContext.Provider>;
}

export function useDirection(): Direction {
  return useContext(DirectionContext);
}

/** Every logical-direction style helper, memoised per direction. */
export interface DirectionStyles {
  direction: Direction;
  isRtl: boolean;
  /** A `flexDirection` that reads leading→trailing. */
  row: FlexStyle['flexDirection'];
  /** A `flexDirection` that reads trailing→leading. */
  rowReverse: FlexStyle['flexDirection'];
  /** Align a child to the leading edge. */
  alignStart: FlexStyle['alignItems'];
  /** Align a child to the trailing edge. */
  alignEnd: FlexStyle['alignItems'];
  /** Text aligned to the leading edge. */
  textStart: TextStyle;
  /** Text aligned to the trailing edge. */
  textEnd: TextStyle;
  /** Mirrors a directional glyph (a back chevron). Ticks need no mirroring. */
  mirror: { transform: [{ scaleX: number }] };
}

export function useDirectionStyles(): DirectionStyles {
  const direction = useDirection();
  return useMemo(() => directionStyles(direction), [direction]);
}

/**
 * Logical styles for `direction`, expressed against the direction the layout
 * engine is ALREADY applying.
 *
 * `hostRtl` is the host app's `I18nManager.isRTL`. It matters because React
 * Native mirrors layout itself when that flag is set: `flexDirection: 'row'`
 * lays out right-to-left, `flex-start` means the right edge, and `textAlign:
 * 'left'` resolves to the right edge on both platforms. Those are not physical
 * values; they are already logical.
 *
 * So this used to double-flip. Written for an LTR host, it returned
 * `row-reverse` for an RTL chat — correct there, and exactly wrong inside a
 * host that had called `forceRTL(true)`, where the engine's own mirroring then
 * cancelled it and the chat came out left-to-right. The Zirak captain app hit
 * this the moment it switched to Kurdish: an LTR app bar and composer, with
 * the arrows pointing the other way because TRANSFORMS are not mirrored and so
 * were the only things still honouring the SDK's intent.
 *
 * The rule is a comparison, not a constant: when our direction AGREES with the
 * host's, the plain logical value is already right and must be left alone;
 * only when they disagree is anything reversed. An LTR host with an RTL chat
 * disagrees — which is why the old code looked correct for as long as that was
 * the only case anyone tried.
 *
 * `mirror` is the exception and stays absolute. It is a `scaleX` transform,
 * and React Native does not mirror transforms, so a directional glyph has to
 * be flipped by us whenever the chat is RTL whatever the host is doing.
 */
export function directionStyles(
  direction: Direction,
  hostRtl: boolean = I18nManager.isRTL,
): DirectionStyles {
  const isRtl = direction === 'rtl';
  const agrees = isRtl === hostRtl;
  return {
    direction,
    isRtl,
    row: agrees ? 'row' : 'row-reverse',
    rowReverse: agrees ? 'row-reverse' : 'row',
    alignStart: agrees ? 'flex-start' : 'flex-end',
    alignEnd: agrees ? 'flex-end' : 'flex-start',
    // `writingDirection` alongside `textAlign` so a mixed-script line lays its
    // own neutrals out correctly, not just its block edge. It names the
    // absolute direction, because it is about the text's own bidi base and not
    // about which edge the block sits against.
    textStart: { textAlign: agrees ? 'left' : 'right', writingDirection: direction },
    textEnd: { textAlign: agrees ? 'right' : 'left', writingDirection: direction },
    mirror: { transform: [{ scaleX: isRtl ? -1 : 1 }] },
  };
}

/**
 * An absolutely-positioned inset pinned to the TRAILING edge of `direction`.
 *
 * `start`/`end` cannot be used: they resolve through `I18nManager.isRTL`, the
 * host's flag, and the chat's direction is its own. But `left`/`right` are not
 * physical either — React Native swaps them whenever the host is RTL — so
 * naming a side directly was only right while the host was LTR. Both flips are
 * accounted for here: pick the side we want to see, then write whichever
 * property the engine will resolve to it.
 */
export function insetEnd(
  direction: Direction,
  inset: number,
  hostRtl: boolean = I18nManager.isRTL,
): ViewStyle {
  const wanted: 'left' | 'right' = direction === 'rtl' ? 'left' : 'right';
  const property = hostRtl ? (wanted === 'left' ? 'right' : 'left') : wanted;
  return { [property]: inset };
}

/**
 * Wrap a run of digits and separators so it keeps its own reading order inside
 * a right-to-left sentence.
 *
 * `12/08/2026` is digits joined by NEUTRAL characters, and neutrals take the
 * direction of the paragraph around them. Dropped bare into Kurdish or Arabic
 * copy the groups lay out right-to-left and the date reads back to front — a
 * correct date arriving on screen looking like `٢٢/٠٨/٢٢٤`. Arabic hid this
 * only because its short format uses a month NAME, whose strong letters pin
 * the order.
 *
 * FSI/PDI rather than LRE/PDF: the run decides its own direction from its
 * first strong character and cannot leak that decision to the sentence.
 */
export function isolate(run: string): string {
  return `⁨${run}⁩`;
}
