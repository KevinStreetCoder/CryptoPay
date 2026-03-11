import React, { useRef, useState, useEffect } from "react";
import { View, Text, TextInput, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

const isWeb = Platform.OS === "web";

interface OTPInputProps {
  length?: number;
  onComplete: (code: string) => void;
  error?: string;
  loading?: boolean;
  autoFocus?: boolean;
  title?: string;
  subtitle?: string;
  icon?: string;
  iconColor?: string;
  resendLabel?: string;
  onResend?: () => void;
  resendCooldown?: number;
}

export function OTPInput({
  length = 6,
  onComplete,
  error,
  loading = false,
  autoFocus = true,
  title,
  subtitle,
  icon = "shield-checkmark-outline",
  iconColor,
  resendLabel = "Resend Code",
  onResend,
  resendCooldown = 60,
}: OTPInputProps) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  const [code, setCode] = useState<string[]>(Array(length).fill(""));
  const [focusedIndex, setFocusedIndex] = useState(autoFocus ? 0 : -1);
  const [cooldown, setCooldown] = useState(0);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleChange = (text: string, index: number) => {
    const digit = text.slice(-1);
    if (digit && !/^\d$/.test(digit)) return;

    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);

    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    const fullCode = newCode.join("");
    if (fullCode.length === length && !newCode.includes("")) {
      onComplete(fullCode);
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      const newCode = [...code];
      newCode[index - 1] = "";
      setCode(newCode);
    }
  };

  const handleResend = () => {
    if (cooldown > 0) return;
    onResend?.();
    setCooldown(resendCooldown);
    setCode(Array(length).fill(""));
    inputRefs.current[0]?.focus();
  };

  const effectiveIconColor = iconColor || colors.primary[400];

  return (
    <View style={{ alignItems: "center" }}>
      {icon && (
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            backgroundColor: effectiveIconColor + "12",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
            borderWidth: 1,
            borderColor: effectiveIconColor + "20",
          }}
        >
          <Ionicons name={icon as any} size={28} color={effectiveIconColor} />
        </View>
      )}

      {title && (
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 20,
            fontFamily: "DMSans_700Bold",
            marginBottom: 8,
            letterSpacing: -0.3,
            textAlign: "center",
          }}
        >
          {title}
        </Text>
      )}

      {subtitle && (
        <Text
          style={{
            color: tc.textSecondary,
            fontSize: 14,
            fontFamily: "DMSans_400Regular",
            textAlign: "center",
            marginBottom: 28,
            lineHeight: 21,
            maxWidth: 300,
          }}
        >
          {subtitle}
        </Text>
      )}

      {/* OTP Cells */}
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
        {Array.from({ length }).map((_, index) => {
          const isFocused = focusedIndex === index;
          const isFilled = !!code[index];
          const hasError = !!error;

          return (
            <TextInput
              key={index}
              ref={(ref) => { inputRefs.current[index] = ref; }}
              value={code[index]}
              onChangeText={(text) => handleChange(text, index)}
              onKeyPress={(e) => handleKeyPress(e, index)}
              onFocus={() => setFocusedIndex(index)}
              onBlur={() => setFocusedIndex(-1)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
              autoFocus={autoFocus && index === 0}
              editable={!loading}
              style={{
                width: 50,
                height: 58,
                borderRadius: 14,
                backgroundColor: hasError
                  ? colors.error + "08"
                  : isFocused
                    ? colors.primary[400] + "08"
                    : isFilled
                      ? tc.dark.elevated
                      : tc.dark.card,
                borderWidth: 1.5,
                borderColor: hasError
                  ? colors.error + "60"
                  : isFocused
                    ? colors.primary[400] + "60"
                    : isFilled
                      ? colors.primary[400] + "30"
                      : tc.glass.border,
                color: hasError ? colors.error : tc.textPrimary,
                fontSize: 22,
                fontFamily: "DMSans_700Bold",
                textAlign: "center",
                ...(isWeb
                  ? {
                      outlineStyle: "none",
                      caretColor: "transparent",
                      transition: "border-color 0.15s ease, background-color 0.15s ease",
                    } as any
                  : {}),
              }}
            />
          );
        })}
      </View>

      {error && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginBottom: 16,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 10,
            backgroundColor: colors.error + "10",
          }}
        >
          <Ionicons name="alert-circle" size={16} color={colors.error} />
          <Text style={{ color: colors.error, fontSize: 13, fontFamily: "DMSans_500Medium" }}>
            {error}
          </Text>
        </View>
      )}

      {loading && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Ionicons name="hourglass-outline" size={16} color={colors.primary[400]} />
          <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_500Medium" }}>
            Verifying...
          </Text>
        </View>
      )}

      {onResend && (
        <Pressable
          onPress={handleResend}
          disabled={cooldown > 0}
          style={({ pressed, hovered }: any) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 10,
            paddingHorizontal: 16,
            borderRadius: 12,
            backgroundColor: isWeb && hovered && cooldown <= 0 ? colors.primary[400] + "10" : "transparent",
            opacity: cooldown > 0 ? 0.5 : pressed ? 0.7 : 1,
            ...(isWeb && cooldown <= 0 ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
          })}
        >
          <Ionicons
            name="refresh-outline"
            size={16}
            color={cooldown > 0 ? tc.textMuted : colors.primary[400]}
          />
          <Text
            style={{
              color: cooldown > 0 ? tc.textMuted : colors.primary[400],
              fontSize: 14,
              fontFamily: "DMSans_600SemiBold",
            }}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : resendLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
