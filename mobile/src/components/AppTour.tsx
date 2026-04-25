/**
 * Interactive app tour using react-native-copilot.
 *
 * Renders glassmorphic tooltips pointing to actual UI elements, with
 * multiple safety nets so users can NEVER get permanently stuck:
 *
 *   1. Prominent Skip pill in the tooltip header (large, red accent,
 *      always rendered first in the layout so it survives even if the
 *      tooltip is partially clipped).
 *   2. Android hardware-back-button handler (back-press exits tour).
 *   3. 15-second watchdog · if the tour is visible and no `stepChange`
 *      or user interaction fires for 15 s, force-stop. Catches the
 *      "tooltip rendered below the viewport" trap users hit on small
 *      phones with long-scroll Home screens.
 *   4. Step-target validation · on every `stepChange` we measure the
 *      target's on-screen rect; if it has zero size or measures
 *      off-screen we auto-advance (or stop on the last step).
 *   5. Auto-scroll · screens register their primary `ScrollView` ref
 *      via `registerTourScrollView`; on each `stepChange` we scroll
 *      the new target into view (~120 px from the top) so the tooltip
 *      lands on visible content.
 *
 * Together these eliminate the "kill the APK to recover" bug reported
 * 2026-04-25 where step 9 (Recent Transactions, near the bottom of the
 * Home ScrollView) rendered its tooltip below the visible viewport.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Platform,
  BackHandler,
  type ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  CopilotProvider,
  CopilotStep,
  useCopilot,
  walkthroughable,
} from "react-native-copilot";
import { storage } from "../utils/storage";
import { colors, getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";
import { useLocale } from "../hooks/useLocale";

const isWeb = Platform.OS === "web";
const TOUR_COMPLETED_KEY = "cryptopay_app_tour_completed";
const ONBOARDING_KEY = "cryptopay_onboarding_completed";

export const WalkthroughableView = walkthroughable(View);

// Simple event to signal tour should start (fired when onboarding completes)
let _tourStartCallback: (() => void) | null = null;
export function triggerAppTour() {
  if (_tourStartCallback) _tourStartCallback();
}

/**
 * Scroll-view registry · screens that contain TourStep targets register
 * their primary ScrollView so the tour can scroll the target into view
 * before each step. Replaces the previous web-only `scrollIntoView`
 * fallback that left native users stuck when a target sat below the fold.
 */
let _registeredScrollViewRef: ScrollView | null = null;
export function registerTourScrollView(ref: ScrollView | null) {
  _registeredScrollViewRef = ref;
}

/**
 * Glassmorphic tooltip · uses useCopilot() for state + navigation.
 *
 * Layout order (top→bottom): Skip pill (header-right), step badge
 * (centred), icon (left), title, body, progress dots, Back / Next.
 * The Skip pill is rendered FIRST in the JSX so React Native's flex
 * layout always allocates space for it even when the parent tooltip
 * is partially clipped by the viewport.
 */
