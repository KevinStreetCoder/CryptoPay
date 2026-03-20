import { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Platform,
  Pressable,
  Animated,
  useWindowDimensions,
  KeyboardAvoidingView,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { PinInput } from "../../src/components/PinInput";
import { OTPInput } from "../../src/components/OTPInput";
import { useToast } from "../../src/components/Toast";
import { getThemeColors } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { BRAND_LOGOS } from "../../src/constants/logos";
import { api } from "../../src/api/client";

type Step = "phone" | "otp" | "new-pin" | "confirm-pin" | "success";

function KenyaFlag() {
  return (
    <Image
      source={{ uri: BRAND_LOGOS.kenyaFlag }}
      style={{ width: 24, height: 16, borderRadius: 2, marginRight: 8 }}
      accessibilityLabel="Kenya flag"
    />
  );
}

export default function ForgotPINScreen() {
  const router = useRouter();
  const toast = useToast();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [pinError, setPinError] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [useEmail, setUseEmail] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;

  const animateTransition = (nextStep: Step) => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: Platform.OS !== "web",
    }).start(() => {
      setStep(nextStep);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: Platform.OS !== "web",
      }).start();
    });
  };

  const normalizedPhone = () => {
    let p = phone.trim().replace(/\s/g, "");
    if (p.startsWith("0")) p = "+254" + p.slice(1);
    else if (p.startsWith("254")) p = "+" + p;
    else if (!p.startsWith("+")) p = "+254" + p;
    return p;
  };

  const handleRequestOTP = async () => {
    if (phone.length < 9) {
      toast.warning("Invalid Number", "Please enter a valid phone number");
      return;
    }
    setLoading(true);
    try {
      const payload: any = { phone: normalizedPhone() };
      if (useEmail) payload.email = true;
      const res = await api.post("/auth/forgot-pin/", payload);
      const channel = res.data.channel === "email" ? "email" : "phone";
      toast.success("Code Sent", `Check your ${channel} for the verification code`);
      if (res.data.dev_otp) {
        toast.info("Dev OTP", res.data.dev_otp);
      }
      animateTransition("otp");
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Failed to send code. Try again.";
      toast.error("Error", msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (otp: string) => {
    setLoading(true);
    try {
      const res = await api.post("/auth/forgot-pin/verify/", {
        phone: normalizedPhone(),
        otp,
      });
      setResetToken(res.data.reset_token);
      toast.success("Verified", "Enter your new PIN");
      animateTransition("new-pin");
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Invalid or expired code";
      toast.error("Verification Failed", msg);
    } finally {
      setLoading(false);
    }
  };

  const handleNewPin = (pin: string) => {
    setNewPin(pin);
    setPinError(false);
    animateTransition("confirm-pin");
  };

  const handleConfirmPin = async (pin: string) => {
    if (pin !== newPin) {
      setPinError(true);
      toast.error("Mismatch", "PINs do not match. Try again.");
      return;
    }
    setLoading(true);
    setPinError(false);
    try {
      await api.post("/auth/reset-pin/", {
        token: resetToken,
        new_pin: pin,
      });
      animateTransition("success");
    } catch (err: any) {
      setPinError(true);
      const msg = err?.response?.data?.error || "Failed to reset PIN";
      toast.error("Error", msg);
    } finally {
      setLoading(false);
    }
  };

  const isPhoneValid = phone.length >= 9;

  const stepConfig: Record<Step, { icon: string; title: string; subtitle: string }> = {
    phone: {
      icon: "key-outline",
      title: "Reset your PIN",
      subtitle: "Enter the phone number linked to your account. We'll send a verification code.",
    },
    otp: {
      icon: "shield-checkmark-outline",
      title: "Verify your identity",
      subtitle: useEmail
        ? "Enter the 6-digit code sent to your email."
        : "Enter the 6-digit code sent to your phone.",
    },
    "new-pin": {
      icon: "lock-closed-outline",
      title: "Create new PIN",
      subtitle: "Choose a new 6-digit PIN for your account.",
    },
    "confirm-pin": {
      icon: "lock-closed-outline",
      title: "Confirm new PIN",
      subtitle: "Re-enter your new 6-digit PIN to confirm.",
    },
    success: {
      icon: "checkmark-circle",
      title: "PIN Reset Complete",
      subtitle: "Your PIN has been reset successfully. You can now sign in with your new PIN.",
    },
  };

  const current = stepConfig[step];

  const content = (
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
            ? ({
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.3,
                shadowRadius: 24,
              } as any)
            : { elevation: 12 }),
        }}
      >
        {/* Header */}
        <View style={{ alignItems: "center", marginBottom: 28 }}>
          <View
            style={{
              width: 60,
              height: 60,
              borderRadius: 18,
              backgroundColor: step === "success"
                ? "rgba(16, 185, 129, 0.15)"
                : "rgba(16, 185, 129, 0.12)",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Ionicons
              name={current.icon as any}
              size={28}
              color={step === "success" ? "#10B981" : tc.primary[300]}
            />
          </View>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 22,
              fontFamily: "DMSans_700Bold",
              marginBottom: 8,
              textAlign: "center",
              letterSpacing: -0.3,
            }}
            maxFontSizeMultiplier={1.3}
          >
            {current.title}
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 14,
              fontFamily: "DMSans_400Regular",
              lineHeight: 20,
              textAlign: "center",
              maxWidth: 300,
            }}
            maxFontSizeMultiplier={1.3}
          >
            {current.subtitle}
          </Text>
        </View>

        {/* Step Content */}
        <Animated.View style={{ opacity: fadeAnim }}>
          {step === "phone" && (
            <View>
              {/* Phone Input */}
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
                  ...(isWeb ? { transition: "border-color 0.2s ease, box-shadow 0.2s ease" } as any : {}),
                  ...(phoneFocused && isWeb ? { boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.15)" } as any : {}),
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
                  autoFocus={Platform.OS === "web"}
                  onFocus={Platform.OS === "web" ? () => setPhoneFocused(true) : undefined}
                  onBlur={Platform.OS === "web" ? () => setPhoneFocused(false) : undefined}
                  onSubmitEditing={handleRequestOTP}
                  style={{
                    flex: 1,
                    color: tc.textPrimary,
                    fontSize: 16,
                    fontFamily: "DMSans_400Regular",
                    paddingVertical: 16,
                    ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                  }}
                  accessibilityLabel="Phone number"
                  testID="forgot-pin-phone"
                  maxFontSizeMultiplier={1.3}
                />
              </View>

              {/* Use email instead toggle */}
              <Pressable
                onPress={() => setUseEmail(!useEmail)}
                style={({ pressed, hovered }: any) => ({
                  alignItems: "center",
                  marginTop: 16,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: isWeb && hovered ? "rgba(16, 185, 129, 0.06)" : "transparent",
                  opacity: pressed ? 0.7 : 1,
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                })}
                accessibilityRole="button"
              >
                <Text
                  style={{
                    color: tc.primary[300],
                    fontSize: 14,
                    fontFamily: "DMSans_500Medium",
                  }}
                >
                  {useEmail ? "Use SMS instead" : "Verify via email"}
                </Text>
              </Pressable>

              {/* Send Code Button */}
              <Pressable
                onPress={handleRequestOTP}
                disabled={!isPhoneValid || loading}
                style={({ pressed, hovered }: any) => ({
                  backgroundColor: isPhoneValid
                    ? hovered ? tc.primary[400] : tc.primary[500]
                    : "rgba(16, 185, 129, 0.3)",
                  borderRadius: 18,
                  paddingVertical: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 8,
                  marginTop: 16,
                  minHeight: 56,
                  opacity: !isPhoneValid || loading ? 0.6 : pressed ? 0.9 : 1,
                  ...(isWeb ? { cursor: isPhoneValid ? "pointer" : "default", transition: "all 0.2s ease" } as any : {}),
                })}
                accessibilityRole="button"
                accessibilityLabel="Send verification code"
                testID="forgot-pin-send"
              >
                <Ionicons name={useEmail ? "mail-outline" : "send-outline"} size={18} color="#FFFFFF" />
                <Text
                  style={{
                    color: "#FFFFFF",
                    fontSize: 17,
                    fontFamily: "DMSans_600SemiBold",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  {loading ? "Sending..." : useEmail ? "Send to Email" : "Send Code"}
                </Text>
              </Pressable>
            </View>
          )}

          {step === "otp" && (
            <View>
              <OTPInput
                length={6}
                onComplete={handleVerifyOTP}
                loading={loading}
                icon="shield-checkmark"
                iconColor="#10B981"
                title=""
                subtitle=""
              />

              {/* Resend */}
              <Pressable
                onPress={handleRequestOTP}
                disabled={loading}
                style={({ pressed, hovered }: any) => ({
                  alignItems: "center",
                  marginTop: 16,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: isWeb && hovered ? "rgba(16, 185, 129, 0.06)" : "transparent",
                  opacity: pressed ? 0.7 : 1,
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                })}
                accessibilityRole="button"
              >
                <Text
                  style={{
                    color: tc.primary[300],
                    fontSize: 14,
                    fontFamily: "DMSans_500Medium",
                  }}
                >
                  Resend code
                </Text>
              </Pressable>
            </View>
          )}

          {step === "new-pin" && (
            <View style={{ marginTop: 8 }}>
              <PinInput
                onComplete={handleNewPin}
                error={pinError}
                testID="forgot-pin-new-pin"
              />
            </View>
          )}

          {step === "confirm-pin" && (
            <View style={{ marginTop: 8 }}>
              <PinInput
                onComplete={handleConfirmPin}
                error={pinError}
                testID="forgot-pin-confirm-pin"
              />
              {loading && (
                <Text
                  style={{
                    color: tc.primary[300],
                    fontSize: 14,
                    fontFamily: "DMSans_500Medium",
                    textAlign: "center",
                    marginTop: 20,
                  }}
                >
                  Resetting PIN...
                </Text>
              )}
            </View>
          )}

          {step === "success" && (
            <View>
              <Pressable
                onPress={() => router.replace("/auth/login")}
                style={({ pressed, hovered }: any) => ({
                  backgroundColor: hovered ? tc.primary[400] : tc.primary[500],
                  borderRadius: 18,
                  paddingVertical: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 8,
                  minHeight: 56,
                  opacity: pressed ? 0.9 : 1,
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease" } as any : {}),
                })}
                accessibilityRole="button"
                accessibilityLabel="Go to sign in"
                testID="forgot-pin-signin"
              >
                <Ionicons name="log-in-outline" size={20} color="#FFFFFF" />
                <Text
                  style={{
                    color: "#FFFFFF",
                    fontSize: 17,
                    fontFamily: "DMSans_600SemiBold",
                  }}
                >
                  Sign In
                </Text>
              </Pressable>
            </View>
          )}
        </Animated.View>

        {/* Back to login */}
        {step !== "success" && (
          <Pressable
            onPress={() => {
              if (step === "phone") {
                router.back();
              } else if (step === "otp") {
                animateTransition("phone");
              } else if (step === "new-pin") {
                animateTransition("otp");
              } else if (step === "confirm-pin") {
                setNewPin("");
                setPinError(false);
                animateTransition("new-pin");
              }
            }}
            style={({ pressed, hovered }: any) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              marginTop: 24,
              paddingVertical: 10,
              paddingHorizontal: 16,
              borderRadius: 10,
              backgroundColor: isWeb && hovered ? tc.dark.elevated : "transparent",
              opacity: pressed ? 0.7 : 1,
              ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
            })}
            accessibilityRole="button"
            accessibilityLabel="Go back"
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
            >
              {step === "phone" ? "Back to sign in" : "Back"}
            </Text>
          </Pressable>
        )}

        {/* Step indicator */}
        {step !== "success" && (
          <View
            style={{
              flexDirection: "row",
              justifyContent: "center",
              gap: 8,
              marginTop: 20,
            }}
          >
            {(["phone", "otp", "new-pin", "confirm-pin"] as Step[]).map((s, i) => (
              <View
                key={s}
                style={{
                  width: step === s ? 24 : 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor:
                    step === s
                      ? tc.primary[400]
                      : (["phone", "otp", "new-pin", "confirm-pin"] as Step[]).indexOf(step) > i
                      ? "rgba(16, 185, 129, 0.4)"
                      : "rgba(255, 255, 255, 0.1)",
                  ...(isWeb ? { transition: "all 0.3s ease" } as any : {}),
                }}
              />
            ))}
          </View>
        )}
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
        >
          Secured with 256-bit encryption
        </Text>
      </View>
    </ScrollView>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
