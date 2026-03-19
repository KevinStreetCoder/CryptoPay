import { useState, useRef } from "react";
import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Animated,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { PinInput } from "../../src/components/PinInput";
import { useToast } from "../../src/components/Toast";
import { authApi } from "../../src/api/auth";
import { normalizeError } from "../../src/utils/apiErrors";
import { useScreenSecurity } from "../../src/hooks/useScreenSecurity";
import { getThemeColors } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";

type Step = "enter" | "confirm";

export default function SetInitialPinScreen() {
  const router = useRouter();
  const toast = useToast();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const [step, setStep] = useState<Step>("enter");
  const [firstPin, setFirstPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [pinError, setPinError] = useState(false);
  const { width } = useWindowDimensions();

  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;

  const fadeAnim = useRef(new Animated.Value(1)).current;

  useScreenSecurity(true);

  const animateTransition = (nextStep: Step) => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: Platform.OS !== "web",
    }).start(() => {
      setStep(nextStep);
      setPinError(false);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: Platform.OS !== "web",
      }).start();
    });
  };

  const handleFirstPinComplete = (pin: string) => {
    setFirstPin(pin);
    animateTransition("confirm");
  };

  const handleConfirmPinComplete = async (confirmPin: string) => {
    if (confirmPin !== firstPin) {
      setPinError(true);
      toast.warning("PINs Don't Match", "The PINs you entered don't match. Please try again.");
      setFirstPin("");
      animateTransition("enter");
      return;
    }

    setLoading(true);
    setPinError(false);
    try {
      await authApi.setInitialPin(confirmPin);
      toast.success("PIN Set", "Your security PIN has been set successfully.");
      router.replace("/(tabs)");
    } catch (err: unknown) {
      setPinError(true);
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setLoading(false);
    }
  };

  const stepConfig = {
    enter: {
      icon: "key" as const,
      title: "Create Your PIN",
      subtitle: "Choose a 6-digit security PIN to protect your account",
      onComplete: handleFirstPinComplete,
    },
    confirm: {
      icon: "shield-checkmark" as const,
      title: "Confirm Your PIN",
      subtitle: "Re-enter your 6-digit PIN to confirm",
      onComplete: handleConfirmPinComplete,
    },
  };

  const activeStep = stepConfig[step];

  const formContent = (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        paddingHorizontal: isDesktop ? 48 : 24,
        paddingVertical: 40,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Card Container */}
      <View
        style={{
          backgroundColor: tc.dark.card,
          borderRadius: 24,
          padding: isDesktop ? 40 : 32,
          borderWidth: 1,
          borderColor: "rgba(255, 255, 255, 0.08)",
          maxWidth: 480,
          width: "100%",
          alignSelf: "center",
          ...(isWeb
            ? ({ boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)" } as any)
            : { elevation: 12 }),
        }}
      >
        {/* Header */}
        <Animated.View style={{ opacity: fadeAnim }}>
          <View>
            <View style={{ alignItems: "center", marginBottom: 8 }}>
              <View
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 18,
                  backgroundColor: "rgba(16, 185, 129, 0.12)",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                }}
              >
                <Ionicons
                  name={activeStep.icon}
                  size={28}
                  color={tc.primary[300]}
                />
              </View>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 21,
                  fontFamily: "DMSans_600SemiBold",
                  marginBottom: 6,
                  textAlign: "center",
                }}
                maxFontSizeMultiplier={1.3}
              >
                {activeStep.title}
              </Text>
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 14,
                  fontFamily: "DMSans_400Regular",
                  textAlign: "center",
                  lineHeight: 20,
                  maxWidth: 280,
                }}
                maxFontSizeMultiplier={1.3}
              >
                {activeStep.subtitle}
              </Text>
            </View>

            {/* Step Indicator */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "center",
                gap: 8,
                marginTop: 20,
                marginBottom: 24,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: tc.primary[500],
                }}
              />
              <View
                style={{
                  width: 32,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor:
                    step === "confirm" ? tc.primary[500] : "rgba(255, 255, 255, 0.08)",
                }}
              />
            </View>

            <View style={{ marginBottom: 8 }}>
              <PinInput
                onComplete={activeStep.onComplete}
                error={pinError}
                testID="set-initial-pin-input"
              />
            </View>

            {loading && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 20,
                  gap: 8,
                }}
              >
                <ActivityIndicator size="small" color={tc.primary[400]} />
                <Text
                  style={{
                    color: tc.primary[400],
                    fontSize: 14,
                    fontFamily: "DMSans_500Medium",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Setting PIN...
                </Text>
              </View>
            )}

            {/* Back action (only on confirm step) */}
            {step === "confirm" && (
              <Pressable
                onPress={() => {
                  setFirstPin("");
                  animateTransition("enter");
                }}
                style={({ pressed, hovered }: any) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 28,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: isWeb && hovered ? tc.dark.elevated : "transparent",
                  opacity: pressed ? 0.7 : 1,
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                })}
                accessibilityRole="button"
                accessibilityLabel="Go back to enter PIN"
              >
                <Ionicons
                  name="arrow-back"
                  size={16}
                  color={tc.textMuted}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 14,
                    fontFamily: "DMSans_500Medium",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Re-enter PIN
                </Text>
              </Pressable>
            )}
          </View>
        </Animated.View>
      </View>

      {/* Trust Indicator */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 28,
          gap: 8,
        }}
      >
        <Ionicons name="shield-checkmark" size={16} color={tc.textMuted} />
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 12,
            fontFamily: "DMSans_400Regular",
          }}
          maxFontSizeMultiplier={1.3}
        >
          Secured with 256-bit encryption
        </Text>
      </View>
    </ScrollView>
  );

  if (isDesktop) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: tc.dark.bg,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1, width: "100%", justifyContent: "center" }}
        >
          {formContent}
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {formContent}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
