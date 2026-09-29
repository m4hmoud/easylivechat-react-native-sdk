import { describe, expect, it } from 'vitest';

import { directionStyles, insetEnd } from '../src/direction';

/**
 * The chat's direction is its own; the HOST's is React Native's.
 *
 * When `I18nManager.isRTL` is set, the engine already mirrors layout: `row`
 * lays out right-to-left, `flex-start` is the right edge, and `textAlign:
 * 'left'` resolves to the right edge on both platforms. Those values are
 * logical, not physical.
 *
 * Written for an LTR host, this returned `row-reverse` for an RTL chat —
 * correct there, and exactly wrong inside a host that had called
 * `forceRTL(true)`, where the engine's own mirroring cancelled it and the chat
 * came out left-to-right. The Zirak captain app hit it the moment it switched
 * to Kurdish: an LTR app bar and composer, with the arrows still pointing the
 * right way because transforms are NOT mirrored.
 *
 * So the rule is a comparison, not a constant.
 */
describe('layout styles against the host direction', () => {
  describe('inside a left-to-right host', () => {
    it('leaves an LTR chat alone', () => {
      const dir = directionStyles('ltr', false);
      expect(dir.row).toBe('row');
      expect(dir.alignStart).toBe('flex-start');
      expect(dir.textStart.textAlign).toBe('left');
    });

    it('reverses an RTL chat, because the engine will not', () => {
      const dir = directionStyles('rtl', false);
      expect(dir.row).toBe('row-reverse');
      expect(dir.alignStart).toBe('flex-end');
      expect(dir.textStart.textAlign).toBe('right');
    });
  });

  describe('inside a right-to-left host', () => {
    /** The regression: the engine has already done it, so we must not. */
    it('leaves an RTL chat alone', () => {
      const dir = directionStyles('rtl', true);
      expect(dir.row).toBe('row');
      expect(dir.alignStart).toBe('flex-start');
      expect(dir.textStart.textAlign).toBe('left');
    });

    it('reverses an LTR chat back out of the host mirroring', () => {
      const dir = directionStyles('ltr', true);
      expect(dir.row).toBe('row-reverse');
      expect(dir.alignStart).toBe('flex-end');
      expect(dir.textStart.textAlign).toBe('right');
    });
  });

  /**
   * `mirror` is a `scaleX` transform and React Native does not mirror
   * transforms, so it follows the CHAT and ignores the host entirely. This is
   * what kept pointing the right way while everything around it was backwards,
   * and it is why the bug looked contradictory on screen.
   */
  it('mirrors a directional glyph by the chat, whatever the host does', () => {
    for (const host of [true, false]) {
      expect(directionStyles('rtl', host).mirror.transform[0].scaleX).toBe(-1);
      expect(directionStyles('ltr', host).mirror.transform[0].scaleX).toBe(1);
    }
  });

  it('reports the chat direction, not the resolved layout', () => {
    expect(directionStyles('rtl', true).isRtl).toBe(true);
    expect(directionStyles('rtl', false).isRtl).toBe(true);
    expect(directionStyles('ltr', true).isRtl).toBe(false);
  });

  /** `row` and `rowReverse` are always opposites, whichever way round. */
  it('keeps the two row helpers opposed', () => {
    for (const host of [true, false]) {
      for (const d of ['ltr', 'rtl'] as const) {
        const dir = directionStyles(d, host);
        expect(dir.row).not.toBe(dir.rowReverse);
      }
    }
  });
});

/**
 * `left`/`right` are swapped by the engine under an RTL host too, so naming a
 * side directly was only right while the host was LTR.
 */
describe('an inset pinned to the trailing edge', () => {
  it('sits on the right for an LTR chat in an LTR host', () => {
    expect(insetEnd('ltr', 16, false)).toEqual({ right: 16 });
  });

  it('sits on the left for an RTL chat in an LTR host', () => {
    expect(insetEnd('rtl', 16, false)).toEqual({ left: 16 });
  });

  /** Written as `right`, which an RTL host resolves to the left edge. */
  it('asks for the opposite property in an RTL host', () => {
    expect(insetEnd('rtl', 16, true)).toEqual({ right: 16 });
    expect(insetEnd('ltr', 16, true)).toEqual({ left: 16 });
  });

  it('keeps a negative overhang', () => {
    expect(insetEnd('ltr', -2, false)).toEqual({ right: -2 });
  });
});
