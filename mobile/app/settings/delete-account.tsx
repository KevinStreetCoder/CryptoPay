/**
 * Delete-account screen · Google Play compliance.
 *
 * Two-stage flow that mirrors the backend gate:
 *   1. Warning + pre-flight checklist + i18n explanation of what's
 *      removed vs retained (regulatory).
 *   2. PIN re-entry · matches the existing change-pin pattern, so
 *      muscle memory is preserved.
 *
 * On success the screen flips to a "Scheduled for {date}" state
 * with a Cancel button. The user can keep using the app inside
 * the 14-day grace window via existing tokens (the login flow
 * refuses NEW logins · see backend `LoginView` guard) but every
 * fresh sign-in lands them back on this screen.
 */
import { useState } from "react";
import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { PinInput } from "../../src/components/PinInput";
import { useToast } from "../../src/components/Toast";
import { authApi } from "../../src/api/auth";
import { useAuth } from "../../src/stores/auth";
import { useScreenSecurity } from "../../src/hooks/useScreenSecurity";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { useLocale } from "../../src/hooks/useLocale";

type Step = "review" | "pin" | "scheduled";

export default function DeleteAccountScreen() {
  const router = useRouter();
  const toast = useToast();
  const { logout } = useAuth();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { t } = useLocale();
  const { width } = useWindowDimensions();

  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;

  const [step, setStep] = useState<Step>("review");
  const [loading, setLoading] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);

  // Cover the screen on iOS app-switcher / Android Recents · this is
  // a sensitive flow (PIN entry, irreversible action).
  useScreenSecurity(true);

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return iso;
    }
  };

  const handleSchedule = async (pin: string) => {
    setLoading(true);
    setPinError(false);
    try {
      const { data } = await authApi.requestAccountDeletion(pin);
      setScheduledFor(data.scheduled_for);
      setStep("scheduled");
    } catch (err: any) {
      const status = err?.response?.status;
      const code = err?.response?.data?.error_code;
      if (status === 401) {
        setPinError(true);
        toast.error(t("auth.deleteAccountWrongPin"), "");
      } else if (code === "non_zero_balance") {
        toast.error(t("auth.deleteAccountNonZeroBalance"), "");
      } else if (code === "already_scheduled") {
        toast.warning(t("auth.deleteAccountAlreadyScheduled"), "");
        const sched = err?.response?.data?.scheduled_for;
        if (sched) {
          setScheduledFor(sched);
          setStep("scheduled");
        }
      } else {
        toast.error(t("auth.deleteAccountFailed"), "");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancelDeletion = async (pin: string) => {
    setLoading(true);
    setPinError(false);
    try {
      await authApi.cancelAccountDeletion(pin);
      toast.success(t("auth.deleteAccountCancelled"), "");
      setScheduledFor(null);
      setStep("review");
      // Navigate back to settings · the user proved their PIN, so the
      // session is fine to continue.
      router.back();
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        setPinError(true);
        toast.error(t("auth.deleteAccountWrongPin"), "");
      } else {
        toast.error(t("auth.deleteAccountFailed"), "");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignOutAfterSchedule = async () => {
    // Once scheduled, sign the user out so they have to re-auth to
    // see the account again · re-auth lands them on this screen via
    // the LoginView 403 guard, where they can cancel the deletion.
    try { await logout(); } catch {}
    router.replace("/auth/login" as any);
  };

  const renderReview = () => (
    <View>
      {/* Hero icon · destructive accent */}
      <View
        style={{
          alignSelf: "center",
          width: 72,
          height: 72,
          borderRadius: 24,
          backgroundColor: colors.error + "15",
          borderWidth: 1,
          borderColor: colors.error + "30",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 20,
        }}
      >
        <Ionicons name="trash-outline" size={32} color={colors.error} />
      </View>

      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 22,
          fontFamily: "DMSans_700Bold",
          textAlign: "center",
          marginBottom: 8,
          letterSpacing: -0.4,
        }}
      >
        {t("auth.deleteAccountTitle")}
      </Text>

      <Text
        style={{
          color: tc.textSecondary,
          fontSize: 14,
          fontFamily: "DMSans_400Regular",
          textAlign: "center",
          lineHeight: 21,
          marginBottom: 24,
          paddingHorizontal: 12,
        }}
      >
        {t("auth.deleteAccountIntro")}
      </Text>

      {/* Pre-flight panel · the two things they MUST do first */}
      <View
        style={{
          backgroundColor: colors.warning + "10",
          borderRadius: 16,
          padding: 16,
          borderWidth: 1,
          borderColor: colors.warning + "30",
          marginBottom: 16,
        }}
      >
        <Text
          style={{
            color: colors.warning,
            fontSize: 13,
            fontFamily: "DMSans_700Bold",
            letterSpacing: 0.4,
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          {t("auth.deleteAccountPreflightTitle")}
        </Text>
        <Bullet text={t("auth.deleteAccountPreflightWithdraw")} tc={tc} />
        <Bullet text={t("auth.deleteAccountPreflightCancel")} tc={tc} />
      </View>

      {/* What gets removed · destructive */}
      <DisclosurePanel
        title={t("auth.deleteAccountWillRemove")}
        body={t("auth.deleteAccountWillRemoveItems")}
        accent={colors.error}
        tc={tc}
      />

      {/* What we keep · neutral */}
      <DisclosurePanel
        title={t("auth.deleteAccountWillKeep")}
        body={t("auth.deleteAccountWillKeepItems")}
        accent={colors.primary[400]}
        tc={tc}
      />

      <Pressable
        onPress={() => setStep("pin")}
        style={({ pressed, hovered }: any) => ({
          marginTop: 24,
          backgroundColor: pressed
            ? colors.error + "30"
            : isWeb && hovered
              ? colors.error + "20"
              : colors.error + "15",
          borderWidth: 1,
          borderColor: pressed ? colors.error + "70" : colors.error + "40",
          borderRadius: 16,
          paddingVertical: 16,
          alignItems: "center",
          ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
        })}
        accessibilityRole="button"
        accessibilityLabel={t("auth.deleteAccountConfirmAction")}
        testID="delete-account-confirm"
      >
        <Text
          style={{
            color: colors.error,
            fontSize: 15,
            fontFamily: "DMSans_600SemiBold",
          }}
        >
          {t("auth.deleteAccountConfirmAction")}
        </Text>
      </Pressable>
    </View>
  );

  const renderPin = () => (
    <View>
      <View
        style={{
          alignSelf: "center",
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
        <Ionicons name="lock-closed-outline" size={28} color={colors.primary[400]} />
      </View>
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 18,
          fontFamily: "DMSans_700Bold",
          textAlign: "center",
          marginBottom: 6,
        }}
      >
        {t("auth.deleteAccountEnterPin")}
      </Text>
      <Text
        style={{
          color: tc.textSecondary,
          fontSize: 13,
          fontFamily: "DMSans_400Regular",
          textAlign: "center",
          marginBottom: 24,
        }}
      >
        {t("auth.deleteAccountTitle")}
      </Text>
      <PinInput
        onComplete={handleSchedule}
        error={pinError}
        loading={loading}
        testID="delete-account-pin"
      />
    </View>
  );

  const renderScheduled = () => (
    <View>
      <View
        style={{
          alignSelf: "center",
          width: 72,
          height: 72,
          borderRadius: 24,
          backgroundColor: colors.warning + "15",
          borderWidth: 1,
          borderColor: colors.warning + "30",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 20,
        }}
      >
        <Ionicons name="time-outline" size={32} color={colors.warning} />
      </View>
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 22,
          fontFamily: "DMSans_700Bold",
          textAlign: "center",
          marginBottom: 8,
          letterSpacing: -0.4,
        }}
      >
        {t("auth.deleteAccountScheduledTitle")}
      </Text>
      <Text
        style={{
          color: tc.textSecondary,
          fontSize: 14,
          fontFamily: "DMSans_400Regular",
          textAlign: "center",
          lineHeight: 21,
          marginBottom: 28,
          paddingHorizontal: 12,
        }}
      >
        {t("auth.deleteAccountScheduledMsg").replace(
          "{date}",
          scheduledFor ? formatDate(scheduledFor) : "—",
        )}
      </Text>

      {/* Cancel · uses PinInput for re-auth */}
      <Text
        style={{
          color: tc.textMuted,
          fontSize: 12,
          fontFamily: "DMSans_600SemiBold",
          letterSpacing: 0.6,
          textTransform: "uppercase",
          marginBottom: 10,
          textAlign: "center",
        }}
      >
        {t("auth.deleteAccountCancelAction")}
      </Text>
      <Text
        style={{
          color: tc.textSecondary,
          fontSize: 13,
          fontFamily: "DMSans_400Regular",
          textAlign: "center",
          marginBottom: 16,
        }}
      >
        {t("auth.deleteAccountEnterPin")}
      </Text>
      <PinInput
        onComplete={handleCancelDeletion}
        error={pinError}
        loading={loading}
        testID="delete-account-cancel-pin"
      />

      <Pressable
        onPress={handleSignOutAfterSchedule}
        style={({ pressed }: any) => ({
          marginTop: 28,
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {/* Top bar with back · NOT shown on the scheduled state · the
            user must explicitly cancel or sign out from there. */}
        {step !== "scheduled" && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 16,
              paddingTop: 8,
              paddingBottom: 4,
            }}
          >
            <Pressable
              onPress={() => {
                if (step === "pin") setStep("review");
                else if (router.canGoBack()) router.back();
                else router.replace("/(tabs)/profile" as any);
              }}
              style={({ pressed }: any) => ({
                width: 44,
                height: 44,
                borderRadius: 14,
                backgroundColor: tc.dark.card,
                borderWidth: 1,
                borderColor: tc.glass.border,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.85 : 1,
              })}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
            </Pressable>
          </View>
        )}

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
              maxWidth: 480,
              alignSelf: "center",
              backgroundColor: tc.dark.card,
              borderRadius: 24,
              padding: isDesktop ? 32 : 24,
              borderWidth: 1,
              borderColor: tc.glass.border,
              ...ts.lg,
            }}
          >
            {step === "review" && renderReview()}
            {step === "pin" && renderPin()}
            {step === "scheduled" && renderScheduled()}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bullet({ text, tc }: { text: string; tc: ReturnType<typeof getThemeColors> }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: colors.warning,
          marginTop: 7,
        }}
      />
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 13.5,
          fontFamily: "DMSans_400Regular",
          lineHeight: 20,
          flex: 1,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

function DisclosurePanel({
  title,
  body,
  accent,
  tc,
}: {
  title: string;
  body: string;
  accent: string;
  tc: ReturnType<typeof getThemeColors>;
}) {
  return (
    <View
      style={{
        backgroundColor: accent + "08",
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: accent + "20",
        marginBottom: 12,
      }}
    >
      <Text
        style={{
          color: accent,
          fontSize: 12,
          fontFamily: "DMSans_700Bold",
          letterSpacing: 0.5,
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: tc.textSecondary,
          fontSize: 13,
          fontFamily: "DMSans_400Regular",
          lineHeight: 19,
        }}
      >
        {body}
      </Text>
    </View>
  );
}
