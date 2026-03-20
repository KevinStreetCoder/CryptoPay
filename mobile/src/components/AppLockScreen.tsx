import { View, Text, Platform, Pressable, Keyboard, KeyboardAvoidingView, ScrollView } from "react-native";
import { useState, useEffect, useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { colors, getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";
import { useBiometricAuth } from "../hooks/useBiometricAuth";
import { PinInput } from "./PinInput";
import { authApi } from "../api/auth";

const isWeb = Platform.OS === "web";

interface AppLockScreenProps {
  onUnlock: () => void;
  userPhone?: string;
}

export function AppLockScreen({ onUnlock, userPhone }: AppLockScreenProps) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { authenticate, biometricType, isAvailable } = useBiometricAuth();
  const [mode, setMode] = useState<"biometric" | "pin">(isAvailable ? "biometric" : "pin");
  const [pinError, setPinError] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const [biometricFailed, setBiometricFailed] = useState(false);

  const handleBiometricAuth = useCallback(async () => {
    if (!isAvailable) {
      setMode("pin");
      return;
    }

    const success = await authenticate("Unlock CryptoPay");
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
      // No phone available — can't verify PIN, just unlock
      onUnlock();
      return;
    }

    setPinLoading(true);
    setPinError(false);

    try {
      // Verify PIN via login endpoint (re-authenticates the session)
      await authApi.login({ phone: userPhone, pin });
      onUnlock();
    } catch {
      setPinError(true);
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
          {/* Biometric mode */}
          <View
            style={{
              width: 96,
              height: 96,
              borderRadius: 32,
              backgroundColor: colors.primary[500] + "15",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 24,
              borderWidth: 1,
              borderColor: colors.primary[500] + "30",
            }}
          >
            <Ionicons name={iconName as any} size={44} color={colors.primary[400]} />
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
            CryptoPay Locked
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
          {/* PIN mode */}
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 24,
              backgroundColor: colors.primary[500] + "12",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 20,
              borderWidth: 1,
              borderColor: colors.primary[500] + "25",
            }}
          >
            <Ionicons name="keypad-outline" size={32} color={colors.primary[400]} />
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

          {pinError && (
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
