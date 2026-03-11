import { useState, useCallback } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

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
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
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
    : tc.dark.border;

  return (
    <View>
      {label && (
        <Text
          style={{
            color: tc.textSecondary,
            fontSize: 14,
            fontFamily: "DMSans_500Medium",
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
          backgroundColor: tc.dark.card,
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
            color: focused ? colors.primary[400] : tc.textMuted,
            fontSize: 22,
            fontFamily: "DMSans_700Bold",
            marginRight: 4,
          }}
        >
          KSh
        </Text>

        <TextInput
          value={displayValue}
          onChangeText={handleChange}
          placeholder="0"
          placeholderTextColor={tc.dark.muted}
          keyboardType="numeric"
          editable={!disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            color: tc.textPrimary,
            fontSize: 32,
            fontFamily: "DMSans_700Bold",
            paddingVertical: 16,
          }}
          maxLength={12}
          maxFontSizeMultiplier={1.2}
          accessibilityLabel={label}
          accessibilityHint={`Enter amount between ${minAmount.toLocaleString()} and ${maxAmount.toLocaleString()} KES`}
          accessibilityValue={{
            text: displayValue ? `${displayValue} Kenyan Shillings` : "empty",
          }}
          testID="amount-input"
        />
      </View>

      {/* Validation message */}
      {validationError && (
        <Text
          style={{
            color: colors.error,
            fontSize: 12,
            fontFamily: "DMSans_400Regular",
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
            accessibilityRole="button"
            accessibilityLabel={`${amount.toLocaleString()} KES`}
            accessibilityState={{ selected: numericValue === amount }}
            testID={`amount-pill-${amount}`}
            style={{
              flex: 1,
              backgroundColor:
                numericValue === amount
                  ? "rgba(13, 159, 110, 0.15)"
                  : tc.dark.elevated,
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
                    : tc.textSecondary,
                fontSize: 13,
                fontFamily: "DMSans_500Medium",
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
