import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

/**
 * The SDK's icon set, drawn from plain `View`s.
 *
 * No icon font, no SVG library, no `@expo/vector-icons`. A chat SDK that
 * forces a ~1MB icon font (or a native SVG module) into every host app is
 * paying a very large bill for two dozen 16px glyphs, and an OPTIONAL icon
 * peer would mean shipping a fallback set anyway — so this IS the set.
 *
 * Stars are the one exception: a five-pointed star cannot be built from
 * rectangles, and `★`/`☆` are present in the default system font on both
 * platforms. Everything else is rectangles, borders and rotations.
 *
 * Every icon takes `color` and `size` so it inherits the workspace theme.
 */

interface IconProps {
  color: string;
  size?: number;
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', borderRadius: 1 },
});

/** A single rounded bar, the primitive every glyph below is built from. */
function Bar({
  color,
  width,
  height,
  rotate,
  translateX = 0,
  translateY = 0,
  radius,
}: {
  color: string;
  width: number;
  height: number;
  rotate?: number;
  translateX?: number;
  translateY?: number;
  radius?: number;
}): React.JSX.Element {
  return (
    <View
      style={[
        styles.bar,
        {
          width,
          height,
          backgroundColor: color,
          borderRadius: radius ?? Math.min(width, height) / 2,
          transform: [
            { translateX },
            { translateY },
            ...(rotate != null ? [{ rotate: `${rotate}deg` }] : []),
          ],
        },
      ]}
    />
  );
}

function IconBox({
  size,
  children,
}: {
  size: number;
  children: React.ReactNode;
}): React.JSX.Element {
  return <View style={[styles.box, { width: size, height: size }]}>{children}</View>;
}

/** ✓ — one tick: the message is stored server-side. */
export function CheckIcon({ color, size = 14 }: IconProps): React.JSX.Element {
  const s = size;
  return (
    <IconBox size={s}>
      <Bar
        color={color}
        width={s * 0.34}
        height={s * 0.12}
        rotate={45}
        translateX={-s * 0.24}
        translateY={s * 0.16}
      />
      <Bar
        color={color}
        width={s * 0.62}
        height={s * 0.12}
        rotate={-45}
        translateX={s * 0.04}
        translateY={s * 0.02}
      />
    </IconBox>
  );
}

/**
 * ✓✓ — two ticks: an agent has read it.
 *
 * Shape-symmetric, so unlike a chevron it needs no mirroring in RTL — the
 * surrounding row already flips its position.
 */
export function DoubleCheckIcon({ color, size = 14 }: IconProps): React.JSX.Element {
  const s = size;
  return (
    <IconBox size={s}>
      <View style={{ transform: [{ translateX: -s * 0.16 }] }}>
        <CheckIcon color={color} size={s} />
      </View>
      <View style={{ position: 'absolute', transform: [{ translateX: s * 0.2 }] }}>
        <CheckIcon color={color} size={s} />
      </View>
    </IconBox>
  );
}

/** A clock face — the message is still in flight. */
export function ClockIcon({ color, size = 14 }: IconProps): React.JSX.Element {
  const s = size;
  return (
    <IconBox size={s}>
      <View
        style={{
          width: s * 0.86,
          height: s * 0.86,
          borderRadius: s * 0.43,
          borderWidth: Math.max(1, s * 0.09),
          borderColor: color,
        }}
      />
      <Bar color={color} width={s * 0.09} height={s * 0.26} translateY={-s * 0.11} radius={0} />
      <Bar
        color={color}
        width={s * 0.2}
        height={s * 0.09}
        translateX={s * 0.05}
        translateY={s * 0.02}
        radius={0}
      />
    </IconBox>
  );
}

/** × — close / remove / discard. */
export function CloseIcon({ color, size = 18 }: IconProps): React.JSX.Element {
  const s = size;
  const thickness = Math.max(1.5, s * 0.1);
  return (
    <IconBox size={s}>
      <Bar color={color} width={s * 0.78} height={thickness} rotate={45} />
      <Bar color={color} width={s * 0.78} height={thickness} rotate={-45} />
    </IconBox>
  );
}

/** A paper-plane-ish send arrow: a chevron with a stem. */
/**
 * A paper-plane send arrow.
 *
 * DIRECTIONAL. It points the way text flows, so every call site must wrap it
 * in `directionStyles.mirror` — the same rule `BackIcon` carries. Flutter gets
 * this free from `matchTextDirection` on `Icons.send_rounded`; these icons are
 * drawn from Views, so mirroring is opt-in and easy to forget. It was forgotten
 * once, on the voice-note send button.
 */
