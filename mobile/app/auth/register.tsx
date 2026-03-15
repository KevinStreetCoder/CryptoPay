import { useState, useRef, useEffect } from "react";
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
import { useToast } from "../../src/components/Toast";
import { useAuth } from "../../src/stores/auth";
import { authApi } from "../../src/api/auth";
import { useScreenSecurity } from "../../src/hooks/useScreenSecurity";
import { normalizeError } from "../../src/utils/apiErrors";
import { useGoogleAuth } from "../../src/hooks/useGoogleAuth";
import { getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { BRAND_LOGOS } from "../../src/constants/logos";

type Step = "phone" | "otp" | "name" | "pin";

const STEPS: Step[] = ["phone", "otp", "name", "pin"];
const STEP_LABELS = ["Phone", "Verify", "Name", "PIN"];

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

function BrandPanel({ tc }: { tc: ReturnType<typeof getThemeColors> }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#040A14",
        justifyContent: "center",
        alignItems: "center",
        padding: 48,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <View
        style={{
          position: "absolute",
          top: -100,
          right: -100,
          width: 400,
          height: 400,
          borderRadius: 200,
          backgroundColor: "rgba(16, 185, 129, 0.04)",
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: -80,
          left: -80,
          width: 300,
          height: 300,
          borderRadius: 150,
          backgroundColor: "rgba(16, 185, 129, 0.03)",
        }}
      />

      <View style={{ alignItems: "center", marginBottom: 32 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            backgroundColor: tc.primary[500],
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
            ...(Platform.OS !== "web"
              ? {
                  shadowColor: tc.primary[500],
                  shadowOffset: { width: 0, height: 6 },
                  shadowOpacity: 0.35,
                  shadowRadius: 16,
                }
              : { boxShadow: `0 8px 24px rgba(16, 185, 129, 0.35)` } as any),
          }}
        >
          <Ionicons name="flash" size={28} color="#FFFFFF" />
        </View>
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 36,
            fontFamily: "DMSans_700Bold",
            letterSpacing: -1,
            marginBottom: 12,
          }}
        >
          CryptoPay
        </Text>
        <Text
          style={{
            color: tc.textSecondary,
            fontSize: 18,
            fontFamily: "DMSans_400Regular",
            textAlign: "center",
            lineHeight: 26,
            maxWidth: 320,
          }}
        >
          Join thousands paying bills{"\n"}with crypto in Kenya.
        </Text>
      </View>

      <View style={{ gap: 16, marginTop: 32, maxWidth: 300 }}>
        {[
          { icon: "flash" as const, text: "Set up in under 2 minutes" },
          { icon: "shield-checkmark" as const, text: "No KYC needed to start" },
          { icon: "wallet" as const, text: "Multi-crypto wallet included" },
        ].map((item) => (
          <View
            key={item.text}
            style={{ flexDirection: "row", alignItems: "center", gap: 14 }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: "rgba(16, 185, 129, 0.1)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name={item.icon} size={20} color={tc.primary[300]} />
            </View>
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 15,
                fontFamily: "DMSans_500Medium",
              }}
            >
              {item.text}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function RegisterScreen() {
  const router = useRouter();
  const { register, googleLogin } = useAuth();
  const toast = useToast();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [pin, setPin] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const { width } = useWindowDimensions();
  const { ready: googleReady, response: googleResponse, promptAsync } = useGoogleAuth();

  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;

  // Handle Google Sign-In response
  useEffect(() => {
    if (googleResponse?.type === "success") {
      const idToken = googleResponse.params.id_token;
      if (idToken) {
        (async () => {
          setGoogleLoading(true);
          try {
            const data = await googleLogin(idToken);
            if (data.phone_required) {
              router.replace("/auth/google-complete-profile" as any);
            } else if (data.pin_required) {
              router.replace("/auth/set-initial-pin" as any);
            } else {
              router.replace("/(tabs)");
            }
          } catch (err: unknown) {
            const appError = normalizeError(err);
            toast.error(appError.title, appError.message);
          } finally {
            setGoogleLoading(false);
          }
        })();
      }
    } else if (googleResponse?.type === "error") {
      setGoogleLoading(false);
      toast.error("Google Sign-In", "Authentication failed. Please try again.");
    } else if (googleResponse?.type === "dismiss") {
      setGoogleLoading(false);
    }
  }, [googleResponse]);

  const otpRefs = useRef<(TextInput | null)[]>([]);
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", "", "", ""]);

  const fadeAnim = useRef(new Animated.Value(1)).current;

  useScreenSecurity(step === "pin");

  const currentIndex = STEPS.indexOf(step);

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

  const handleOtpDigitChange = (index: number, value: string) => {
    const cleaned = value.replace(/[^0-9]/g, "");
    const newDigits = [...otpDigits];

    if (cleaned.length > 1) {
      const chars = cleaned.split("").slice(0, 6);
      chars.forEach((char, i) => {
        if (i + index < 6) {
          newDigits[i + index] = char;
        }
      });
      setOtpDigits(newDigits);
      setOtp(newDigits.join(""));
      const nextIndex = Math.min(index + chars.length, 5);
      otpRefs.current[nextIndex]?.focus();
      return;
    }

    newDigits[index] = cleaned;
    setOtpDigits(newDigits);
    setOtp(newDigits.join(""));

    if (cleaned && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyPress = (index: number, key: string) => {
    if (key === "Backspace" && !otpDigits[index] && index > 0) {
      const newDigits = [...otpDigits];
      newDigits[index - 1] = "";
      setOtpDigits(newDigits);
      setOtp(newDigits.join(""));
      otpRefs.current[index - 1]?.focus();
    }
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

  const handleVerifyOTP = () => {
    if (otp.length < 6) {
      toast.warning("Invalid Code", "Please enter all 6 digits");
      return;
    }
    animateTransition("name");
  };

  const handleNameSubmit = () => {
    animateTransition("pin");
  };

  const handlePinComplete = async (pinValue: string) => {
    setPin(pinValue);
    setLoading(true);
    try {
      await register(phone, pinValue, otp, fullName || undefined);
      router.replace("/(tabs)");
    } catch (err: unknown) {
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setLoading(false);
    }
  };

  const isPhoneValid = phone.length >= 9;

  const renderStepIndicator = () => (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 32,
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
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: isCompleted
                    ? tc.primary[500]
                    : isCurrent
                    ? "rgba(16, 185, 129, 0.15)"
                    : "rgba(22, 39, 66, 0.5)",
                  borderWidth: 2,
                  borderColor: isCompleted
                    ? tc.primary[500]
                    : isCurrent
                    ? tc.primary[500]
                    : tc.dark.border,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {isCompleted ? (
                  <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                ) : (
                  <Text
                    style={{
                      color: isCurrent ? tc.primary[300] : tc.textMuted,
                      fontSize: 14,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    {i + 1}
                  </Text>
                )}
              </View>
              <Text
                style={{
                  color: isCurrent
                    ? tc.primary[300]
                    : isCompleted
                    ? tc.textSecondary
                    : tc.textMuted,
                  fontSize: 10,
                  fontFamily: isCurrent ? "DMSans_600SemiBold" : "DMSans_400Regular",
                  marginTop: 4,
                }}
                maxFontSizeMultiplier={1.3}
              >
                {STEP_LABELS[i]}
              </Text>
            </View>

            {i < STEPS.length - 1 && (
              <View
                style={{
                  width: 32,
                  height: 2,
                  backgroundColor:
                    currentIndex > i
                      ? tc.primary[500]
                      : "rgba(255, 255, 255, 0.08)",
                  marginHorizontal: 4,
                  marginBottom: 18,
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
          maxWidth: 520,
          width: "100%",
          alignSelf: "center",
          ...(isWeb
            ? ({ boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)" } as any)
            : { elevation: 12 }),
        }}
      >
        {/* Step Indicator */}
        {renderStepIndicator()}

        {/* Desktop: step title */}
        {isDesktop && (
          <View style={{ marginBottom: 24, alignItems: "center" }}>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 24,
                fontFamily: "DMSans_700Bold",
                letterSpacing: -0.3,
                marginBottom: 8,
                textAlign: "center",
              }}
            >
              {step === "phone" && "Create your account"}
              {step === "otp" && "Verification Code"}
              {step === "name" && "What's your name?"}
              {step === "pin" && "Create a PIN"}
            </Text>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 13,
                fontFamily: "DMSans_400Regular",
                lineHeight: 19,
                textAlign: "center",
                maxWidth: 300,
              }}
            >
              {step === "phone" &&
                "We'll send a verification code to confirm your number"}
              {step === "otp" && `Enter the 6-digit code sent to +254 ${phone}`}
              {step === "name" && "This helps us personalize your experience"}
              {step === "pin" && "Choose a 6-digit PIN to secure your account"}
            </Text>
          </View>
        )}

        {/* Step Content */}
        <Animated.View style={{ opacity: fadeAnim }}>
          {/* ===== PHONE STEP ===== */}
          {step === "phone" && (
            <View>
              {!isDesktop && (
                <View style={{ alignItems: "center", marginBottom: 24 }}>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 22,
                      fontFamily: "DMSans_700Bold",
                      marginBottom: 8,
                      letterSpacing: -0.3,
                      textAlign: "center",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Create your account
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 13,
                      fontFamily: "DMSans_400Regular",
                      lineHeight: 19,
                      textAlign: "center",
                      maxWidth: 280,
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    We'll send a verification code to confirm your number
                  </Text>
                </View>
              )}

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
                  ...(Platform.OS === 'web' ? { transition: 'border-color 0.2s ease, box-shadow 0.2s ease' } as any : {}),
                  ...(phoneFocused && Platform.OS === 'web' ? { boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.15)' } as any : {}),
                  ...(phoneFocused && !isWeb
                    ? { elevation: 4 }
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
                  autoFocus
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
                  accessibilityHint="Enter your phone number for registration"
                  testID="register-phone-input"
                  maxFontSizeMultiplier={1.3}
                />
              </View>

              <Pressable
                onPress={handleSendOTP}
                disabled={!isPhoneValid || loading}
                style={({ pressed, hovered }: any) => ({
                  backgroundColor:
                    isPhoneValid && !loading
                      ? hovered ? tc.primary[400] : tc.primary[500]
                      : "rgba(16, 185, 129, 0.3)",
                  borderRadius: 18,
                  paddingVertical: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 24,
                  minHeight: 56,
                  opacity: !isPhoneValid ? 0.6 : pressed ? 0.9 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                  ...(isWeb ? { cursor: isPhoneValid ? "pointer" : "default", transition: "all 0.2s ease" } as any : {}),
                  ...(isPhoneValid && !loading
                    ? isWeb
                      ? ({ boxShadow: hovered ? "0 6px 20px rgba(16, 185, 129, 0.35)" : "0 4px 16px rgba(16, 185, 129, 0.25)" } as any)
                      : { elevation: 8 }
                    : {}),
                })}
                accessibilityRole="button"
                accessibilityLabel="Send verification code"
                accessibilityState={{
                  disabled: !isPhoneValid || loading,
                  busy: loading,
                }}
                testID="send-otp-button"
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
                  {loading ? "Sending..." : "Send Verification Code"}
                </Text>
              </Pressable>

              {/* Divider */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginTop: 24,
                  marginBottom: 4,
                }}
              >
                <View style={{ flex: 1, height: 1, backgroundColor: tc.dark.border }} />
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 12,
                    fontFamily: "DMSans_500Medium",
                    paddingHorizontal: 14,
                  }}
                >
                  OR
                </Text>
                <View style={{ flex: 1, height: 1, backgroundColor: tc.dark.border }} />
              </View>

              {/* Google Sign-Up Button */}
              <Pressable
                onPress={() => {
                  setGoogleLoading(true);
                  promptAsync();
                }}
                disabled={!googleReady || googleLoading}
                style={({ pressed, hovered }: any) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isWeb && hovered ? "rgba(255,255,255,0.06)" : tc.dark.elevated,
                  borderRadius: 18,
                  paddingVertical: 14,
                  marginTop: 16,
                  minHeight: 56,
                  borderWidth: 1,
                  borderColor: isWeb && hovered ? "rgba(255,255,255,0.14)" : "rgba(255, 255, 255, 0.08)",
                  opacity: googleLoading ? 0.7 : pressed ? 0.9 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                  gap: 12,
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease" } as any : {}),
                })}
                accessibilityRole="button"
                accessibilityLabel="Sign up with Google"
                accessibilityState={{ disabled: !googleReady || googleLoading, busy: googleLoading }}
                testID="google-signup-button"
              >
                {googleLoading ? (
                  <ActivityIndicator size="small" color={tc.textSecondary} />
                ) : (
                  <Image
                    source={{ uri: BRAND_LOGOS.google }}
                    style={{ width: 20, height: 20 }}
                    accessibilityLabel="Google"
                  />
                )}
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 15,
                    fontFamily: "DMSans_600SemiBold",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  {googleLoading ? "Signing up..." : "Sign up with Google"}
                </Text>
              </Pressable>

              <View style={{ marginTop: 24, alignItems: "center" }}>
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 14,
                    fontFamily: "DMSans_400Regular",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Already have an account?{" "}
                  <Text
                    style={{
                      color: tc.primary[300],
                      fontFamily: "DMSans_600SemiBold",
                    }}
                    onPress={() => router.push("/auth/login")}
                    accessibilityRole="link"
                    accessibilityLabel="Go to login"
                  >
                    Login
                  </Text>
                </Text>
              </View>
            </View>
          )}

          {/* ===== OTP STEP ===== */}
          {step === "otp" && (
            <View>
              {!isDesktop && (
                <>
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
                        name="chatbubble-ellipses"
                        size={28}
                        color={tc.primary[300]}
                      />
                    </View>
                  </View>

                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 22,
                      fontFamily: "DMSans_700Bold",
                      marginBottom: 6,
                      textAlign: "center",
                      letterSpacing: -0.3,
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Verification Code
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 14,
                      fontFamily: "DMSans_400Regular",
                      marginBottom: 28,
                      textAlign: "center",
                      lineHeight: 20,
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Enter the 6-digit code sent to{"\n"}
                    <Text
                      style={{
                        color: tc.textSecondary,
                        fontFamily: "DMSans_600SemiBold",
                      }}
                    >
                      +254 {phone}
                    </Text>
                  </Text>
                </>
              )}

              <View style={{ marginBottom: 28 }}>
                <PinInput
                  length={6}
                  onComplete={(code) => {
                    setOtp(code);
                    setOtpDigits(code.split(""));
                  }}
                  error={false}
                  testID="otp-input"
                />
              </View>

              {otp.length === 6 && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                    gap: 6,
                  }}
                >
                  <Ionicons
                    name="checkmark-circle"
                    size={18}
                    color={tc.primary[300]}
                  />
                  <Text
                    style={{
                      color: tc.primary[300],
                      fontSize: 13,
                      fontFamily: "DMSans_500Medium",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Code entered successfully
                  </Text>
                </View>
              )}

              <Pressable
                onPress={handleVerifyOTP}
                disabled={otp.length < 6}
                style={({ pressed }) => ({
                  backgroundColor:
                    otp.length >= 6 ? tc.primary[500] : "rgba(16, 185, 129, 0.3)",
                  borderRadius: 18,
                  paddingVertical: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 56,
                  opacity: otp.length < 6 ? 0.6 : pressed ? 0.9 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                  ...(otp.length >= 6
                    ? isWeb
                      ? ({ boxShadow: "0 4px 16px rgba(16, 185, 129, 0.3)" } as any)
                      : { elevation: 8 }
                    : {}),
                })}
                accessibilityRole="button"
                accessibilityLabel="Verify code"
                accessibilityState={{ disabled: otp.length < 6 }}
                testID="verify-otp-button"
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
                  Verify
                </Text>
              </Pressable>

              <View style={{ marginTop: 24, alignItems: "center", gap: 12 }}>
                <Pressable
                  onPress={handleSendOTP}
                  style={({ pressed }) => ({
                    paddingVertical: 4,
                    opacity: pressed ? 0.9 : 1,
                  })}
                  accessibilityRole="button"
                  accessibilityLabel="Resend code"
                >
                  <Text
                    style={{
                      color: tc.primary[300],
                      fontSize: 14,
                      fontFamily: "DMSans_500Medium",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Resend Code
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => animateTransition("phone")}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 4,
                    opacity: pressed ? 0.9 : 1,
                  })}
                  accessibilityRole="button"
                  accessibilityLabel="Change phone number"
                >
                  <Ionicons
                    name="arrow-back"
                    size={14}
                    color={tc.textMuted}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 13,
                      fontFamily: "DMSans_400Regular",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Change phone number
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* ===== NAME STEP ===== */}
          {step === "name" && (
            <View>
              {!isDesktop && (
                <>
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
                        name="person"
                        size={28}
                        color={tc.primary[300]}
                      />
                    </View>
                  </View>

                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 22,
                      fontFamily: "DMSans_700Bold",
                      marginBottom: 6,
                      textAlign: "center",
                      letterSpacing: -0.3,
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    What's your name?
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 14,
                      fontFamily: "DMSans_400Regular",
                      marginBottom: 28,
                      textAlign: "center",
                      lineHeight: 20,
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    This helps us personalize your experience
                  </Text>
                </>
              )}

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
                  ...(Platform.OS === 'web' ? { transition: 'border-color 0.2s ease, box-shadow 0.2s ease' } as any : {}),
                  ...(nameFocused && Platform.OS === 'web' ? { boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.15)' } as any : {}),
                  ...(nameFocused && !isWeb
                    ? { elevation: 4 }
                    : {}),
                }}
              >
                <Ionicons
                  name="person-outline"
                  size={20}
                  color={nameFocused ? tc.primary[300] : tc.textMuted}
                  style={{ marginRight: 12 }}
                />
                <TextInput
                  value={fullName}
                  onChangeText={(text) => setFullName(text.replace(/[^a-zA-Z\u00C0-\u024F\s'\-\.]/g, ""))}
                  placeholder="Enter your full name"
                  placeholderTextColor={tc.textMuted}
                  autoFocus
                  autoCapitalize="words"
                  maxLength={50}
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                  onSubmitEditing={handleNameSubmit}
                  style={{
                    flex: 1,
                    color: tc.textPrimary,
                    fontSize: 16,
                    fontFamily: "DMSans_400Regular",
                    paddingVertical: 16,
                    ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                  }}
                  accessibilityLabel="Full name"
                  accessibilityHint="Enter your full name"
                  testID="name-input"
                  maxFontSizeMultiplier={1.3}
                />
              </View>

              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 12,
                  fontFamily: "DMSans_400Regular",
                  marginTop: 10,
                  paddingHorizontal: 4,
                }}
                maxFontSizeMultiplier={1.3}
              >
                Optional -- you can add this later in settings
              </Text>

              <Pressable
                onPress={handleNameSubmit}
                style={({ pressed }) => ({
                  backgroundColor: tc.primary[500],
                  borderRadius: 18,
                  paddingVertical: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 24,
                  minHeight: 56,
                  opacity: pressed ? 0.9 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                  ...(isWeb
                    ? ({ boxShadow: "0 4px 16px rgba(16, 185, 129, 0.3)" } as any)
                    : { elevation: 8 }),
                })}
                accessibilityRole="button"
                accessibilityLabel="Continue"
                testID="name-continue-button"
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
                  Continue
                </Text>
              </Pressable>
            </View>
          )}

          {/* ===== PIN STEP ===== */}
          {step === "pin" && (
            <View>
              {!isDesktop && (
                <>
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
                        name="lock-closed"
                        size={28}
                        color={tc.primary[300]}
                      />
                    </View>
                  </View>

                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 22,
                      fontFamily: "DMSans_700Bold",
                      marginBottom: 6,
                      textAlign: "center",
                      letterSpacing: -0.3,
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Create a PIN
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 14,
                      fontFamily: "DMSans_400Regular",
                      marginBottom: 28,
                      textAlign: "center",
                      lineHeight: 20,
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Choose a 6-digit PIN to secure your account
                  </Text>
                </>
              )}

              <View style={{ marginBottom: 20 }}>
                <PinInput
                  onComplete={handlePinComplete}
                  testID="register-pin-input"
                />
              </View>

              {loading && (
                <Text
                  style={{
                    color: tc.primary[300],
                    fontSize: 14,
                    fontFamily: "DMSans_500Medium",
                    textAlign: "center",
                    marginTop: 16,
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Creating your account...
                </Text>
              )}

              <View
                style={{
                  backgroundColor: "rgba(16, 185, 129, 0.06)",
                  borderRadius: 16,
                  padding: 16,
                  marginTop: 24,
                  borderWidth: 1,
                  borderColor: "rgba(255, 255, 255, 0.08)",
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginBottom: 10,
                    gap: 6,
                  }}
                >
                  <Ionicons
                    name="shield-checkmark"
                    size={16}
                    color={tc.primary[300]}
                  />
                  <Text
                    style={{
                      color: tc.primary[300],
                      fontSize: 13,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Security Tips
                  </Text>
                </View>
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 12,
                    fontFamily: "DMSans_400Regular",
                    lineHeight: 18,
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  {"\u2022"} Don't use easy patterns like 123456{"\n"}
                  {"\u2022"} Don't reuse your M-Pesa PIN{"\n"}
                  {"\u2022"} Never share your PIN with anyone
                </Text>
              </View>
            </View>
          )}
        </Animated.View>
      </View>

      {/* Trust Indicators */}
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

  // Desktop web: split layout with brand panel + form
  if (isDesktop) {
    return (
      <View
        style={{ flex: 1, flexDirection: "row", backgroundColor: tc.dark.bg }}
      >
        <BrandPanel tc={tc} />
        <View
          style={{
            flex: 1,
            backgroundColor: tc.dark.bg,
            justifyContent: "center",
          }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={{ flex: 1 }}
          >
            {formContent}
          </KeyboardAvoidingView>
        </View>
      </View>
    );
  }

  // Mobile & tablet: standard centered layout
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        {formContent}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
