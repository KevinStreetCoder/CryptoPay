import { useState, useCallback } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import * as Haptics from "expo-haptics";
import { colors } from "../constants/theme";

interface AmountInputProps {
  value: string;
  onChangeValue: (value: string) => void;
  minAmount?: number;
  maxAmount?: number;
  label?: string;
  error?: string;
  disabled?: boolean;
}

function formatWithCommas(value: string): string {
  const num = value.replace(/[^0-9]/g, "");
  if (!num) return "";
  return parseInt(num, 10).toLocaleString("en-KE");
}

function stripCommas(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

export function AmountInput({
  value,
  onChangeValue,
  minAmount = 10,
  maxAmount = 250000,
  label = "Amount (KES)",
  error: externalError,
  disabled = false,
}: AmountInputProps) {
  const [focused, setFocused] = useState(false);

  const numericValue = parseInt(stripCommas(value) || "0", 10);

  const validationError = (() => {
    if (externalError) return externalError;
    if (!value || numericValue === 0) return undefined;
    if (numericValue < minAmount) return `Minimum amount is KSh ${minAmount.toLocaleString()}`;
    if (numericValue > maxAmount) return `Maximum amount is KSh ${maxAmount.toLocaleString()}`;
    return undefined;
  })();

  const handleChange = useCallback(
    (text: string) => {
      const raw = text.replace(/[^0-9]/g, "");
      // Limit to reasonable digits
      if (raw.length > 9) return;

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onChangeValue(raw);
    },
    [onChangeValue]
  );

  const displayValue = formatWithCommas(value);

  const borderColor = validationError
    ? colors.error
    : focused
    ? colors.primary[500]
    : colors.dark.border;

  return (
    <View>
      {label && (
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: 14,
            fontFamily: "Inter_500Medium",
            marginBottom: 8,
          }}
        >
          {label}
        </Text>
      )}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: colors.dark.card,
          borderRadius: 16,
          borderWidth: 1.5,
          borderColor,
          paddingHorizontal: 16,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {/* KSh prefix */}
        <Text
          style={{
            color: focused ? colors.primary[400] : colors.textMuted,
            fontSize: 22,
            fontFamily: "Inter_700Bold",
            marginRight: 4,
          }}
        >
          KSh
        </Text>

        <TextInput
          value={displayValue}
          onChangeText={handleChange}
          placeholder="0"
          placeholderTextColor={colors.dark.muted}
          keyboardType="numeric"
          editable={!disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            color: "#FFFFFF",
            fontSize: 32,
            fontFamily: "Inter_700Bold",
            paddingVertical: 16,
          }}
          maxLength={12}
        />
      </View>

      {/* Validation message */}
      {validationError && (
        <Text
          style={{
            color: colors.error,
            fontSize: 12,
            fontFamily: "Inter_400Regular",
            marginTop: 6,
            marginLeft: 4,
          }}
        >
          {validationError}
        </Text>
      )}

      {/* Quick amount pills */}
      <View
        style={{
          flexDirection: "row",
          marginTop: 12,
          gap: 8,
        }}
      >
        {[500, 1000, 2500, 5000].map((amount) => (
          <Pressable
            key={amount}
            onPress={() => {
              if (disabled) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onChangeValue(amount.toString());
            }}
            style={{
              flex: 1,
              backgroundColor:
                numericValue === amount
                  ? "rgba(13, 159, 110, 0.15)"
                  : colors.dark.elevated,
              borderRadius: 10,
              paddingVertical: 8,
              alignItems: "center",
              borderWidth: numericValue === amount ? 1 : 0,
              borderColor: colors.primary[500],
            }}
          >
            <Text
              style={{
                color:
                  numericValue === amount
                    ? colors.primary[400]
                    : colors.textSecondary,
                fontSize: 13,
                fontFamily: "Inter_500Medium",
              }}
            >
              {amount.toLocaleString()}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