function GlassTooltip() {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { t } = useLocale();
  const copilot = useCopilot();
  const {
    currentStep,
    goToNext,
    goToPrev,
    stop,
    currentStepNumber,
    totalStepsNumber,
    isFirstStep,
    isLastStep,
  } = copilot;

  const stepIcons: Record<number, string> = {
    1: "wallet",
    2: "bar-chart",
    3: "flash",
    4: "trending-up",
    5: "time",
    6: "menu",
    7: "briefcase",
    8: "stats-chart",
    9: "list",
  };

  const stepColors: Record<number, string> = {
    1: colors.primary[400],
    2: "#A78BFA",
    3: "#F59E0B",
    4: "#3B82F6",
    5: "#EC4899",
    6: "#6366F1",
    7: "#14B8A6",
    8: "#22D3EE",
    9: "#8B5CF6",
  };

  const icon = stepIcons[currentStepNumber] || "information-circle";
  const accentColor = stepColors[currentStepNumber] || colors.primary[400];

  // Skip uses a warning-orange accent so it reads as "exit/stop"
  // rather than another primary action. Brighter than the previous
  // 55 %-opacity white text that users reported missing on bright
  // backdrops.
  const SKIP_COLOR = "#F97316";

  return (
    <View
      style={{
        backgroundColor: "rgba(10, 18, 40, 0.94)",
        borderRadius: 24,
        padding: 22,
        paddingTop: 18,
        maxWidth: 360,
        minWidth: 290,
        borderWidth: 1.5,
        borderColor: accentColor + "25",
        ...(isWeb
          ? ({
              boxShadow: `0 20px 60px rgba(0,0,0,0.6), 0 0 80px ${accentColor}12, 0 0 0 1px ${accentColor}10, inset 0 1px 0 rgba(255,255,255,0.06)`,
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              transform: "translateY(-4px)",
            } as any)
          : {}),
      }}
    >
      {/* Header: Skip pill on the FIRST row by itself · highly
          visible orange pill so users always see an exit. Drops
          below the icon row so even a partially clipped tooltip
          still renders Skip on the first visible line. */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "flex-end",
          marginBottom: 10,
        }}
      >
        <Pressable
          onPress={() => stop()}
          style={({ pressed, hovered }: any) => ({
            paddingVertical: 7,
            paddingHorizontal: 14,
            borderRadius: 999,
            backgroundColor: pressed
              ? SKIP_COLOR + "40"
              : hovered
              ? SKIP_COLOR + "28"
              : SKIP_COLOR + "1A",
            borderWidth: 1,
            borderColor: SKIP_COLOR + "55",
            flexDirection: "row" as const,
            alignItems: "center" as const,
            gap: 6,
            ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
          })}
          accessibilityRole="button"
          accessibilityLabel={t("tour.skipTour")}
          hitSlop={10}
          testID="tour-skip-button"
        >
          <Ionicons name="close" size={13} color={SKIP_COLOR} />
          <Text
            style={{
              color: SKIP_COLOR,
              fontSize: 12,
              fontFamily: "DMSans_600SemiBold",
              letterSpacing: 0.3,
            }}
          >
            {t("tour.skipTour")}
          </Text>
        </Pressable>
      </View>

      {/* Icon + step-of-N badge */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          gap: 8,
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            backgroundColor: accentColor + "15",
            borderWidth: 1,
            borderColor: accentColor + "20",
            alignItems: "center",
            justifyContent: "center",
            ...(isWeb ? ({ boxShadow: `0 0 20px ${accentColor}20` } as any) : {}),
          }}
        >
          <Ionicons name={icon as any} size={22} color={accentColor} />
        </View>
        <View
          style={{
            backgroundColor: accentColor + "12",
            borderRadius: 20,
            paddingHorizontal: 12,
            paddingVertical: 5,
            borderWidth: 1,
            borderColor: accentColor + "20",
          }}
        >
          <Text
            style={{
              color: accentColor,
              fontSize: 11,
              fontFamily: "DMSans_600SemiBold",
              letterSpacing: 0.3,
            }}
          >
            {t("tour.stepOf")
              .replace("{step}", String(currentStepNumber))
              .replace("{total}", String(totalStepsNumber))}
          </Text>
        </View>
      </View>

      {/* Title */}
      <Text
        style={{
          color: "#FFFFFF",
          fontSize: 19,
          fontFamily: "DMSans_700Bold",
          marginBottom: 8,
          letterSpacing: -0.3,
        }}
      >
        {currentStep?.name || ""}
      </Text>

      {/* Description */}
      <Text
        style={{
          color: "rgba(255,255,255,0.65)",
          fontSize: 13.5,
          fontFamily: "DMSans_400Regular",
          lineHeight: 21,
          marginBottom: 18,
        }}
      >
        {currentStep?.text || ""}
      </Text>

      {/* Progress dots */}
      <View
        style={{
          flexDirection: "row",
          gap: 6,
          marginBottom: 14,
          justifyContent: "center",
        }}
      >
        {Array.from({ length: totalStepsNumber }).map((_, i) => (
          <View
            key={i}
            style={{
              width: i + 1 === currentStepNumber ? 20 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor:
                i + 1 === currentStepNumber
                  ? accentColor
                  : "rgba(255,255,255,0.15)",
              ...(isWeb && i + 1 === currentStepNumber
                ? ({ transition: "width 0.3s ease" } as any)
                : {}),
            }}
          />
        ))}
      </View>

      {/* Back + Next */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        <View style={{ flexDirection: "row", gap: 8 }}>
          {!isFirstStep && (
            <Pressable
              onPress={() => goToPrev()}
              style={({ pressed }) => ({
                paddingVertical: 10,
                paddingHorizontal: 18,
                borderRadius: 12,
                backgroundColor: "rgba(255,255,255,0.08)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.1)",
                opacity: pressed ? 0.7 : 1,
                ...(isWeb
                  ? ({ transition: "all 0.15s ease", cursor: "pointer" } as any)
                  : {}),
              })}
            >
              <Text
                style={{
                  color: "rgba(255,255,255,0.7)",
                  fontSize: 13,
                  fontFamily: "DMSans_500Medium",
                }}
              >
                {t("tour.back")}
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => (isLastStep ? stop() : goToNext())}
            style={({ pressed, hovered }: any) => ({
              flexDirection: "row" as const,
              alignItems: "center" as const,
              gap: 6,
              paddingVertical: 10,
              paddingHorizontal: 22,
              borderRadius: 14,
              backgroundColor: hovered ? accentColor : accentColor + "E6",
              opacity: pressed ? 0.85 : 1,
              ...(isWeb
                ? ({
                    transition: "all 0.2s ease",
                    cursor: "pointer",
                    boxShadow: `0 6px 20px ${accentColor}35`,
                  } as any)
                : {}),
            })}
          >
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 13,
                fontFamily: "DMSans_600SemiBold",
              }}
            >
              {isLastStep ? t("tour.gotIt") : t("tour.next")}
            </Text>
            <Ionicons
              name={isLastStep ? "checkmark" : "arrow-forward"}
              size={14}
              color="#FFFFFF"
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * Tour step wrapper · accepts i18n keys and translates automatically
 */
