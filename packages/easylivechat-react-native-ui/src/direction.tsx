import React, { createContext, useContext, useMemo } from 'react';
import type { FlexStyle, TextStyle } from 'react-native';

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

export function directionStyles(direction: Direction): DirectionStyles {
  const isRtl = direction === 'rtl';
  return {
    direction,
    isRtl,
    row: isRtl ? 'row-reverse' : 'row',
    rowReverse: isRtl ? 'row' : 'row-reverse',
    alignStart: isRtl ? 'flex-end' : 'flex-start',
    alignEnd: isRtl ? 'flex-start' : 'flex-end',
    // `writingDirection` alongside `textAlign` so a mixed-script line lays its
    // own neutrals out correctly, not just its block edge.
    textStart: { textAlign: isRtl ? 'right' : 'left', writingDirection: direction },
    textEnd: { textAlign: isRtl ? 'left' : 'right', writingDirection: direction },
    mirror: { transform: [{ scaleX: isRtl ? -1 : 1 }] },
  };
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
