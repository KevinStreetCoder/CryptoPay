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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { PinInput } from "../../src/components/PinInput";
import { useToast } from "../../src/components/Toast";
import { useAuth } from "../../src/stores/auth";
import { useScreenSecurity } from "../../src/hooks/useScreenSecurity";
import { normalizeError } from "../../src/utils/apiErrors";
import { useGoogleAuth } from "../../src/hooks/useGoogleAuth";
import { getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";

type Step = "phone" | "pin";

function KeBadge({ tc }: { tc: ReturnType<typeof getThemeColors> }) {
  return (
    <View
      style={{
        width: 28,
        height: 20,
        borderRadius: 4,
        backgroundColor: tc.primary[500],
        alignItems: "center",
        justifyContent: "center",
        marginRight: 8,
      }}
    >
      <Text
        style={{
          color: "#FFFFFF",
          fontSize: 10,
          fontFamily: "Inter_700Bold",
          letterSpacing: 0.5,
        }}
      >
        KE
      </Text>
    </View>
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
      {/* Decorative gradient circles */}
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

      {/* Logo */}
      <View style={{ alignItems: "center", marginBottom: 32 }}>
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 24,
            backgroundColor: tc.primary[500],
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 24,
            shadowColor: tc.primary[500],
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.4,
            shadowRadius: 24,
          }}
        >
          <Ionicons name="wallet" size={40} color="#FFFFFF" />
        </View>
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 36,
            fontFamily: "Inter_700Bold",
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
            fontFamily: "Inter_400Regular",
            textAlign: "center",
            lineHeight: 26,
            maxWidth: 320,
          }}
        >
          Pay bills with crypto, instantly.{"\n"}Secure, fast, and seamless.
        </Text>
      </View>

      {/* Feature highlights */}
      <View style={{ gap: 16, marginTop: 32, maxWidth: 300 }}>
        {[
          { icon: "flash" as const, text: "Instant M-Pesa payments" },
          { icon: "shield-checkmark" as const, text: "Bank-grade encryption" },
          { icon: "swap-horizontal" as const, text: "Real-time crypto conversion" },
        ].map((item) => (
          <View
            key={item.text}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
            }}
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
                fontFamily: "Inter_500Medium",
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

export default function LoginScreen() {
  const router = useRouter();
  const { login, googleLogin } = useAuth();
  const toast = useToast();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const { width } = useWindowDimensions();
  const { ready: googleReady, response: googleResponse, promptAsync } = useGoogleAuth();

  // Handle Google Sign-In response
  useEffect(() => {
    if (googleResponse?.type === "success") {
      const idToken = googleResponse.params.id_token;
      if (idToken) {
        handleGoogleLogin(idToken);
      }
    } else if (googleResponse?.type === "error") {
      setGoogleLoading(false);
      toast.error("Google Sign-In", "Authentication failed. Please try again.");
    } else if (googleResponse?.type === "dismiss") {
      setGoogleLoading(false);
    }
  }, [googleResponse]);

  const handleGoogleLogin = async (idToken: string) => {
    setGoogleLoading(true);
    try {
      await googleLogin(idToken);
      router.replace("/(tabs)");
    } catch (err: unknown) {
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setGoogleLoading(false);
    }
  };

  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;

  // Fade animation for step transitions
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useScreenSecurity(step === "pin");

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

  const handlePhoneSubmit = () => {
    if (phone.length < 9) {
      toast.warning("Invalid Number", "Please enter a valid phone number");
      return;
    }
    animateTransition("pin");
  };

  const handlePinComplete = async (pin: string) => {
    setLoading(true);
    setPinError(false);
    try {
      await login(phone, pin);
      router.replace("/(tabs)");
    } catch (err: unknown) {
      setPinError(true);
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setLoading(false);
    }
  };

  const isPhoneValid = phone.length >= 9;

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
            ? ({
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.3,
                shadowRadius: 24,
              } as any)
            : { elevation: 12 }),
        }}
      >
        {/* Logo Area - only show on mobile/non-desktop */}
        {!isDesktop && (
          <View
            style={{ alignItems: "center", marginBottom: 36 }}
            accessibilityRole="header"
          >
            <View
              style={{
                position: "relative",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
                width: 96,
                height: 96,
              }}
            >
              <View
                style={{
                  position: "absolute",
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  backgroundColor: "rgba(16, 185, 129, 0.10)",
                }}
              />
              <View
                style={{
                  position: "absolute",
                  width: 76,
                  height: 76,
                  borderRadius: 38,
                  backgroundColor: "rgba(16, 185, 129, 0.18)",
                }}
              />
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 20,
                  backgroundColor: tc.primary[500],
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="wallet" size={32} color="#FFFFFF" />
              </View>
            </View>

            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 30,
                fontFamily: "Inter_700Bold",
                letterSpacing: -0.5,
              }}
              maxFontSizeMultiplier={1.3}
            >
              CryptoPay
            </Text>
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 15,
                fontFamily: "Inter_400Regular",
                marginTop: 6,
                textAlign: "center",
              }}
              maxFontSizeMultiplier={1.3}
            >
              Pay bills with crypto, instantly
            </Text>
          </View>
        )}

        {/* Desktop: simple header text */}
        {isDesktop && (
          <View style={{ marginBottom: 32 }}>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 28,
                fontFamily: "Inter_700Bold",
                letterSpacing: -0.5,
                marginBottom: 8,
              }}
            >
              {step === "phone" ? "Sign in" : "Enter your PIN"}
            </Text>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 15,
                fontFamily: "Inter_400Regular",
                lineHeight: 22,
              }}
            >
              {step === "phone"
                ? "Enter the M-Pesa number linked to your account"
                : "Enter your 6-digit security PIN to sign in"}
            </Text>
          </View>
        )}

        {/* Step Content */}
        <Animated.View style={{ opacity: fadeAnim }}>
          {step === "phone" ? (
            <View>
              {!isDesktop && (
                <>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 21,
                      fontFamily: "Inter_600SemiBold",
                      marginBottom: 6,
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Welcome back
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 14,
                      fontFamily: "Inter_400Regular",
                      marginBottom: 24,
                      lineHeight: 20,
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Enter the M-Pesa number linked to your account
                  </Text>
                </>
              )}

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
                  ...(Platform.OS === 'web' ? { transition: 'border-color 0.2s ease, box-shadow 0.2s ease' } as any : {}),
                  ...(phoneFocused && Platform.OS === 'web' ? { boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.15)' } as any : {}),
                  ...(phoneFocused
                    ? isWeb
                      ? ({
                          shadowColor: tc.primary[500],
                          shadowOffset: { width: 0, height: 0 },
                          shadowOpacity: 0.3,
                          shadowRadius: 12,
                        } as any)
                      : { elevation: 4 }
                    : {}),
                }}
              >
                <KeBadge tc={tc} />
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 16,
                    fontFamily: "Inter_500Medium",
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
                  onSubmitEditing={handlePhoneSubmit}
                  style={{
                    flex: 1,
                    color: tc.textPrimary,
                    fontSize: 16,
                    fontFamily: "Inter_400Regular",
                    paddingVertical: 16,
                    ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                  }}
                  accessibilityLabel="Phone number"
                  accessibilityHint="Enter your M-Pesa registered phone number"
                  testID="phone-input"
                  maxFontSizeMultiplier={1.3}
                />
              </View>

              {/* Continue Button */}
              <Pressable
                onPress={handlePhoneSubmit}
                disabled={!isPhoneValid}
                style={({ pressed }) => ({
                  backgroundColor: isPhoneValid
                    ? tc.primary[500]
                    : "rgba(16, 185, 129, 0.3)",
                  borderRadius: 18,
                  paddingVertical: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 24,
                  minHeight: 56,
                  opacity: !isPhoneValid ? 0.6 : pressed ? 0.9 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                  ...(isPhoneValid
                    ? isWeb
                      ? ({
                          shadowColor: tc.primary[500],
                          shadowOffset: { width: 0, height: 4 },
                          shadowOpacity: 0.3,
                          shadowRadius: 16,
                        } as any)
                      : { elevation: 8 }
                    : {}),
                })}
                accessibilityRole="button"
                accessibilityLabel="Continue"
                accessibilityState={{ disabled: !isPhoneValid }}
                testID="continue-button"
              >
                <Text
                  style={{
                    color: "#FFFFFF",
                    fontSize: 17,
                    fontFamily: "Inter_600SemiBold",
                    letterSpacing: 0.3,
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Continue
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
                    fontFamily: "Inter_500Medium",
                    paddingHorizontal: 14,
                  }}
                >
                  OR
                </Text>
                <View style={{ flex: 1, height: 1, backgroundColor: tc.dark.border }} />
              </View>

              {/* Google Sign-In Button */}
              <Pressable
                onPress={() => {
                  setGoogleLoading(true);
                  promptAsync();
                }}
                disabled={!googleReady || googleLoading}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: tc.dark.elevated,
                  borderRadius: 18,
                  paddingVertical: 14,
                  marginTop: 16,
                  minHeight: 56,
                  borderWidth: 1,
                  borderColor: "rgba(255, 255, 255, 0.08)",
                  opacity: googleLoading ? 0.7 : pressed ? 0.9 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                  gap: 10,
                })}
                accessibilityRole="button"
                accessibilityLabel="Sign in with Google"
                accessibilityState={{ disabled: !googleReady || googleLoading, busy: googleLoading }}
                testID="google-signin-button"
              >
                {googleLoading ? (
                  <ActivityIndicator size="small" color={tc.textSecondary} />
                ) : (
                  <Text style={{ fontSize: 18 }}>G</Text>
                )}
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 15,
                    fontFamily: "Inter_600SemiBold",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  {googleLoading ? "Signing in..." : "Continue with Google"}
                </Text>
              </Pressable>

              {/* Register Link */}
              <View style={{ marginTop: 24, alignItems: "center" }}>
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 14,
                    fontFamily: "Inter_400Regular",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Don't have an account?{" "}
                  <Text
                    style={{
                      color: tc.primary[300],
                      fontFamily: "Inter_600SemiBold",
                    }}
                    onPress={() => router.push("/auth/register")}
                    accessibilityRole="link"
                    accessibilityLabel="Register for a new account"
                  >
                    Register
                  </Text>
                </Text>
              </View>
            </View>
          ) : (
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
                      name="lock-closed"
                      size={28}
                      color={tc.primary[300]}
                    />
                  </View>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 21,
                      fontFamily: "Inter_600SemiBold",
                      marginBottom: 6,
                      textAlign: "center",
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Enter your PIN
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 14,
                      fontFamily: "Inter_400Regular",
                      textAlign: "center",
                      lineHeight: 20,
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    Enter your 6-digit security PIN to sign in
                  </Text>
                </View>
              )}

              <View style={{ marginTop: isDesktop ? 8 : 24, marginBottom: 8 }}>
                <PinInput
                  onComplete={handlePinComplete}
                  error={pinError}
                  testID="login-pin-input"
                />
              </View>

              {loading && (
                <Text
                  style={{
                    color: tc.primary[300],
                    fontSize: 14,
                    fontFamily: "Inter_500Medium",
                    textAlign: "center",
                    marginTop: 20,
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Signing in...
                </Text>
              )}

              <Pressable
                onPress={() => animateTransition("phone")}
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
                    fontFamily: "Inter_500Medium",
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Back to phone number
                </Text>
              </Pressable>
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
            fontFamily: "Inter_400Regular",
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
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: tc.dark.bg }}>
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