export function TourStep({
  nameKey,
  textKey,
  name,
  text,
  order,
  children,
}: {
  nameKey?: string;
  textKey?: string;
  name?: string;
  text?: string;
  order: number;
  children: React.ReactNode;
}) {
  const { t } = useLocale();
  const resolvedName = nameKey ? t(nameKey) : name || "";
  const resolvedText = textKey ? t(textKey) : text || "";

  return (
    <CopilotStep name={resolvedName} text={resolvedText} order={order}>
      <WalkthroughableView>
        {children}
      </WalkthroughableView>
    </CopilotStep>
  );
}

/**
 * Tour auto-starter · waits for onboarding slides, then starts tour.
 *
 * Mounts five `useEffect`s:
 *   1. Subscribe to the global `triggerAppTour()` callback.
 *   2. Fallback auto-start for returning users (onboarding done, tour not).
 *   3. Auto-scroll the target into view on each `stepChange`
 *      (works on both web `scrollIntoView` and native `scrollTo`).
 *   4. Validate target measurement after a brief settle delay; if the
 *      target measures to zero size or off-screen, auto-advance.
 *   5. Persist `tourCompleted=true` on the `stop` event so we don't
 *      re-trigger on every launch.
 *   6. Watchdog · 15 s timer reset on every step transition; fires
 *      `stop()` if the user appears stuck.
 *   7. Android `BackHandler` · hardware back press during tour exits.
 */