export function SendIcon({ color, size = 20 }: IconProps): React.JSX.Element {
  const s = size;
  const thickness = Math.max(1.5, s * 0.1);
  return (
    <IconBox size={s}>
      <Bar color={color} width={s * 0.6} height={thickness} />
      {/* The chevron meets at a vertex on the TRAILING end of the stem, so the
          upper arm slopes DOWN to it (clockwise, +45) and the lower arm slopes
          UP to it (-45). Swapping the two — which is easy to do and hard to
          see in code — points the arrowhead backwards, and the button reads as
          "«" rather than "send". */}
      <Bar
        color={color}
        width={s * 0.42}
        height={thickness}
        rotate={45}
        translateX={s * 0.16}
        translateY={-s * 0.14}
      />
      <Bar
        color={color}
        width={s * 0.42}
        height={thickness}
        rotate={-45}
        translateX={s * 0.16}
        translateY={s * 0.14}
      />
    </IconBox>
  );
}

/** + inside a circle — the attach affordance. */
export function PlusIcon({ color, size = 22 }: IconProps): React.JSX.Element {
  const s = size;
  const thickness = Math.max(1.5, s * 0.09);
  return (
    <IconBox size={s}>
      <View
        style={{
          width: s,
          height: s,
          borderRadius: s / 2,
          borderWidth: thickness,
          borderColor: color,
        }}
      />
      <Bar color={color} width={s * 0.46} height={thickness} />
      <Bar color={color} width={thickness} height={s * 0.46} />
    </IconBox>
  );
}

/** A microphone: capsule, stem, base. */
export function MicIcon({ color, size = 22 }: IconProps): React.JSX.Element {
  const s = size;
  const thickness = Math.max(1.5, s * 0.09);
  return (
    <IconBox size={s}>
      <View
        style={{
          position: 'absolute',
          width: s * 0.34,
          height: s * 0.5,
          borderRadius: s * 0.17,
          backgroundColor: color,
          transform: [{ translateY: -s * 0.16 }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: s * 0.62,
          height: s * 0.32,
          borderBottomLeftRadius: s * 0.31,
          borderBottomRightRadius: s * 0.31,
          borderWidth: thickness,
          // General first, then the side that must stay open — a `borderColor`
          // declared afterwards would paint over `borderTopColor`.
          borderColor: color,
          borderTopColor: 'transparent',
          transform: [{ translateY: s * 0.12 }],
        }}
      />
      <Bar color={color} width={thickness} height={s * 0.16} translateY={s * 0.36} radius={0} />
    </IconBox>
  );
}

/**
 * A filled square.
 *
 * No longer used by the SDK itself: the recording bar's button SENDS, so it
 * draws [SendIcon]. Kept because the icon set is part of the public API and a
 * host may be drawing its own controls with it.
 */
export function StopIcon({ color, size = 16 }: IconProps): React.JSX.Element {
  return (
    <IconBox size={size}>
      <View
        style={{
          width: size * 0.62,
          height: size * 0.62,
          borderRadius: 2,
          backgroundColor: color,
        }}
      />
    </IconBox>
  );
}

/**
 * A right-pointing wedge — play a voice message.
 *
 * The second exception to "everything is rectangles": a triangle is the one
 * shape they cannot make. Borders can — a zero-sized box whose left border is
 * coloured and whose top and bottom borders are transparent renders as a
 * wedge, which needs no SVG and no glyph.
 *
 * Deliberately PHYSICAL (`borderLeft`, not `borderStart`) and nudged with a
 * transform rather than a logical margin: play points the same way in every
 * language, exactly as it does on every physical device with a play button.
 */
export function PlayIcon({ color, size = 20 }: IconProps): React.JSX.Element {
  const width = size * 0.3;
  const half = size * 0.2;
  return (
    <IconBox size={size}>
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: half,
          borderBottomWidth: half,
          borderLeftWidth: width,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: color,
          // The wedge's visual mass sits left of its bounding box.
          transform: [{ translateX: width * 0.25 }],
        }}
      />
    </IconBox>
  );
}

