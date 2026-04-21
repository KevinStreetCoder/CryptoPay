import { useEffect } from "react";

/**
 * Prevents screenshots on sensitive screens (balances, PIN entry).
 * Uses expo-screen-capture when available.
 * Falls back to no-op if the module is not installed.
 */
export function useScreenSecurity(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        // Dynamic import to avoid crash if not installed
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ScreenCapture = require("expo-screen-capture");
        if (enabled && ScreenCapture?.preventScreenCaptureAsync) {
          await ScreenCapture.preventScreenCaptureAsync("sensitive-screen");
          cleanup = () => {
            ScreenCapture.allowScreenCaptureAsync?.("sensitive-screen")?.catch?.(() => {});
          };
        }
      } catch {
        // expo-screen-capture not installed · skip silently
      }
    })();

    return () => {
      cleanup?.();
    };
  }, [enabled]);
}
