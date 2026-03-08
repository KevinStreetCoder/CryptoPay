import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/stores/auth";
import { colors } from "../../src/constants/theme";

const KYC_TIERS = [
  { tier: 0, label: "Phone Only", limit: "KSh 5,000/day", color: colors.dark.muted },
  { tier: 1, label: "ID Verified", limit: "KSh 50,000/day", color: colors.warning },
  { tier: 2, label: "KRA PIN", limit: "KSh 250,000/day", color: colors.info },
  { tier: 3, label: "Enhanced DD", limit: "KSh 1,000,000/day", color: colors.success },
];

interface MenuItemProps {
  icon: string;
  label: string;
  subtitle?: string;
  onPress: () => void;
  danger?: boolean;
}

function MenuItem({ icon, label, subtitle, onPress, danger }: MenuItemProps) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4 py-3.5 active:bg-dark-elevated"
      style={{ minHeight: 48 }}
      accessibilityRole="button"
      accessibilityLabel={`${label}${subtitle ? `. ${subtitle}` : ""}`}
    >
      <Ionicons
        name={icon as any}
        size={22}
        color={danger ? colors.error : colors.textSecondary}
      />
      <View className="flex-1 ml-3">
        <Text
          className={`text-sm font-inter-medium ${
            danger ? "text-error" : "text-white"
          }`}
        >
          {label}
        </Text>
        {subtitle && (
          <Text className="text-textMuted text-xs font-inter">{subtitle}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.dark.muted} />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const currentTier = KYC_TIERS.find((t) => t.tier === (user?.kyc_tier ?? 0));

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/auth/login");
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-dark-bg">
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="px-5 pt-2 pb-4">
          <Text className="text-white text-2xl font-inter-bold">Profile</Text>
        </View>

        {/* User Card */}
        <View className="bg-dark-card rounded-2xl mx-4 p-5 mb-4">
          <View className="flex-row items-center mb-4">
            <View className="w-14 h-14 rounded-full bg-primary-500/20 items-center justify-center mr-4">
              <Ionicons name="person" size={28} color={colors.primary[400]} />
            </View>
            <View className="flex-1">
              <Text className="text-white text-lg font-inter-bold">
                {user?.full_name || "User"}
              </Text>
              <Text className="text-textMuted text-sm font-inter">
                {user?.phone || "+254 •••"}
              </Text>
            </View>
          </View>

          {/* KYC Status */}
          <View className="bg-dark-bg rounded-xl px-4 py-3 flex-row items-center justify-between">
            <View>
              <Text className="text-textMuted text-xs font-inter">
                Verification Level
              </Text>
              <Text
                className="text-sm font-inter-semibold mt-0.5"
                style={{ color: currentTier?.color }}
              >
                Tier {currentTier?.tier}: {currentTier?.label}
              </Text>
            </View>
            <View className="bg-dark-elevated px-3 py-1.5 rounded-lg">
              <Text className="text-textSecondary text-xs font-inter-medium">
                {currentTier?.limit}
              </Text>
            </View>
          </View>
        </View>

        {/* Menu Sections */}
        <View className="bg-dark-card rounded-2xl mx-4 mb-4 overflow-hidden">
          <MenuItem
            icon="shield-checkmark-outline"
            label="Verify Identity"
            subtitle="Upgrade your limits"
            onPress={() => {}}
          />
          <View className="h-px bg-dark-border ml-14" />
          <MenuItem
            icon="lock-closed-outline"
            label="Change PIN"
            subtitle="Update your security PIN"
            onPress={() => {}}
          />
          <View className="h-px bg-dark-border ml-14" />
          <MenuItem
            icon="finger-print-outline"
            label="Biometric Login"
            subtitle="Use fingerprint or Face ID"
            onPress={() => {}}
          />
        </View>

        <View className="bg-dark-card rounded-2xl mx-4 mb-4 overflow-hidden">
          <MenuItem
            icon="help-circle-outline"
            label="Help & Support"
            onPress={() => {}}
          />
          <View className="h-px bg-dark-border ml-14" />
          <MenuItem
            icon="document-text-outline"
            label="Terms of Service"
            onPress={() => {}}
          />
          <View className="h-px bg-dark-border ml-14" />
          <MenuItem
            icon="shield-outline"
            label="Privacy Policy"
            onPress={() => {}}
          />
        </View>

        <View className="bg-dark-card rounded-2xl mx-4 mb-4 overflow-hidden">
          <MenuItem
            icon="log-out-outline"
            label="Logout"
            onPress={handleLogout}
            danger
          />
        </View>

        <Text
          className="text-textMuted text-xs font-inter text-center mt-2 mb-6"
          maxFontSizeMultiplier={1.3}
          accessibilityLabel="M-Crypto version 1.0.0"
        >
          M-Crypto v1.0.0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
