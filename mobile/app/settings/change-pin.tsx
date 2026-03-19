import { useState, useRef } from "react";
import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Animated,
  ScrollView,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { PinInput } from "../../src/components/PinInput";
import { useToast } from "../../src/components/Toast";
import { authApi } from "../../src/api/auth";
import { normalizeError } from "../../src/utils/apiErrors";
import { useScreenSecurity } from "../../src/hooks/useScreenSecurity";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";

type Step = "current" | "new";

export default function ChangePinScreen() {
  const router = useRouter();
  const toast = useToast();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const [step, setStep] = useState<Step>("current");
  const [currentPin, setCurrentPin] = useState("");
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

  const handleCurrentPinComplete = (pin: string) => {
    setCurrentPin(pin);
    animateTransition("new");
  };

  const handleNewPinComplete = async (newPin: string) => {
    if (newPin === currentPin) {
      setPinError(true);
      toast.warning("Same PIN", "New PIN must be different from your current PIN");
      return;
    }

    setLoading(true);
    setPinError(false);
    try {
      await authApi.changePin({ current_pin: currentPin, new_pin: newPin });
      toast.success("PIN Changed", "Your security PIN has been updated successfully");
      if (router.canGoBack()) router.back();
      else router.replace("/settings" as any);
    } catch (err: unknown) {
      setPinError(true);
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);

      // If current PIN was wrong, go back to current step
      if (appError.statusCode === 400 || appError.statusCode === 403) {
        setCurrentPin("");
        animateTransition("current");
      }
    } finally {
      setLoading(false);
    }
  };

  const stepConfig = {
    current: {
      icon: "lock-closed" as const,
      title: "Enter Current PIN",
      subtitle: "Enter your current 6-digit security PIN",
      onComplete: handleCurrentPinComplete,
    },
    new: {
      icon: "key" as const,
      title: "Enter New PIN",
      subtitle: "Choose a new 6-digit security PIN",
      onComplete: handleNewPinComplete,
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
          borderColor: tc.glass.border,
          maxWidth: 480,
          width: "100%",
          alignSelf: "center",
          ...(isWeb
            ? ({ boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)" } as any)
            : { elevation: 12 }),
        }}
      >
        {/* Header */}
        <View style={{ marginBottom: isDesktop ? 32 : 0 }}>
          {isDesktop && (
            <>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 28,
                  fontFamily: "DMSans_700Bold",
                  letterSpacing: -0.5,
                  marginBottom: 8,
                }}
              >
                {activeStep.title}
              </Text>
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 15,
                  fontFamily: "DMSans_400Regular",
                  lineHeight: 22,
                }}
              >
                {activeStep.subtitle}
              </Text>
            </>
          )}
        </View>

        {/* Step Content */}
        <Animated.View style={{ opacity: fadeAnim }}>
          <View>
            {!isDesktop && (
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
                    color={colors.primary[400]}
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
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  {activeStep.subtitle}
                </Text>
              </View>
            )}

            {/* Step Indicator */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "center",
                gap: 8,
                marginTop: isDesktop ? 8 : 20,
                marginBottom: 24,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: colors.primary[500],
                }}
              />
              <View
                style={{
                  width: 32,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor:
                    step === "new" ? colors.primary[500] : tc.glass.border,
                }}
              />
            </View>

            <View style={{ marginBottom: 8 }}>
              <PinInput
                onComplete={activeStep.onComplete}
                error={pinError}
                testID="change-pin-input"
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
                <ActivityIndicator size="small" color={colors.primary[400]} />
                <Text
                  style={{
                    color: colors.primary[400],
                    fontSize: 14,
                    fontFamily: "DMSans_500Medium",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Updating PIN...
                </Text>
              </View>
            )}

            {/* Back action */}
            <Pressable
              onPress={() => {
                if (step === "new") {
                  setCurrentPin("");
                  animateTransition("current");
                } else {
                  if (router.canGoBack()) router.back();
                  else router.replace("/settings" as any);
                }
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 28,
                paddingVertical: 8,
                opacity: pressed ? 0.9 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
              accessibilityRole="button"
              accessibilityLabel={step === "new" ? "Go back to current PIN" : "Go back"}
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
                {step === "new" ? "Back to current PIN" : "Back to profile"}
              </Text>
            </Pressable>
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

  // Desktop web: centered card layout
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
        {/* Back button header */}
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            paddingHorizontal: 24,
            paddingTop: 24,
            zIndex: 10,
          }}
        >
          <Pressable
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/settings" as any);
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: pressed ? tc.dark.elevated : "transparent",
              alignSelf: "flex-start",
              opacity: pressed ? 0.9 : 1,
            })}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 15,
                fontFamily: "DMSans_500Medium",
              }}
            >
              Back
            </Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1, width: "100%", justifyContent: "center" }}
        >
          {formContent}
        </KeyboardAvoidingView>
      </View>
    );
  }

  // Mobile & tablet: standard centered layout with back header
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      {/* Back button header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/settings" as any);
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 6,
            paddingHorizontal: 8,
            borderRadius: 10,
            backgroundColor: pressed ? tc.dark.elevated : "transparent",
            opacity: pressed ? 0.9 : 1,
          })}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 15,
              fontFamily: "DMSans_500Medium",
            }}
          >
            Back
          </Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {formContent}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
