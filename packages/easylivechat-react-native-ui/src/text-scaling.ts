/**
 * How far the SDK lets the OS font-size setting stretch text inside its own
 * FIXED-HEIGHT controls.
 *
 * A visitor running the largest accessibility font otherwise clips the "Start
 * chat" and "Submit" labels out of their 50px buttons, and pushes the receipt
 * tick out of the meta row.
 *
 * Flutter clamps this once for the whole subtree
 * (`MediaQuery.withClampedTextScaling`). React Native has NO subtree
 * equivalent — the only global switch is mutating `Text.defaultProps`, which
 * is process-wide and would silently change the HOST app's typography, exactly
 * the way `I18nManager.forceRTL` would. So it is applied per control instead,
 * and ONLY where the box cannot grow.
 *
 * Everything that can reflow — message bodies, the composer, form labels,
 * notices — is deliberately left unclamped and scales all the way up.
 */
export const MAX_FONT_SCALE = 1.3;
