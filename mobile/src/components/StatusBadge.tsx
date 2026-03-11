import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type TransactionStatus = "completed" | "pending" | "failed" | "processing" | "reversed";

interface StatusBadgeProps {
  status: TransactionStatus | string;
  size?: "sm" | "md";
}

const STATUS_CONFIG: Record<
  string,
  { bg: string; text: string; icon: string; label: string }
> = {
  completed: {
    bg: "rgba(16, 185, 129, 0.15)",
    text: "#10B981",
    icon: "checkmark-circle",
    label: "Completed",
  },
  pending: {
    bg: "rgba(245, 158, 11, 0.15)",
    text: "#F59E0B",
    icon: "time-outline",
    label: "Pending",
  },
  processing: {
    bg: "rgba(59, 130, 246, 0.15)",
    text: "#3B82F6",
    icon: "sync-outline",
    label: "Processing",
  },
  failed: {
    bg: "rgba(239, 68, 68, 0.15)",
    text: "#EF4444",
    icon: "close-circle",
    label: "Failed",
  },
  reversed: {
    bg: "rgba(100, 116, 139, 0.15)",
    text: "#64748B",
    icon: "return-down-back-outline",
    label: "Reversed",
  },
};

export function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;

  const isSmall = size === "sm";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: config.bg,
        borderRadius: isSmall ? 8 : 10,
        paddingHorizontal: isSmall ? 8 : 12,
        paddingVertical: isSmall ? 4 : 6,
        gap: 4,
        alignSelf: "flex-start",
      }}
    >
      <Ionicons
        name={config.icon as any}
        size={isSmall ? 12 : 14}
        color={config.text}
      />
      <Text
        style={{
          color: config.text,
          fontSize: isSmall ? 11 : 13,
          fontFamily: "DMSans_500Medium",
        }}
      >
        {config.label}
      </Text>
    </View>
  );
}
