import { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Animated,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { PinInput } from "../../src/components/PinInput";
import { OTPInput } from "../../src/components/OTPInput";
import { useToast } from "../../src/components/Toast";
import { useAuth } from "../../src/stores/auth";
import { authApi } from "../../src/api/auth";
import { useScreenSecurity } from "../../src/hooks/useScreenSecurity";
import { normalizeError } from "../../src/utils/apiErrors";
import { getThemeColors } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { useLocale } from "../../src/hooks/useLocale";
import { BRAND_LOGOS } from "../../src/constants/logos";

type Step = "phone" | "otp" | "pin" | "confirm_pin" | "success";

const STEPS: Step[] = ["phone", "otp", "pin", "confirm_pin", "success"];
const STEP_LABELS = ["Phone", "Verify", "PIN", "Confirm", "Done"];

function KenyaFlag() {
  return (
    <Image
      source={{ uri: BRAND_LOGOS.kenyaFlag }}
      style={{
        width: 24,
        height: 16,
        borderRadius: 2,
        marginRight: 8,
      }}
      accessibilityLabel="Kenya flag"
    />
  );
}

export default function GoogleCompleteProfileScreen() {
  const router = useRouter();
  const { googleCompleteProfile } = useAuth();
  const toast = useToast();
  const { isDark } = useThemeMode();
  const { t } = useLocale();
  const tc = getThemeColors(isDark);
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [otp, setOtp] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const { width } = useWindowDimensions();

  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;

  const fadeAnim = useRef(new Animated.Value(1)).current;

  useScreenSecurity(step === "pin" || step === "confirm_pin");

  const currentIndex = STEPS.indexOf(step);

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

  const handleSendOTP = async () => {
    if (phone.length < 9) {
      toast.warning("Invalid Number", "Please enter a valid phone number");
      return;
    }
    setLoading(true);
    try {
      await authApi.requestOTP(phone);
      animateTransition("otp");
      toast.success("Code Sent", "Check your SMS for the verification code");
    } catch (err: unknown) {
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOtpComplete = (otpValue: string) => {
    setOtp(otpValue);
    animateTransition("pin");
  };

  const handleFirstPinComplete = (pin: string) => {
    setFirstPin(pin);
    animateTransition("confirm_pin");
  };

  const handleConfirmPinComplete = async (confirmPin: string) => {
    if (confirmPin !== firstPin) {
      setPinError(true);
      toast.warning("PINs Don't Match", t("auth.pinsMismatch"));
      setFirstPin("");
      animateTransition("pin");
      return;
    }

    setLoading(true);
    setPinError(false);
    try {
      await googleCompleteProfile({
        phone,
        otp,
        pin: confirmPin,
        full_name: fullName || undefined,
      });
      animateTransition("success");
    } catch (err: unknown) {
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
      // If OTP is invalid, go back to OTP step
      const errorData = (err as any)?.response?.data;
      if (errorData?.error?.toLowerCase().includes("otp")) {
        setOtp("");
        animateTransition("otp");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoToDashboard = () => {
    router.replace("/(tabs)");
  };

  const isPhoneValid = phone.length >= 9;

  const renderStepIndicator = () => (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 28,
        paddingHorizontal: 8,
      }}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${currentIndex + 1} of ${STEPS.length}`}
      accessibilityValue={{ min: 0, max: STEPS.length, now: currentIndex + 1 }}
    >
      {STEPS.map((s, i) => {
        const isCompleted = currentIndex > i;
        const isCurrent = currentIndex === i;

        return (
          <View key={s} style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ alignItems: "center" }}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: isCompleted
                    ? tc.primary[500]
                    : isCurrent
                    ? "rgba(16, 185, 129, 0.15)"
                    : "rgba(255, 255, 255, 0.06)",
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: isCurrent ? 2 : 0,
                  borderColor: isCurrent ? tc.primary[500] : "transparent",
                }}
              >
                {isCompleted ? (
                  <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                ) : (
                  <Text
                    style={{
                      color: isCurrent ? tc.primary[300] : tc.textMuted,
                      fontSize: 13,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                  >
                    {i + 1}
                  </Text>
                )}
              </View>
              <Text
                style={{
                  color: isCurrent ? tc.primary[300] : tc.textMuted,
                  fontSize: 10,
                  fontFamily: "DMSans_500Medium",
                  marginTop: 4,
                }}
              >
                {STEP_LABELS[i]}
              </Text>
            </View>
            {i < STEPS.length - 1 && (
              <View
                style={{
                  width: 24,
                  height: 2,
                  backgroundColor: isCompleted
                    ? tc.primary[500]
                    : "rgba(255, 255, 255, 0.08)",
                  marginHorizontal: 4,
                  marginBottom: 16,
                  borderRadius: 1,
                }}
              />
            )}
          </View>
        );
      })}
    </View>
  );

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
        <View style={{ alignItems: "center", marginBottom: 8 }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              backgroundColor: "rgba(16, 185, 129, 0.12)",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
            }}
          >
            <Ionicons
              name={
                step === "success"
                  ? "checkmark-circle"
                  : step === "pin" || step === "confirm_pin"
                  ? "key"
                  : step === "otp"
                  ? "shield-checkmark"
                  : "person-add"
              }
              size={28}
              color={step === "success" ? "#10B981" : tc.primary[300]}
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
            {step === "phone"
              ? t("auth.completeProfile")
              : step === "otp"
              ? t("auth.verifyPhone")
              : step === "pin"
              ? t("auth.setYourPin")
              : step === "confirm_pin"
              ? t("auth.confirmYourPin")
              : t("auth.profileComplete")}
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 14,
              fontFamily: "DMSans_400Regular",
              textAlign: "center",
              lineHeight: 20,
              maxWidth: 300,
            }}
            maxFontSizeMultiplier={1.3}
          >
            {step === "phone"
              ? t("auth.completeProfileDesc")
              : step === "otp"
              ? `${t("auth.verifyPhoneDesc")} +254${phone}`
              : step === "pin"
              ? t("auth.setYourPinDesc")
              : step === "confirm_pin"
              ? t("auth.confirmYourPinDesc")
              : t("auth.profileCompleteDesc")}
          </Text>
        </View>

        {step !== "success" && renderStepIndicator()}

        {/* Step Content */}
        <Animated.View style={{ opacity: fadeAnim }}>
          {step === "phone" ? (
            <View>
              {/* Full Name Input */}
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 13,
                  fontFamily: "DMSans_500Medium",
                  marginBottom: 8,
                  marginLeft: 4,
                }}
              >
                {t("auth.fullName")}
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: tc.dark.elevated,
                  borderRadius: 18,
                  borderWidth: 2,
                  borderColor: nameFocused
                    ? "rgba(255, 255, 255, 0.14)"
                    : "rgba(255, 255, 255, 0.08)",
                  paddingHorizontal: 16,
                  marginBottom: 20,
                  ...(isWeb
                    ? ({
                        transition:
                          "border-color 0.2s ease, box-shadow 0.2s ease",
                      } as any)
                    : {}),
                  ...(nameFocused && isWeb
                    ? ({
                        boxShadow:
                          "0 0 0 3px rgba(16, 185, 129, 0.15)",
                      } as any)
                    : {}),
                }}
              >
                <Ionicons
                  name="person-outline"
                  size={20}
                  color={tc.textMuted}
                  style={{ marginRight: 12 }}
                />
                <TextInput
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder={t("auth.enterYourName")}
                  placeholderTextColor={tc.textMuted}
                  autoCapitalize="words"
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                  style={{
                    flex: 1,
                    color: tc.textPrimary,
                    fontSize: 16,
                    fontFamily: "DMSans_400Regular",
                    paddingVertical: 16,
                    ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                  }}
                  accessibilityLabel="Full name"
                  maxFontSizeMultiplier={1.3}
                />
              </View>

              {/* Phone Input */}
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 13,
                  fontFamily: "DMSans_500Medium",
                  marginBottom: 8,
                  marginLeft: 4,
                }}
              >
                {t("auth.phoneNumber")}
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: tc.dark.elevated,
                  borderRadius: 18,
                  borderWidth: 2,
                  borderColor: phoneFocused
                    ? "rgba(255, 255, 255, 0.14)"
                    : "rgba(255, 255, 255, 0.08)",
                  paddingHorizontal: 16,
                  ...(isWeb
                    ? ({
                        transition:
                          "border-color 0.2s ease, box-shadow 0.2s ease",
                      } as any)
                    : {}),
                  ...(phoneFocused && isWeb
                    ? ({
                        boxShadow:
                          "0 0 0 3px rgba(16, 185, 129, 0.15)",
                      } as any)
                    : {}),
                }}
              >
                <KenyaFlag />
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 16,
                    fontFamily: "DMSans_500Medium",
                    marginRight: 10,
                  }}
                >
                  +254
                </Text>
                <View
                  style={{
                    width: 1,
                    height: 24,
                    backgroundColor: tc.dark.border,
                    marginRight: 12,
                  }}
                />
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="712 345 678"
                  placeholderTextColor={tc.textMuted}
                  keyboardType="phone-pad"
                  maxLength={10}
                  onFocus={() => setPhoneFocused(true)}
                  onBlur={() => setPhoneFocused(false)}
                  onSubmitEditing={handleSendOTP}
                  style={{
                    flex: 1,
                    color: tc.textPrimary,
                    fontSize: 16,
                    fontFamily: "DMSans_400Regular",
                    paddingVertical: 16,
                    ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                  }}
                  accessibilityLabel="Phone number"
                  accessibilityHint="Enter your M-Pesa registered phone number"
                  testID="phone-input"
                  maxFontSizeMultiplier={1.3}
                />
              </View>

              {/* Send OTP Button */}
              <Pressable
                onPress={handleSendOTP}
                disabled={!isPhoneValid || loading}
                style={({ pressed, hovered }: any) => ({
                  backgroundColor:
                    isPhoneValid && !loading
                      ? hovered
                        ? tc.primary[400]
                        : tc.primary[500]
                      : "rgba(16, 185, 129, 0.3)",
                  borderRadius: 18,
                  paddingVertical: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 24,
                  minHeight: 56,
                  opacity: !isPhoneValid || loading ? 0.6 : pressed ? 0.9 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                  ...(isWeb
                    ? ({
                        cursor:
                          isPhoneValid && !loading ? "pointer" : "default",
                        transition: "all 0.2s ease",
                      } as any)
                    : {}),
                  ...(isPhoneValid && !loading
                    ? isWeb
                      ? ({
                          boxShadow: hovered
                            ? "0 6px 20px rgba(16, 185, 129, 0.35)"
                            : "0 4px 16px rgba(16, 185, 129, 0.25)",
                        } as any)
                      : { elevation: 8 }
                    : {}),
                })}
                accessibilityRole="button"
                accessibilityLabel={t("auth.sendOtp")}
                accessibilityState={{ disabled: !isPhoneValid || loading }}
                testID="send-otp-button"
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontSize: 17,
                      fontFamily: "DMSans_600SemiBold",
                      letterSpacing: 0.3,
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    {t("auth.sendOtp")}
                  </Text>
                )}
              </Pressable>
            </View>
          ) : step === "otp" ? (
            <View>
              <OTPInput
                length={6}
                onComplete={handleOtpComplete}
                loading={loading}
                title=""
                subtitle=""
                resendLabel={t("auth.resendOtp")}
                onResend={async () => {
                  try {
                    await authApi.requestOTP(phone);
                    toast.success("Code Sent", "A new code has been sent to your phone");
                  } catch (err: unknown) {
                    const appError = normalizeError(err);
                    toast.error(appError.title, appError.message);
                  }
                }}
                resendCooldown={60}
              />

              <Pressable
                onPress={() => animateTransition("phone")}
                style={({ pressed, hovered }: any) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 24,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor:
                    isWeb && hovered ? tc.dark.elevated : "transparent",
                  opacity: pressed ? 0.7 : 1,
                  ...(isWeb
                    ? ({
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      } as any)
                    : {}),
                })}
                accessibilityRole="button"
                accessibilityLabel="Go back to phone number"
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
                  {t("common.back")}
                </Text>
              </Pressable>
            </View>
          ) : step === "pin" ? (
            <View>
              <View style={{ marginBottom: 8 }}>
                <PinInput
                  key="create-pin"
                  onComplete={handleFirstPinComplete}
                  error={pinError}
                  testID="create-pin-input"
                />
              </View>
            </View>
          ) : step === "confirm_pin" ? (
            <View>
              <View style={{ marginBottom: 8 }}>
                <PinInput
                  key={`confirm-pin-${firstPin}`}
                  onComplete={handleConfirmPinComplete}
                  error={pinError}
                  testID="confirm-pin-input"
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
                    Setting up your account...
                  </Text>
                </View>
              )}

              <Pressable
                onPress={() => {
                  setFirstPin("");
                  animateTransition("pin");
                }}
                style={({ pressed, hovered }: any) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 24,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor:
                    isWeb && hovered ? tc.dark.elevated : "transparent",
                  opacity: pressed ? 0.7 : 1,
                  ...(isWeb
                    ? ({
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      } as any)
                    : {}),
                })}
                accessibilityRole="button"
                accessibilityLabel="Re-enter PIN"
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
            </View>
          ) : (
            /* Success Step */
            <View style={{ alignItems: "center" }}>
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 40,
                  backgroundColor: "rgba(16, 185, 129, 0.12)",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 20,
                }}
              >
                <Ionicons name="checkmark-circle" size={48} color="#10B981" />
              </View>

              <Pressable
                onPress={handleGoToDashboard}
                style={({ pressed, hovered }: any) => ({
                  backgroundColor: hovered
                    ? tc.primary[400]
                    : tc.primary[500],
                  borderRadius: 18,
                  paddingVertical: 16,
                  paddingHorizontal: 48,
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 16,
                  minHeight: 56,
                  maxWidth: 360,
                  width: "100%",
                  opacity: pressed ? 0.9 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                  ...(isWeb
                    ? ({
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        boxShadow: hovered
                          ? "0 6px 20px rgba(16, 185, 129, 0.35)"
                          : "0 4px 16px rgba(16, 185, 129, 0.25)",
                      } as any)
                    : { elevation: 8 }),
                })}
                accessibilityRole="button"
                accessibilityLabel={t("auth.goToDashboard")}
                testID="go-to-dashboard-button"
              >
                <Text
                  style={{
                    color: "#FFFFFF",
                    fontSize: 17,
                    fontFamily: "DMSans_600SemiBold",
                    letterSpacing: 0.3,
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  {t("auth.goToDashboard")}
                </Text>
              </Pressable>
            </View>
          )}
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
