/**
 * Google-unlock gate.
 *
 * After a returning user signs in with Google, we DO hold a valid JWT
 * pair in SecureStore, but we refuse to drop the user into the app until
 * they prove local device ownership via PIN or biometric. Without this
 * gate, anyone with the Google account could log in from any machine
 * and read wallet balances / move funds.
 *
 * Security properties:
 *   - Tokens are already in storage by the time this mounts (the backend
 *     has authenticated the Google id_token). That's fine — the gate
 *     enforces a SECOND factor before any authenticated screen renders.
 *   - PIN check hits POST /auth/verify-pin/ which is rate-limited and
 *     locks the account after N wrong attempts (see ProgressiveLockout
 *     in apps/accounts/tests.py).
 *   - Biometric is offered ONLY on native where it's hardware-backed
 *     (Face ID / Touch ID / fingerprint). Web falls back to PIN only.
 *   - Back button does not bypass: pressing back signs the user out
 *     entirely rather than letting them skip the second factor.
 *   - Routing is via router.replace() everywhere, so the gate cannot
 *     be popped off the stack.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as LocalAuthentication from "expo-local-authentication";
import { Ionicons } from "@expo/vector-icons";

import { PinInput } from "../../src/components/PinInput";
import { authApi } from "../../src/api/auth";
import { useAuth } from "../../src/stores/auth";
import { useToast } from "../../src/components/Toast";
import { isBiometricEnabled, clearGoogleUnlockFlag } from "../../src/stores/auth";
import { getThemeColors, colors } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";

export default function GoogleUnlockScreen() {
  const { user, logout } = useAuth();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const toast = useToast();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const [verifying, setVerifying] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [bioTried, setBioTried] = useState(false);
  const attempted = useRef(false);

  // On mount: probe for biometric support and offer it immediately if the
  // user has it enabled. We only probe once — if the user cancels we
  // fall through to the PIN entry silently.
  useEffect(() => {
    if (Platform.OS === "web" || attempted.current) return;
    attempted.current = true;

    (async () => {
      try {
        const enabled = await isBiometricEnabled();
        if (!enabled) return;
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        if (!hasHardware || !enrolled) return;

        setBiometricAvailable(true);
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: "Unlock CryptoPay",
          cancelLabel: "Use PIN instead",
          disableDeviceFallback: false,
        });
        if (result.success) {
          await clearGoogleUnlockFlag();
          router.replace("/(tabs)" as any);
        }
      } catch {
        /* fall through to PIN */
      } finally {
        setBioTried(true);
      }
    })();
  }, []);

  const handlePin = useCallback(
    async (pin: string) => {
      if (verifying) return;
      if (Platform.OS !== "web") Keyboard.dismiss();
      setVerifying(true);
      setPinError(false);
      try {
        const { data } = await authApi.verifyPin(pin);
        if (data.verified) {
          await clearGoogleUnlockFlag();
          router.replace("/(tabs)" as any);
          return;
        }
        setPinError(true);
        toast.error("Incorrect PIN", "Try again.");
      } catch (e: any) {
        const status = e?.response?.status;
        if (status === 429) {
          toast.error(
            "Too many attempts",
            "Your account is temporarily locked. Try again in a few minutes.",
          );
        } else {
          setPinError(true);
          toast.error("Verification failed", "Please try again.");
        }
      } finally {
        setVerifying(false);
      }
    },
    [verifying, toast],
  );

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      router.replace("/auth/login" as any);
    }
  }, [logout]);

  const retryBiometric = useCallback(async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock CryptoPay",
        cancelLabel: "Cancel",
      });
      if (result.success) router.replace("/(tabs)" as any);
    } catch {
      /* swallow */
    }
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <View
        style={{
          flex: 1,
          paddingHorizontal: isDesktop ? 32 : 20,
          paddingTop: isDesktop ? 80 : 48,
          alignItems: "center",
        }}
      >
        <View style={{ maxWidth: 420, width: "100%" }}>
          {/* Header */}
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              backgroundColor: colors.primary[500] + "18",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 18,
            }}
          >
            <Ionicons name="shield-checkmark-outline" size={28} color={colors.primary[400]} />
          </View>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 24,
              fontFamily: "DMSans_700Bold",
              letterSpacing: -0.4,
              marginBottom: 6,
            }}
          >
            Confirm it's you
          </Text>
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 14,
              lineHeight: 21,
              fontFamily: "DMSans_400Regular",
              marginBottom: 28,
            }}
          >
            {user?.full_name
              ? `Welcome back, ${user.full_name.split(" ")[0]}. `
              : "Welcome back. "}
            Enter your PIN
            {biometricAvailable ? " or use biometric" : ""} to access your wallet.
          </Text>

          {/* PIN pad. Takes focus immediately on web; on native the
              biometric prompt is overlaid first, and the PIN pad is
              visible behind it as a fallback. */}
          <PinInput
            length={6}
            onComplete={handlePin}
            error={pinError ? "Incorrect PIN" : undefined}
            loading={verifying}
            autoFocus={Platform.OS === "web" || bioTried}
          />

          {/* Biometric retry (native only, if we have it) */}
          {biometricAvailable ? (
            <Pressable
              onPress={retryBiometric}
              disabled={verifying}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                marginTop: 20,
                paddingVertical: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: tc.glass.border,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="finger-print" size={18} color={colors.primary[400]} />
              <Text
                style={{
                  color: colors.primary[300],
                  fontSize: 14,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                Use biometric
              </Text>
            </Pressable>
          ) : null}

          {/* Escape hatch: sign out rather than bypass. */}
          <Pressable
            onPress={signOut}
            disabled={verifying}
            style={({ pressed }) => ({
              alignSelf: "center",
              marginTop: 24,
              paddingVertical: 10,
              paddingHorizontal: 16,
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
              Not you? Sign out
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
