/**
 * Email-verify-on-login gate · 2026-04-26.
 *
 * Lands here AFTER a successful login when the backend flagged
 * `email_verify_required: true` because the user's email is empty,
 * disposable, or unverified. The user must provide a real,
 * deliverable address and confirm an OTP before reaching the home
 * tabs.
 *
 * Implementation reuses the existing `/auth/email/verify/` and
 * `/auth/email/confirm/` endpoints · the backend already rejects
 * disposable domains (Layer 1) and missing MX records (Layer 2)
 * during the send step, so the client doesn't need to duplicate
 * those checks.
 *
 * The user MUST complete this flow · we don't expose a "skip"
 * button. They can sign out (which lands them on /auth/login) but
 * the next sign-in puts them right back here.
 */
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Platform,
  Pressable,
  KeyboardAvoidingView,
  ScrollView,
  Image,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { Button } from "../../src/components/Button";
import { OTPInput } from "../../src/components/OTPInput";
import { useToast } from "../../src/components/Toast";
import { authApi } from "../../src/api/auth";
import { useAuth } from "../../src/stores/auth";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { useLocale } from "../../src/hooks/useLocale";

const BRAND_MARK = require("../../assets/brand-mark.png");

type Step = "email" | "otp";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailVerifyRequiredScreen() {
  const router = useRouter();
  const toast = useToast();
  const { logout, refreshProfile } = useAuth();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { t } = useLocale();
  const { width } = useWindowDimensions();

  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | undefined>();

  const handleSendCode = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) {
      toast.error("Invalid email", "Enter a valid address.");
      return;
    }
    setLoading(true);
    try {
      await authApi.sendEmailVerification(trimmed);
      setSubmittedEmail(trimmed);
      setStep("otp");
      toast.success("Code sent", `Check ${trimmed} for the verification code.`);
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Could not send the code. Try a different email.";
      toast.error("Email rejected", msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (code: string) => {
    setOtpError(undefined);
    setLoading(true);
    try {
      // Existing endpoint accepts either a 32-char URL token or the
      // 6-char OTP from the email body. We're passing the 6-digit
      // OTP here · backend's ConfirmEmailVerificationView resolves
      // both shapes against the EmailVerificationToken table.
      await authApi.confirmEmailVerification(code);
      // Refresh the profile so `email_verified=true` is reflected
      // before we drop into the tabs · also clears the gate on next
      // login.
      try { await refreshProfile?.(); } catch {}
      toast.success("Email verified", "Welcome to Cpay.");
      router.replace("/(tabs)");
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Invalid or expired code.";
      setOtpError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!submittedEmail) return;
    setLoading(true);
    try {
      await authApi.sendEmailVerification(submittedEmail);
      toast.success("Code resent", `New code sent to ${submittedEmail}.`);
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Could not resend.";
      toast.error("Resend failed", msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try { await logout(); } catch {}
    router.replace("/auth/login" as any);
  };

  const renderHeader = () => (
    <View style={{ alignItems: "center", marginBottom: 28 }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 22,
          backgroundColor: colors.primary[500] + "12",
          borderWidth: 1,
          borderColor: colors.primary[500] + "25",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        <Image
          source={BRAND_MARK}
          style={{ width: 38, height: 38 }}
          resizeMode="contain"
          accessibilityLabel="Cpay"
        />
      </View>
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 22,
          fontFamily: "DMSans_700Bold",
          letterSpacing: -0.4,
          marginBottom: 8,
          textAlign: "center",
        }}
      >
        Verify your email
      </Text>
      <Text
        style={{
          color: tc.textSecondary,
          fontSize: 14,
          fontFamily: "DMSans_400Regular",
          textAlign: "center",
          lineHeight: 21,
          paddingHorizontal: 12,
        }}
      >
        {step === "email"
          ? "We need a real email address to send transaction receipts and security alerts. Disposable inboxes aren't accepted."
          : `Enter the 6-digit code we sent to ${submittedEmail}.`}
      </Text>
    </View>
  );

  const renderEmail = () => (
    <View>
      {renderHeader()}
      <Text
        style={{
          color: tc.textMuted,
          fontSize: 12,
          fontFamily: "DMSans_600SemiBold",
          letterSpacing: 0.6,
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Email address
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: tc.dark.card,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: tc.glass.border,
          paddingHorizontal: 14,
        }}
      >
        <Ionicons name="mail-outline" size={18} color={tc.textMuted} style={{ marginRight: 10 }} />
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={tc.dark.muted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          editable={!loading}
          style={{
            flex: 1,
            color: tc.textPrimary,
            fontSize: 15,
            paddingVertical: 14,
            fontFamily: "DMSans_400Regular",
            ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
          }}
          accessibilityLabel="Email address"
          testID="email-verify-input"
        />
      </View>

      <View style={{ marginTop: 24 }}>
        <Button
          title="Send code"
          onPress={handleSendCode}
          loading={loading}
          disabled={!EMAIL_RE.test(email.trim())}
          size="lg"
          icon={<Ionicons name="paper-plane-outline" size={18} color="#FFFFFF" />}
          testID="email-verify-send"
        />
      </View>

      <Pressable
        onPress={handleSignOut}
        style={({ pressed }: any) => ({
          marginTop: 24,
          alignItems: "center",
          paddingVertical: 12,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 13,
            fontFamily: "DMSans_500Medium",
          }}
        >
          {t("profile.logout")}
        </Text>
      </Pressable>
    </View>
  );

  const renderOtp = () => (
    <View>
      {renderHeader()}
      <OTPInput
        length={6}
        onComplete={handleVerifyOtp}
        loading={loading}
        error={otpError}
        icon=""
        title=""
        subtitle=""
        autoFocus
      />
      <Pressable
        onPress={handleResend}
        disabled={loading}
        style={({ pressed }: any) => ({
          marginTop: 8,
          alignItems: "center",
          paddingVertical: 12,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text
          style={{
            color: colors.primary[400],
            fontSize: 14,
            fontFamily: "DMSans_500Medium",
          }}
        >
          Resend code
        </Text>
      </Pressable>
      <Pressable
        onPress={() => setStep("email")}
        disabled={loading}
        style={({ pressed }: any) => ({
          alignItems: "center",
          paddingVertical: 8,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 13,
            fontFamily: "DMSans_500Medium",
          }}
        >
          Use a different email
        </Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingHorizontal: isDesktop ? 32 : 20,
            paddingVertical: 24,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 460,
              alignSelf: "center",
              backgroundColor: tc.dark.card,
              borderRadius: 24,
              padding: isDesktop ? 32 : 24,
              borderWidth: 1,
              borderColor: tc.glass.border,
              ...ts.lg,
            }}
          >
            {step === "email" ? renderEmail() : renderOtp()}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