/** Two upright bars — pause a voice message. */
export function PauseIcon({ color, size = 20 }: IconProps): React.JSX.Element {
  const width = size * 0.14;
  const height = size * 0.5;
  const gap = size * 0.13;
  return (
    <IconBox size={size}>
      <Bar color={color} width={width} height={height} translateX={-gap} radius={1} />
      <Bar color={color} width={width} height={height} translateX={gap} radius={1} />
    </IconBox>
  );
}

/**
 * A star, filled or outlined.
 *
 * The one text glyph in the set — see the module doc. `★`/`☆` are in the
 * default system font on iOS and Android, and a five-pointed star is not
 * expressible in rectangles.
 */
export function StarIcon({
  color,
  size = 32,
  filled,
}: IconProps & { filled: boolean }): React.JSX.Element {
  return (
    <Text
      allowFontScaling={false}
      style={{ fontSize: size, lineHeight: size * 1.15, color }}
    >
      {filled ? '★' : '☆'}
    </Text>
  );
}

/**
 * A back chevron with a stem.
 *
 * DIRECTIONAL: mirror it in RTL (wrap in `directionStyles.mirror`), which is
 * why it is the only glyph here that cares.
 */
export function BackIcon({ color, size = 22 }: IconProps): React.JSX.Element {
  const s = size;
  const thickness = Math.max(1.5, s * 0.09);
  return (
    <IconBox size={s}>
      <Bar color={color} width={s * 0.68} height={thickness} />
      <Bar
        color={color}
        width={s * 0.38}
        height={thickness}
        rotate={-45}
        translateX={-s * 0.21}
        translateY={-s * 0.13}
      />
      <Bar
        color={color}
        width={s * 0.38}
        height={thickness}
        rotate={45}
        translateX={-s * 0.21}
        translateY={s * 0.13}
      />
    </IconBox>
  );
}

