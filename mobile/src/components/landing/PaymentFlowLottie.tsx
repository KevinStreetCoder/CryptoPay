/**
 * PaymentFlowLottie — plays a Lottie animation exactly ONCE when it
 * scrolls into view, then freezes on its final frame. No looping, no
 * scrubbing, no attempt to "catch the user's eye" a second time.
 *
 * Implementation rules (production):
 *   1. Web-only dependency. `lottie-react` is dynamically imported so
 *      native bundles never touch it. Native renders the fallback image.
 *   2. Triggered by IntersectionObserver at 35% visibility. Disposes
 *      cleanly on unmount.
 *   3. Respects `prefers-reduced-motion`. Users who set that flag see
 *      only the static fallback — never the animation.
 *   4. If the Lottie JSON fails to load (404, CORS, parse error), we
 *      render the fallback silently. Never a broken icon on the page.
 *   5. Target asset size ≤150 KB. The README in mobile/assets/lottie/
 *      pins the three approved sources.
 */

import { useEffect, useRef, useState } from "react";
import { Image, Platform, View, type ImageSourcePropType } from "react-native";

type LottieSource =
  | { uri: string }
  | Record<string, any>; // inline JSON object

type Props = {
  /** Lottie JSON — either a URL or a bundled object. */
  source: LottieSource;
  /** Fallback shown before play, on error, or on prefers-reduced-motion. */
  fallback: ImageSourcePropType;
  /** Playback size in px. Width/height are square-ish by convention. */
  width?: number;
  height?: number;
  /** Viewport ratio that triggers playback. 0.35 = 35% visible. */
  threshold?: number;
  /** ARIA label for screen readers describing what the motion shows. */
  ariaLabel?: string;
};

export function PaymentFlowLottie({
  source,
  fallback,
  width = 320,
  height = 320,
  threshold = 0.35,
  ariaLabel = "Animation showing the payment flow",
}: Props) {
  // Native: serve the static fallback and stop. No runtime cost.
  if (Platform.OS !== "web") {
    return (
      <Image
        source={fallback}
        style={{ width, height }}
        resizeMode="contain"
        accessibilityLabel={ariaLabel}
      />
    );
  }

  const hostRef = useRef<any>(null);
  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [LottieComp, setLottieComp] = useState<any>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // Respect the OS / browser accessibility preference.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const listener = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener?.("change", listener);
    return () => mq.removeEventListener?.("change", listener);
  }, []);

  // IntersectionObserver — fire once, then disconnect.
  useEffect(() => {
    if (reduceMotion) return; // don't even arm the observer
    const node = hostRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true); // SSR / old browsers: play on mount
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            obs.disconnect();
            break;
          }
        }
      },
      { threshold },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [threshold, reduceMotion]);

  // Lazy-load the Lottie library once we know we're going to play.
  // This keeps the initial landing bundle lean — Lottie is ~60 KB
  // gzipped and non-critical for first paint.
  useEffect(() => {
    if (!visible || reduceMotion || LottieComp) return;
    let cancelled = false;
    (async () => {
      try {
        const mod: any = await import(
          /* webpackChunkName: "lottie-react" */ "lottie-react"
        );
        if (!cancelled) setLottieComp(() => mod.default ?? mod.Lottie ?? mod);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, reduceMotion, LottieComp]);

  const shouldRenderLottie = visible && !reduceMotion && !loadFailed && LottieComp;

  return (
    <View ref={hostRef as any} style={{ width, height }}>
      {shouldRenderLottie ? (
        // lottie-react's <Lottie> accepts `animationData` for JSON objects
        // or `path` for URL strings. We normalise here so the caller can
        // pass either shape.
        typeof (source as any).uri === "string" ? (
          <LottieComp
            path={(source as any).uri}
            loop={false}
            autoplay
            style={{ width: "100%", height: "100%" }}
            aria-label={ariaLabel}
            onError={() => setLoadFailed(true)}
          />
        ) : (
          <LottieComp
            animationData={source as any}
            loop={false}
            autoplay
            style={{ width: "100%", height: "100%" }}
            aria-label={ariaLabel}
          />
        )
      ) : (
        <Image
          source={fallback}
          style={{ width: "100%", height: "100%" }}
          resizeMode="contain"
          accessibilityLabel={ariaLabel}
        />
      )}
    </View>
  );
}