export function TourAutoStart() {
  const { start, stop, goToNext, copilotEvents, visible, currentStep } = useCopilot();
  const startedRef = useRef(false);
  const lastStepAtRef = useRef<number>(0);

  const doStart = useCallback(async () => {
    if (startedRef.current) return;
    const tourDone = await storage.getItemAsync(TOUR_COMPLETED_KEY);
    if (tourDone === "true") return;
    startedRef.current = true;
    // Small delay for the onboarding modal dismiss animation
    setTimeout(() => {
      try { start(); } catch {}
    }, 800);
  }, [start]);

  // Method 1 · direct trigger from onboarding completion
  useEffect(() => {
    _tourStartCallback = doStart;
    return () => { _tourStartCallback = null; };
  }, [doStart]);

  // Method 2 · fallback if onboarding was already completed (returning user)
  useEffect(() => {
    (async () => {
      const onboardingDone = await storage.getItemAsync(ONBOARDING_KEY);
      const tourDone = await storage.getItemAsync(TOUR_COMPLETED_KEY);
      if (onboardingDone === "true" && tourDone !== "true") {
        setTimeout(() => doStart(), 1500);
      }
    })();
  }, []); // eslint-disable-line

  // Auto-scroll target into view on every step change · web uses
  // DOM scrollIntoView (existing behaviour), native uses the scroll
  // ref registered via `registerTourScrollView`. Without this the
  // tooltip can land below the visible viewport on small phones,
  // which is what trapped users on the Recent Transactions step.
  useEffect(() => {
    const handleStepChange = (step: any) => {
      lastStepAtRef.current = Date.now();

      if (isWeb) {
        setTimeout(() => {
          const overlay = document.querySelector("[data-copilot]") as HTMLElement | null;
          if (overlay) {
            overlay.scrollIntoView({ behavior: "smooth", block: "center" });
          } else {
            const scrollY = (step.order - 1) * 300;
            window.scrollTo({ top: Math.max(0, scrollY - 200), behavior: "smooth" });
          }
        }, 100);
        return;
      }

      // Native · measure the target wrapper and scroll the registered
      // ScrollView so the target sits ~120 px from the top edge.
      const wrapper = step?.wrapper?.current;
      if (!wrapper || typeof wrapper.measureInWindow !== "function") return;
      try {
        wrapper.measureInWindow((_x: number, y: number, _w: number, h: number) => {
          if (
            !_registeredScrollViewRef ||
            typeof (_registeredScrollViewRef as any).scrollTo !== "function"
          ) return;
          // Skip the scroll if the target is already comfortably in view
          if (y > 80 && y + h < 600) return;
          (_registeredScrollViewRef as any).scrollTo({
            y: Math.max(0, y - 120),
            animated: true,
          });
        });
      } catch {
        // measure can throw if the ref was unmounted · safe to ignore
      }
    };
    copilotEvents.on("stepChange", handleStepChange);
    return () => { copilotEvents.off("stepChange", handleStepChange); };
  }, [copilotEvents]);

  // Step-target validation · 800 ms after every step change, verify
  // the target rendered with non-zero size. If it didn't (target
  // unmounted, conditional render hid it, etc.) auto-advance so the
  // user isn't pinned to an invisible tooltip.
  useEffect(() => {
    if (!visible || !currentStep) return;
    const timer = setTimeout(() => {
      const wrapper: any = (currentStep as any)?.wrapper?.current;
      if (!wrapper || typeof wrapper.measureInWindow !== "function") return;
      wrapper.measureInWindow((_x: number, _y: number, w: number, h: number) => {
        if (!w || !h) {
          try { goToNext(); } catch { try { stop(); } catch {} }
        }
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [visible, currentStep, goToNext, stop]);

  // Persist completion on stop
  useEffect(() => {
    const handleStop = () => {
      storage.setItemAsync(TOUR_COMPLETED_KEY, "true");
    };
    copilotEvents.on("stop", handleStop);
    return () => { copilotEvents.off("stop", handleStop); };
  }, [copilotEvents]);

  // Watchdog · if the tour stays visible without a `stepChange` for
  // 15 s, force-stop. Catches edge cases where the tooltip clips off-
  // screen, the Skip pill is hidden behind a status bar, etc.
  useEffect(() => {
    if (!visible) return;
    lastStepAtRef.current = Date.now();
    const interval = setInterval(() => {
      const idleMs = Date.now() - lastStepAtRef.current;
      if (idleMs > 15000) {
        try { stop(); } catch {}
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [visible, stop]);

  // Android hardware back · pressing back during the tour stops it
  // (matches the user's mental model that "back" always escapes).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (visible) {
        try { stop(); } catch {}
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [visible, stop]);

  return null;
}

/**
 * Provider wrapping content with CopilotProvider + glassmorphic tooltip
 */
export function AppTourProvider({ children }: { children: React.ReactNode }) {
  return (
    <CopilotProvider
      tooltipComponent={GlassTooltip}
      stepNumberComponent={() => null}
      overlay="view"
      animated
      // Opaque dim so we never see the underlying Modal's white
      // default background · react-native-copilot renders inside a
      // Modal whose root View has no bg, so on Android the backdrop
      // with low opacity let the native white Modal BG bleed through
      // above the tooltip (the "white frame" seen on-device).
      backdropColor="rgba(2, 6, 18, 0.96)"
      arrowColor="rgba(16, 185, 129, 0.25)"
      verticalOffset={0}
      margin={8}
      // Extend the backdrop under the Android status bar so the
      // full screen dims uniformly (without this the status-bar
      // strip stays bright, producing a visible border at the top).
      androidStatusBarVisible={false}
    >
      {children}
    </CopilotProvider>
  );
}
