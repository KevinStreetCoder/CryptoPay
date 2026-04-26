import { Image, View, Text, Platform, Pressable, Keyboard, KeyboardAvoidingView, ScrollView } from "react-native";
import { useState, useEffect, useCallback, useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
import { colors, getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";
import { useBiometricAuth } from "../hooks/useBiometricAuth";
import { PinInput } from "./PinInput";
import { Spinner } from "./brand/Spinner";
import { authApi } from "../api/auth";

// Brand mark used on the lock screens (PIN + biometric mode) so the
// gate matches the rest of the app chrome instead of generic
// Ionicons. Transparent-bg PNG · same asset google-unlock uses.
const BRAND_MARK = require("../../assets/brand-mark.png");

const isWeb = Platform.OS === "web";

interface AppLockScreenProps {
  onUnlock: () => void;
  userPhone?: string;
  onForgotPin?: () => void;
}

export function AppLockScreen({ onUnlock, userPhone, onForgotPin }: AppLockScreenProps) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { authenticate, biometricType, isAvailable } = useBiometricAuth();
  const [mode, setMode] = useState<"biometric" | "pin">(isAvailable ? "biometric" : "pin");
  const [pinError, setPinError] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const [biometricFailed, setBiometricFailed] = useState(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup · the watchdog timer below scheduledcsetState calls; if
  // the component unmounts before the timer fires (because onUnlock
  // navigated away successfully), the deferred setState would have
  // landed on dead memory. Track the mount flag and bail in the
  // timer body to avoid the warning.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (watchdogRef.current) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
    };
  }, []);

  const handleBiometricAuth = useCallback(async () => {
    if (!isAvailable) {
      setMode("pin");
      return;
    }

    const success = await authenticate("Unlock Cpay");
    if (success) {
      setBiometricFailed(false);
      onUnlock();
    } else {
      setBiometricFailed(true);
    }
  }, [authenticate, isAvailable, onUnlock]);

  // Auto-prompt biometric on mount
  useEffect(() => {
    if (Platform.OS !== "web" && isAvailable && mode === "biometric") {
      const timer = setTimeout(handleBiometricAuth, 400);
      return () => clearTimeout(timer);
    }
  }, []); // Only on mount

  const handlePinComplete = useCallback(async (pin: string) => {
    if (!userPhone) {
      // No phone available · can't verify PIN, just unlock
      onUnlock();
      return;
    }

    setPinLoading(true);
    setPinError(false);

    // Watchdog · the backend's verify-pin endpoint is fast (sub-100ms
    // p99 in production) but if a flaky network or container restart
    // makes the request hang, the user is stuck staring at six filled
    // dots with no spinner advancement. Force-clear after 12 s with a
    // generic error so they can retry. 12 s > axios default 15 s would
    // timeout naturally; we set 12 to fire BEFORE that and surface a
    // friendlier message. Cleared on success, error, or unmount.
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      setPinLoading(false);
      setPinError(true);
    }, 12000);

    const clearWatchdog = () => {
      if (watchdogRef.current) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
    };

    try {
      // Verify PIN via dedicated endpoint (no device/OTP checks).
      // The axios response interceptor in `client.ts` already handles
      // token refresh transparently when a 401 carries no `error`
      // string body. A 401 with `{verified: false}` (wrong PIN) is
      // re-thrown without refresh and lands in the catch below.
      await authApi.verifyPin(pin);
      clearWatchdog();
      // Critical · clear loading + error BEFORE onUnlock so that if
      // anything causes AppLockScreen to re-render (e.g. a parent
      // state flush race) the user never sees a stale "Incorrect
      // PIN" / spinner frame.
      setPinLoading(false);
      setPinError(false);
      onUnlock();
    } catch (err: any) {
      clearWatchdog();
      // Distinguish "wrong PIN" (status 401 + verified:false) from
      // a token-refresh failure that bubbled up. Both arrive here as
      // a thrown error, but only the first should put the user back
      // into the retry state · a refresh failure means the parent
      // forceLogout has already fired and AppLockScreen is about to
      // unmount, so we deliberately don't flag pinError there.
      const status = err?.response?.status;
      const body = err?.response?.data;
      const isWrongPin =
        status === 401 &&
        (body?.verified === false || body?.error === "Incorrect PIN");
      const isRateLimited = status === 429;
      // Network errors (no `response` because the request never
      // landed) should also surface as "try again" rather than a
      // silent stall · same UX path as wrong-PIN, just with a
      // different cause.
      const isNetworkError = !err?.response;

      if (isWrongPin || isRateLimited || isNetworkError) {
        setPinError(true);
      }
      setPinLoading(false);
    }
  }, [userPhone, onUnlock]);

  const iconName =
    biometricType === "face"
      ? "scan-outline"
      : biometricType === "fingerprint"
        ? "finger-print-outline"
        : "lock-closed-outline";

  const biometricLabel =
    biometricType === "face"
      ? "Face ID"
      : biometricType === "fingerprint"
        ? "Fingerprint"
        : "Biometric";

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: tc.dark.bg }}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          paddingBottom: 80,
        }}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
      {mode === "biometric" ? (
        <>
          {/* Biometric mode · brand mark with the biometric icon
              floating off the lower-right corner so the screen feels
              owned by Cpay rather than generic platform UI. */}
          <View
            style={{
              width: 96,
              height: 96,
              borderRadius: 32,
              backgroundColor: colors.primary[500] + "12",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 24,
              borderWidth: 1,
              borderColor: colors.primary[500] + "30",
              position: "relative",
            }}
          >
            <Image
              source={BRAND_MARK}
              style={{ width: 56, height: 56 }}
              resizeMode="contain"
              accessibilityLabel="Cpay"
            />
            <View
              style={{
                position: "absolute",
                bottom: -6,
                right: -6,
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: colors.primary[500],
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 2,
                borderColor: tc.dark.bg,
              }}
            >
              <Ionicons name={iconName as any} size={16} color="#FFFFFF" />
            </View>
          </View>

          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 22,
              fontFamily: "DMSans_700Bold",
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            Cpay Locked
          </Text>

          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 14,
              fontFamily: "DMSans_400Regular",
              textAlign: "center",
              marginBottom: 32,
              lineHeight: 20,
            }}
          >
            {`Use ${biometricLabel} to unlock`}
          </Text>

          {biometricFailed && (
            <Text
              style={{
                color: colors.error,
                fontSize: 13,
                fontFamily: "DMSans_500Medium",
                textAlign: "center",
                marginBottom: 16,
              }}
            >
              Authentication failed
            </Text>
          )}

          {/* Retry biometric button */}
          <Pressable
            onPress={handleBiometricAuth}
            style={({ pressed }: any) => ({
              paddingHorizontal: 32,
              paddingVertical: 14,
              borderRadius: 16,
              backgroundColor: colors.primary[500] + "15",
              borderWidth: 1,
              borderColor: colors.primary[500] + "30",
              opacity: pressed ? 0.7 : 1,
              marginBottom: 20,
            })}
            accessibilityRole="button"
            accessibilityLabel={`Unlock with ${biometricLabel}`}
          >
            <Text
              style={{
                color: colors.primary[400],
                fontSize: 15,
                fontFamily: "DMSans_600SemiBold",
                textAlign: "center",
              }}
            >
              {biometricFailed ? `Try ${biometricLabel} Again` : `Unlock with ${biometricLabel}`}
            </Text>
          </Pressable>

          {/* Switch to PIN */}
          <Pressable
            onPress={() => setMode("pin")}
            style={({ pressed }: any) => ({
              paddingVertical: 10,
              opacity: pressed ? 0.6 : 1,
            })}
            accessibilityRole="button"
            accessibilityLabel="Use PIN instead"
          >
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 14,
                fontFamily: "DMSans_500Medium",
                textAlign: "center",
              }}
            >
              Use PIN Instead
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          {/* PIN mode · brand mark instead of the generic keypad
              Ionicons so the lock screen reads as Cpay's own chrome,
              not a stock RN screen. */}
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 24,
              backgroundColor: colors.primary[500] + "10",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 20,
              borderWidth: 1,
              borderColor: colors.primary[500] + "25",
            }}
          >
            <Image
              source={BRAND_MARK}
              style={{ width: 42, height: 42 }}
              resizeMode="contain"
              accessibilityLabel="Cpay"
            />
          </View>

          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 20,
              fontFamily: "DMSans_700Bold",
              marginBottom: 6,
              textAlign: "center",
            }}
          >
            Enter Your PIN
          </Text>

          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 13,
              fontFamily: "DMSans_400Regular",
              textAlign: "center",
              marginBottom: 28,
              lineHeight: 19,
            }}
          >
            Enter your 6-digit PIN to unlock
          </Text>

          <PinInput
            onComplete={handlePinComplete}
            error={pinError}
            loading={pinLoading}
          />

          {/* Verifying spinner · matches the sign-in flow visual so
              users never see a frozen frame between "6th digit
              entered" and "unlock" / "wrong PIN" feedback. */}
          {pinLoading && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                marginTop: 16,
              }}
            >
              <Spinner variant="arc" size={18} color={colors.primary[400]} />
              <Text
                style={{
                  color: colors.primary[400],
                  fontSize: 13,
                  fontFamily: "DMSans_500Medium",
                }}
              >
                Verifying...
              </Text>
            </View>
          )}

          {pinError && !pinLoading && (
            <Text
              style={{
                color: colors.error,
                fontSize: 13,
                fontFamily: "DMSans_500Medium",
                textAlign: "center",
                marginTop: 12,
              }}
            >
              Incorrect PIN. Try again.
            </Text>
          )}

          {/* Forgot PIN link */}
          {onForgotPin && (
            <Pressable
              onPress={onForgotPin}
              style={({ pressed }: any) => ({
                paddingVertical: 10,
                marginTop: 8,
                opacity: pressed ? 0.6 : 1,
              })}
              accessibilityRole="link"
              accessibilityLabel="Forgot PIN"
            >
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 13,
                  fontFamily: "DMSans_500Medium",
                  textAlign: "center",
                }}
              >
                Forgot PIN?
              </Text>
            </Pressable>
          )}

          {/* Switch to biometric if available */}
          {isAvailable && (
            <Pressable
              onPress={() => {
                setMode("biometric");
                setBiometricFailed(false);
                // Auto-trigger biometric
                setTimeout(handleBiometricAuth, 300);
              }}
              style={({ pressed }: any) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingVertical: 12,
                paddingHorizontal: 20,
                marginTop: 20,
                borderRadius: 14,
                backgroundColor: colors.primary[500] + "10",
                opacity: pressed ? 0.6 : 1,
              })}
              accessibilityRole="button"
              accessibilityLabel={`Use ${biometricLabel} instead`}
            >
              <Ionicons name={iconName as any} size={18} color={colors.primary[400]} />
              <Text
                style={{
                  color: colors.primary[400],
                  fontSize: 14,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                {`Use ${biometricLabel}`}
              </Text>
            </Pressable>
          )}
        </>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
