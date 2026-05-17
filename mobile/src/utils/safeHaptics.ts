/**
 * Safe wrapper around expo-haptics · never throws, never leaves an
 * unhandled promise rejection.
 *
 * 2026-05-17 · added after the user reported "APK crashes after
 * successful send-to-cpay transfer / new-device OTP / payment".
 * Root cause analysis · `Haptics.notificationAsync(...)` returns a
 * Promise that can reject on Android devices without haptic motor
 * support (cheap tablets, custom ROMs, certain emulators). Fired
 * as fire-and-forget, the rejection became an unhandled-promise-
 * rejection which the React Native runtime treats as a hard crash
 * on Hermes-built APKs (Cpay vc22+).
 *
 * Every call site in app/ + src/components/ should use this helper
 * instead of importing expo-haptics directly · enforced by lint
 * in CI.
 */
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

type Feedback = "success" | "warning" | "error";

const TYPE_MAP: Record<Feedback, Haptics.NotificationFeedbackType> = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
};

/**
 * Fire a notification haptic. Silently no-ops on web + on devices
 * without haptic support. Never throws · never leaves an unhandled
 * promise rejection.
 */
export function notify(feedback: Feedback): void {
  if (Platform.OS === "web") return;
  try {
    const fn = (Haptics as any)?.notificationAsync;
    if (typeof fn !== "function") return;
    const p = fn(TYPE_MAP[feedback]);
    if (p && typeof p.catch === "function") {
      p.catch(() => {});
    }
  } catch {
    // Swallow synchronous throws too · haptics are a UX nicety, never
    // a critical path.
  }
}

/**
 * Light/medium/heavy impact haptic · used for button-press feedback.
 * Same safety guarantees as `notify`.
 */
export function impact(style: "light" | "medium" | "heavy" = "light"): void {
  if (Platform.OS === "web") return;
  try {
    const fn = (Haptics as any)?.impactAsync;
    if (typeof fn !== "function") return;
    const map = {
      light: Haptics.ImpactFeedbackStyle?.Light,
      medium: Haptics.ImpactFeedbackStyle?.Medium,
      heavy: Haptics.ImpactFeedbackStyle?.Heavy,
    };
    const p = fn(map[style]);
    if (p && typeof p.catch === "function") {
      p.catch(() => {});
    }
  } catch {}
}

/**
 * Selection-change haptic · used for sliders, pickers, segmented
 * controls. Same safety guarantees as `notify`.
 */
export function selection(): void {
  if (Platform.OS === "web") return;
  try {
    const fn = (Haptics as any)?.selectionAsync;
    if (typeof fn !== "function") return;
    const p = fn();
    if (p && typeof p.catch === "function") {
      p.catch(() => {});
    }
  } catch {}
}
