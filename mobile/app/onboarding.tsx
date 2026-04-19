/**
 * OnboardingModal — 3-slide introduction, shown once after first login.
 *
 * Uses the brand OnboardingSlide component (ported from design handoff).
 * Slides: WELCOME → HOW IT WORKS → RATE LOCK.
 *
 * Exports:
 *   - OnboardingModal (used by _layout.tsx)
 *   - ONBOARDING_COMPLETED_KEY (storage flag)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Modal,
  Animated,
  useWindowDimensions,
  Platform,
  Pressable,
  Text,
} from "react-native";
import { storage } from "../src/utils/storage";
import { OnboardingSlide } from "../src/components/brand/OnboardingSlide";
import { useLocale } from "../src/hooks/useLocale";
import { Ionicons } from "@expo/vector-icons";

export const ONBOARDING_COMPLETED_KEY = "cryptopay_onboarding_completed";

const STEPS = [1, 2, 3] as const;

export function OnboardingModal({
  visible,
  onComplete,
}: {
  visible: boolean;
  onComplete: () => void;
}) {
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= 768;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { locale, setLocale, t } = useLocale();

  useEffect(() => {
    if (visible) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 240,
        useNativeDriver: true,
      }).start();
      setStep(1);
    } else {
      fadeAnim.setValue(0);
    }
  }, [visible]);

  const finish = useCallback(async () => {
    await storage.setItemAsync(ONBOARDING_COMPLETED_KEY, "true");
    onComplete();
  }, [onComplete]);

  const next = useCallback(() => {
    if (step < 3) setStep(((step + 1) as 1 | 2 | 3));
    else finish();
  }, [step, finish]);

  if (!visible) return null;

  const Overlay = (
    <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      {/* Language toggle — top-left */}
      <Pressable
        onPress={() => setLocale(locale === "en" ? "sw" : "en")}
        style={{
          position: "absolute",
          top: 20,
          left: 24,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          backgroundColor: "rgba(22,39,66,0.55)",
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.1)",
          zIndex: 10,
        }}
      >
        <Ionicons name="language-outline" size={14} color="#8396AD" />
        <Text style={{ color: "#E8EEF7", fontSize: 11, fontFamily: "DMSans_600SemiBold" }}>
          {locale === "en" ? "SW" : "EN"}
        </Text>
      </Pressable>

      <OnboardingSlide step={step} onContinue={next} onSkip={finish} />
    </Animated.View>
  );

  // Desktop: center a phone-sized card on a backdrop.
  if (isDesktop) {
    return (
      <Modal visible={visible} animationType="fade" transparent statusBarTranslucent>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.82)",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              width: 400,
              maxWidth: "100%" as any,
              height: 720,
              maxHeight: "92%" as any,
              borderRadius: 28,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",
              ...(Platform.OS === "web"
                ? ({ boxShadow: "0 30px 90px rgba(0,0,0,0.6), 0 0 36px rgba(16,185,129,0.15)" } as any)
                : {}),
            }}
          >
            {Overlay}
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#060E1F" }}>{Overlay}</View>
    </Modal>
  );
}
