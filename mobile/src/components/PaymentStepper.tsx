/**
 * PaymentStepper — compact 3-step progress indicator for payment flow.
 * Steps: Details → Confirm → Done
 */
import { View, Text, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

interface PaymentStepperProps {
  /** 0 = Details, 1 = Confirm, 2 = Done */
  currentStep: number;
}

const STEPS = [
  { label: "Details" },
  { label: "Confirm" },
  { label: "Done" },
];

export function PaymentStepper({ currentStep }: PaymentStepperProps) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 0,
      }}
    >
      {STEPS.map((step, i) => {
        const isActive = i === currentStep;
        const isCompleted = i < currentStep;
        const textColor = isCompleted || isActive ? tc.textPrimary : tc.textMuted;

        return (
          <View key={i} style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ alignItems: "center", gap: 2 }}>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: isCompleted ? colors.primary[500] : isActive ? colors.primary[500] + "20" : tc.dark.elevated,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: isActive ? 1.5 : 0,
                  borderColor: isActive ? colors.primary[500] : "transparent",
                }}
              >
                {isCompleted ? (
                  <Ionicons name="checkmark" size={13} color="#FFFFFF" />
                ) : (
                  <Text
                    style={{
                      color: isActive ? colors.primary[400] : tc.textMuted,
                      fontSize: 11,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                  >
                    {i + 1}
                  </Text>
                )}
              </View>
              <Text
                style={{
                  color: textColor,
                  fontSize: 9,
                  fontFamily: isActive ? "DMSans_600SemiBold" : "DMSans_400Regular",
                }}
              >
                {step.label}
              </Text>
            </View>

            {i < STEPS.length - 1 && (
              <View
                style={{
                  width: 24,
                  height: 1.5,
                  backgroundColor: i < currentStep ? colors.primary[500] : tc.dark.elevated,
                  marginHorizontal: 4,
                  borderRadius: 1,
                  marginBottom: 14,
                }}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}