/** A speech bubble — the launcher's fallback when the tenant set no icon. */
export function ChatBubbleIcon({ color, size = 26 }: IconProps): React.JSX.Element {
  const s = size;
  return (
    <IconBox size={s}>
      <View
        style={{
          width: s * 0.92,
          height: s * 0.72,
          borderRadius: s * 0.22,
          backgroundColor: color,
          transform: [{ translateY: -s * 0.08 }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: s * 0.24,
          height: s * 0.24,
          backgroundColor: color,
          borderBottomLeftRadius: s * 0.06,
          transform: [{ translateX: -s * 0.22 }, { translateY: s * 0.3 }, { rotate: '20deg' }],
        }}
      />
    </IconBox>
  );
}

/** A bin — throw the recording away. */
export function TrashIcon({ color, size = 22 }: IconProps): React.JSX.Element {
  const body = size * 0.5;
  const w = size * 0.46;
  return (
    <IconBox size={size}>
      {/* lid */}
      <Bar color={color} width={w} height={size * 0.09} translateY={-size * 0.26} radius={1} />
      {/* handle */}
      <Bar color={color} width={w * 0.4} height={size * 0.07} translateY={-size * 0.36} radius={1} />
      {/* the can, drawn as an outline so it does not read as a solid block */}
      <View
        style={{
          position: 'absolute',
          width: w * 0.78,
          height: body,
          transform: [{ translateY: size * 0.09 }],
          borderWidth: size * 0.075,
          borderColor: color,
          borderTopLeftRadius: 1,
          borderTopRightRadius: 1,
          borderBottomLeftRadius: size * 0.08,
          borderBottomRightRadius: size * 0.08,
        }}
      />
    </IconBox>
  );
}

/** A document — the file-attachment chip. */
export function FileIcon({ color, size = 18 }: IconProps): React.JSX.Element {
  const s = size;
  const thickness = Math.max(1, s * 0.09);
  return (
    <IconBox size={s}>
      <View
        style={{
          width: s * 0.66,
          height: s * 0.86,
          borderRadius: s * 0.08,
          borderWidth: thickness,
          borderColor: color,
        }}
      />
      <Bar
        color={color}
        width={s * 0.34}
        height={thickness}
        translateY={-s * 0.12}
        radius={0}
      />
      <Bar color={color} width={s * 0.34} height={thickness} translateY={s * 0.06} radius={0} />
      <Bar color={color} width={s * 0.2} height={thickness} translateX={-s * 0.07} translateY={s * 0.24} radius={0} />
    </IconBox>
  );
}

/** A struck-through frame — media that exists but cannot be rendered. */
export function BrokenImageIcon({ color, size = 18 }: IconProps): React.JSX.Element {
  const s = size;
  const thickness = Math.max(1, s * 0.09);
  return (
    <IconBox size={s}>
      <View
        style={{
          width: s * 0.82,
          height: s * 0.7,
          borderRadius: s * 0.08,
          borderWidth: thickness,
          borderColor: color,
        }}
      />
      <Bar color={color} width={s} height={thickness} rotate={-38} />
    </IconBox>
  );
}

/** A down arrow onto a baseline — the download affordance on a file chip. */
export function DownloadIcon({ color, size = 16 }: IconProps): React.JSX.Element {
  const s = size;
  const thickness = Math.max(1, s * 0.1);
  return (
    <IconBox size={s}>
      <Bar color={color} width={thickness} height={s * 0.5} translateY={-s * 0.12} />
      <Bar
        color={color}
        width={s * 0.3}
        height={thickness}
        rotate={45}
        translateX={-s * 0.1}
        translateY={s * 0.06}
      />
      <Bar
        color={color}
        width={s * 0.3}
        height={thickness}
        rotate={-45}
        translateX={s * 0.1}
        translateY={s * 0.06}
      />
      <Bar color={color} width={s * 0.66} height={thickness} translateY={s * 0.36} />
    </IconBox>
  );
}

/** A tick inside a circle — the "thanks, we're done" confirmation. */
export function CheckCircleIcon({ color, size = 48 }: IconProps): React.JSX.Element {
  const s = size;
  return (
    <IconBox size={s}>
      <View
        style={{
          width: s,
          height: s,
          borderRadius: s / 2,
          borderWidth: Math.max(2, s * 0.06),
          borderColor: color,
        }}
      />
      {/* Absolute, or it lays out BELOW the ring rather than inside it — an
          IconBox centres its children in a column like any other View. */}
      <View style={StyleSheet.absoluteFill}>
        <IconBox size={s}>
          <CheckIcon color={color} size={s * 0.55} />
        </IconBox>
      </View>
    </IconBox>
  );
}

/** A crossed-out cloud stand-in — the "couldn't connect" error state. */
export function OfflineIcon({ color, size = 40 }: IconProps): React.JSX.Element {
  const s = size;
  const thickness = Math.max(2, s * 0.06);
  return (
    <IconBox size={s}>
      <View
        style={{
          width: s * 0.8,
          height: s * 0.55,
          borderRadius: s * 0.27,
          borderWidth: thickness,
          borderColor: color,
        }}
      />
      <Bar color={color} width={s * 0.95} height={thickness} rotate={-38} />
    </IconBox>
  );
}

/** A hollow radio dot / filled selection dot for the survey's option rows. */
export function RadioIcon({
  color,
  size = 20,
  selected,
}: IconProps & { selected: boolean }): React.JSX.Element {
  return (
    <IconBox size={size}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: color,
        }}
      />
      {selected ? (
        <View
          style={{
            position: 'absolute',
            width: size * 0.5,
            height: size * 0.5,
            borderRadius: size * 0.25,
            backgroundColor: color,
          }}
        />
      ) : null}
    </IconBox>
  );
}

/** A checkbox, for the survey's yes/no fields. */
export function CheckboxIcon({
  color,
  size = 20,
  checked,
  borderColor,
}: IconProps & { checked: boolean; borderColor: string }): React.JSX.Element {
  return (
    <IconBox size={size}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: 4,
          borderWidth: 2,
          borderColor: checked ? color : borderColor,
          backgroundColor: checked ? color : 'transparent',
        }}
      />
      {checked ? (
        <View style={StyleSheet.absoluteFill}>
          <IconBox size={size}>
            <CheckIcon color="#FFFFFF" size={size * 0.7} />
          </IconBox>
        </View>
      ) : null}
    </IconBox>
  );
}

/** A downward caret for the select control. */
export function CaretDownIcon({ color, size = 12 }: IconProps): React.JSX.Element {
  const s = size;
  const thickness = Math.max(1.5, s * 0.16);
  return (
    <IconBox size={s}>
      <Bar
        color={color}
        width={s * 0.62}
        height={thickness}
        rotate={45}
        translateX={-s * 0.19}
      />
      <Bar color={color} width={s * 0.62} height={thickness} rotate={-45} translateX={s * 0.19} />
    </IconBox>
  );
}
