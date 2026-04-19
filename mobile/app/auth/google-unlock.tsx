/**
 * Google-unlock gate.
 *
 * After a returning user signs in with Google, we DO hold a valid JWT
 * pair in SecureStore, but we refuse to drop the user into the app until
 * they prove local device ownership via PIN or biometric. Without this
 * gate, anyone with the Google account could log in from any machine
 * and read wallet balances / move funds.
 *
 * Layout choices:
 *   - Centered vertically AND horizontally; never anchored to the top of
 *     a void. The card has weight via border + shadow so it reads as a
 *     deliberate stop, not a 404.
 *   - On wide desktop (≥ 900 px) we split into two columns: a narrative
 *     panel on the left explaining what's happening, and the PIN tile on
 *     the right. Below 900 px we collapse to a single centered column.
 *   - The brand mark sits in the top-left so the user knows where they
 *     are. A subtle radial brand glow sits behind the card to give the
 *     dark surface depth without the AI-template "purple gradient
 *     everywhere" look.
 *   - Motion is deliberately minimal: hover lift on buttons, no idle
 *     loops, no decorative pulses.
 *
 * Security properties:
 *   - Tokens already in storage; this is a SECOND-factor gate.
 *   - PIN check is rate-limited (`apps.accounts.tests.ProgressiveLockout`).
 *   - Biometric only on native, hardware-backed.
 *   - Back / direct nav cannot bypass: route guard in _layout.tsx
 *     enforces the gate via the synchronous `getGoogleUnlockPendingSync`.
 *   - Escape hatch is "Sign out", not "Skip".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
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
import { Wordmark } from "../../src/components/brand/Wordmark";
import { authApi } from "../../src/api/auth";
import {
  useAuth,
  isBiometricEnabled,
  clearGoogleUnlockFlag,
} from "../../src/stores/auth";
import { useToast } from "../../src/components/Toast";
import { getThemeColors, colors } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";

// Transparent-bg Coin-C mark for in-app chrome (dark surface behind it).
const APP_LOGO = require("../../assets/brand-mark.png");

export default function GoogleUnlockScreen() {
  const { user, logout } = useAuth();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const toast = useToast();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isWide = width >= 900;
  const isMobile = width < 768;

  const [verifying, setVerifying] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [bioTried, setBioTried] = useState(false);
  const attempted = useRef(false);

  // Probe biometric on mount (native only). One shot.
  useEffect(() => {
    if (isWeb || attempted.current) return;
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
  }, [isWeb]);

  const handlePin = useCallback(
    async (pin: string) => {
      if (verifying) return;
      if (!isWeb) Keyboard.dismiss();
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
    [verifying, toast, isWeb],
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
      if (result.success) {
        await clearGoogleUnlockFlag();
        router.replace("/(tabs)" as any);
      }
    } catch {
      /* swallow */
    }
  }, []);

  // ── Pieces ─────────────────────────────────────────────────────────

  const brandMark = <Wordmark size={26} dark />;

  const narrativePanel = (
    <View style={{ flex: 1, paddingRight: isWide ? 32 : 0 }}>
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          backgroundColor: colors.primary[500] + "1A",
          borderWidth: 1,
          borderColor: colors.primary[500] + "33",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 18,
        }}
      >
        <Ionicons name="shield-checkmark-outline" size={22} color={colors.primary[400]} />
      </View>
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: isWide ? 28 : 22,
          lineHeight: isWide ? 34 : 28,
          fontFamily: "DMSans_700Bold",
          letterSpacing: -0.5,
          marginBottom: 8,
        }}
      >
        One more step.
      </Text>
      <Text
        style={{
          color: tc.textSecondary,
          fontSize: isWide ? 15 : 14,
          lineHeight: isWide ? 23 : 21,
          fontFamily: "DMSans_400Regular",
          marginBottom: isWide ? 24 : 18,
          maxWidth: isWide ? 360 : undefined,
        }}
      >
        Google verified your identity. Now confirm this device with your CryptoPay PIN
        {biometricAvailable ? " or biometric" : ""}. We do this every time you sign in
        with Google so a forgotten browser session can never open your wallet.
      </Text>

      {/* Trust signals — quiet, single-line. Stacks on mobile. */}
      <View
        style={{
          flexDirection: isWide ? "column" : "row",
          flexWrap: "wrap",
          gap: isWide ? 10 : 14,
        }}
      >
        <TrustRow icon="lock-closed-outline" tc={tc} label="End-to-end encrypted" />
        <TrustRow icon="time-outline" tc={tc} label="Locks after 5 wrong tries" />
      </View>
    </View>
  );

  const gatePanel = (
    <View style={{ flex: isWide ? 1 : undefined, alignItems: "center", width: "100%" }}>
      <Text
        style={{
          color: tc.textMuted,
          fontSize: 11,
          fontFamily: "DMSans_700Bold",
          letterSpacing: 1.4,
          textTransform: "uppercase",
          alignSelf: "flex-start",
          marginBottom: 14,
        }}
      >
        Enter PIN
      </Text>

      {/* Reuse the existing PinInput component. error takes a boolean
          (the component clears + re-focuses on truthy). */}
      <View style={{ alignItems: "center", width: "100%" }}>
        <PinInput
          length={6}
          onComplete={handlePin}
          error={pinError}
          loading={verifying}
        />
      </View>

      {/* Helper row underneath: forgot PIN | biometric retry on native */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          marginTop: 18,
          gap: 10,
        }}
      >
        <Pressable
          onPress={() => router.push("/auth/forgot-pin" as any)}
          disabled={verifying}
          style={({ pressed }) => ({
            opacity: pressed ? 0.6 : 1,
            paddingVertical: 6,
          })}
        >
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_500Medium",
            }}
          >
            Forgot PIN?
          </Text>
        </Pressable>

        {biometricAvailable ? (
          <Pressable
            onPress={retryBiometric}
            disabled={verifying}
            style={({ pressed, hovered }: any) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 6,
              paddingHorizontal: 10,
              borderRadius: 10,
              backgroundColor: hovered ? colors.primary[500] + "12" : "transparent",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="finger-print" size={14} color={colors.primary[400]} />
            <Text
              style={{
                color: colors.primary[300],
                fontSize: 12,
                fontFamily: "DMSans_600SemiBold",
              }}
            >
              Use biometric
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  // ── Layout ─────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      {/* Atmospheric brand glow — soft radial under the card, web only.
          Anchored centre-bottom so the card sits in its halo. */}
      {isWeb ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: "30%",
            left: "50%",
            width: 720,
            height: 720,
            marginLeft: -360,
            borderRadius: 360,
            backgroundColor: colors.primary[500],
            opacity: 0.06,
            ...({ filter: "blur(120px)" } as any),
          }}
        />
      ) : null}

      {/* Top chrome: brand mark + escape hatch */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: isWide ? 32 : 20,
          paddingTop: 18,
          paddingBottom: 8,
        }}
      >
        {brandMark}
        <Pressable
          onPress={signOut}
          disabled={verifying}
          style={({ pressed, hovered }: any) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 10,
            backgroundColor: hovered ? "rgba(239,68,68,0.08)" : "transparent",
            opacity: pressed ? 0.7 : 1,
          })}
          accessibilityRole="button"
          accessibilityLabel="Sign out and return to login"
        >
          <Ionicons name="log-out-outline" size={14} color={tc.textMuted} />
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 12,
              fontFamily: "DMSans_500Medium",
            }}
          >
            Not you? Sign out
          </Text>
        </Pressable>
      </View>

      {/* Centered card */}
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          paddingHorizontal: isMobile ? 16 : 24,
          paddingBottom: isWide ? 60 : 32,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: isWide ? 880 : 460,
            backgroundColor: tc.glass.bg,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: tc.glass.border,
            paddingVertical: isWide ? 40 : 28,
            paddingHorizontal: isWide ? 44 : 24,
            ...((isWeb
              ? {
                  boxShadow: "0 30px 60px -20px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }
              : {
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 16 },
                  shadowOpacity: 0.35,
                  shadowRadius: 24,
                  elevation: 8,
                }) as any),
          }}
        >
          {isWide ? (
            <View style={{ flexDirection: "row", alignItems: "stretch" }}>
              {narrativePanel}
              <View style={{ width: 1, backgroundColor: tc.glass.border, marginHorizontal: 8 }} />
              <View style={{ flex: 1, paddingLeft: 32, justifyContent: "center" }}>
                {gatePanel}
              </View>
            </View>
          ) : (
            <View>
              {narrativePanel}
              <View
                style={{
                  height: 1,
                  backgroundColor: tc.glass.border,
                  marginVertical: 22,
                }}
              />
              {gatePanel}
            </View>
          )}
        </View>

        {/* Footer chrome */}
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 11,
            fontFamily: "DMSans_400Regular",
            marginTop: 20,
            opacity: 0.6,
          }}
        >
          {user?.email ? `Signed in as ${user.email}` : "Signed in via Google"}
        </Text>
      </View>
    </SafeAreaView>
  );
}

function TrustRow({
  icon,
  label,
  tc,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tc: any;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Ionicons name={icon} size={13} color={tc.textMuted} />
      <Text
        style={{
          color: tc.textSecondary,
          fontSize: 12,
          fontFamily: "DMSans_500Medium",
        }}
      >
        {label}
      </Text>
    </View>
  );
}
