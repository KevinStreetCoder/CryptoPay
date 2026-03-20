import { View, Text, Platform } from "react-native";
import { useState, useEffect, useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { colors, getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";
import { useBiometricAuth } from "../hooks/useBiometricAuth";

interface AppLockScreenProps {
  onUnlock: () => void;
}

export function AppLockScreen({ onUnlock }: AppLockScreenProps) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { authenticate, biometricType, isAvailable } = useBiometricAuth();
  const [failed, setFailed] = useState(false);

  const handleBiometricAuth = useCallback(async () => {
    if (!isAvailable) {
      // No biometric hardware — just unlock (PIN fallback handled by OS)
      onUnlock();
      return;
    }

    const success = await authenticate("Unlock CryptoPay");
    if (success) {
      setFailed(false);
      onUnlock();
    } else {
      setFailed(true);
    }
  }, [authenticate, isAvailable, onUnlock]);

  // Auto-prompt on mount
  useEffect(() => {
    if (Platform.OS !== "web") {
      // Small delay so the UI renders before the system prompt
      const timer = setTimeout(handleBiometricAuth, 300);
      return () => clearTimeout(timer);
    }
  }, [handleBiometricAuth]);

  const iconName =
    biometricType === "face"
      ? "scan-outline"
      : biometricType === "fingerprint"
        ? "finger-print-outline"
        : "lock-closed-outline";

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tc.dark.bg,
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      {/* Lock icon */}
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
          marginBottom: 40,
          lineHeight: 20,
        }}
      >
        {biometricType === "face"
          ? "Use Face ID to unlock"
          : biometricType === "fingerprint"
            ? "Use your fingerprint to unlock"
            : "Authenticate to continue"}
      </Text>

      {failed && (
        <Text
          style={{
            color: colors.error,
            fontSize: 13,
            fontFamily: "DMSans_500Medium",
            textAlign: "center",
            marginBottom: 20,
          }}
        >
          Authentication failed. Tap to try again.
        </Text>
      )}

      {/* Tap to retry area */}
      <View
        style={{
          paddingHorizontal: 32,
          paddingVertical: 14,
          borderRadius: 16,
          backgroundColor: colors.primary[500] + "15",
          borderWidth: 1,
          borderColor: colors.primary[500] + "30",
        }}
        onTouchEnd={handleBiometricAuth}
        accessible
        accessibilityRole="button"
        accessibilityLabel="Tap to unlock"
      >
        <Text
          style={{
            color: colors.primary[400],
            fontSize: 15,
            fontFamily: "DMSans_600SemiBold",
            textAlign: "center",
          }}
        >
          Tap to Unlock
        </Text>
      </View>
    </View>
  );
}
