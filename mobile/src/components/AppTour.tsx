/**
 * Interactive app tour using react-native-copilot.
 * Shows glassmorphic tooltips pointing to actual UI elements.
 * Supports English and Swahili via i18n.
 */

import React, { useEffect, useState } from "react";
import { View, Text, Pressable, Platform } from "react-native";
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
 * Glassmorphic tooltip · uses useCopilot() for state + navigation
 */
function GlassTooltip() {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { t } = useLocale();
  const copilot = useCopilot();
  const { currentStep, goToNext, goToPrev, stop, currentStepNumber, totalStepsNumber, isFirstStep, isLastStep } = copilot;

  const stepIcons: Record<number, string> = {
    1: "wallet",
    2: "bar-chart",
    3: "flash",
    4: "trending-up",
    5: "time",
    6: "menu",
    7: "briefcase",
  };

  const stepColors: Record<number, string> = {
    1: colors.primary[400],
    2: "#A78BFA",
    3: "#F59E0B",
    4: "#3B82F6",
    5: "#EC4899",
    6: "#6366F1",
    7: "#14B8A6",
  };

  const icon = stepIcons[currentStepNumber] || "information-circle";
  const accentColor = stepColors[currentStepNumber] || colors.primary[400];

  return (
    <View
      style={{
        backgroundColor: "rgba(10, 18, 40, 0.92)",
        borderRadius: 24,
        padding: 24,
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
      {/* Header: Icon + Step badge + Skip (top-right per design + user
          feedback that "skip is on top"). Three columns: icon left, step
          badge centred, Skip button hard-right.  */}
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
        <Pressable
          onPress={() => stop()}
          style={({ pressed, hovered }: any) => ({
            paddingVertical: 6,
            paddingHorizontal: 10,
            borderRadius: 8,
            opacity: pressed ? 0.6 : hovered ? 0.9 : 0.8,
            ...(isWeb ? ({ cursor: "pointer" } as any) : {}),
          })}
          accessibilityRole="button"
          accessibilityLabel={t("tour.skipTour")}
        >
          <Text
            style={{
              color: "rgba(255,255,255,0.55)",
              fontSize: 12,
              fontFamily: "DMSans_500Medium",
              letterSpacing: 0.3,
            }}
          >
            {t("tour.skipTour")}
          </Text>
        </Pressable>
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
          color: "rgba(255,255,255,0.6)",
          fontSize: 13.5,
          fontFamily: "DMSans_400Regular",
          lineHeight: 21,
          marginBottom: 20,
        }}
      >
        {currentStep?.text || ""}
      </Text>

      {/* Progress dots */}
      <View
        style={{
          flexDirection: "row",
          gap: 6,
          marginBottom: 16,
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

      {/* Navigation buttons · Skip moved to the header so this row is
          right-aligned (Back + Next/Got it).  */}
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
 * Tour auto-starter · waits for onboarding slides, then starts tour
 */
export function TourAutoStart() {
  const { start, copilotEvents } = useCopilot();
  const startedRef = React.useRef(false);

  const doStart = React.useCallback(async () => {
    if (startedRef.current) return;
    const tourDone = await storage.getItemAsync(TOUR_COMPLETED_KEY);
    if (tourDone === "true") return;
    startedRef.current = true;
    // Small delay for the onboarding modal dismiss animation
    setTimeout(() => {
      try { start(); } catch {}
    }, 800);
  }, [start]);

  // Method 1: Direct trigger from onboarding completion
  useEffect(() => {
    _tourStartCallback = doStart;
    return () => { _tourStartCallback = null; };
  }, [doStart]);

  // Method 2: Fallback · if onboarding was already completed (returning user)
  useEffect(() => {
    (async () => {
      const onboardingDone = await storage.getItemAsync(ONBOARDING_KEY);
      const tourDone = await storage.getItemAsync(TOUR_COMPLETED_KEY);
      if (onboardingDone === "true" && tourDone !== "true") {
        setTimeout(() => doStart(), 1500);
      }
    })();
  }, []); // eslint-disable-line

  // Auto-scroll page when step changes so the target element is visible
  useEffect(() => {
    const handleStepChange = (step: any) => {
      if (isWeb && step) {
        // Scroll the page so the highlighted element is centered
        setTimeout(() => {
          const overlay = document.querySelector('[data-copilot]') as HTMLElement;
          if (overlay) {
            overlay.scrollIntoView({ behavior: "smooth", block: "center" });
          } else {
            // Fallback: scroll by step order
            const scrollY = (step.order - 1) * 300;
            window.scrollTo({ top: Math.max(0, scrollY - 200), behavior: "smooth" });
          }
        }, 100);
      }
    };
    copilotEvents.on("stepChange", handleStepChange);
    return () => { copilotEvents.off("stepChange", handleStepChange); };
  }, [copilotEvents]);

  useEffect(() => {
    const handleStop = () => {
      storage.setItemAsync(TOUR_COMPLETED_KEY, "true");
    };
    copilotEvents.on("stop", handleStop);
    return () => {
      copilotEvents.off("stop", handleStop);
    };
  }, [copilotEvents]);

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
