import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  useWindowDimensions,
  Image,
  ActivityIndicator,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "../../src/stores/auth";
import { authApi } from "../../src/api/auth";
import { useToast } from "../../src/components/Toast";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { config } from "../../src/constants/config";
import { normalizeError } from "../../src/utils/apiErrors";
import { useLocale } from "../../src/hooks/useLocale";
import { Image as ExpoImage } from "expo-image";
import { UserAvatar } from "../../src/components/UserAvatar";

const isWeb = Platform.OS === "web";

type Step = "edit" | "pin" | "email-verify" | "success";

function resolveAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base = config.apiUrl.replace(/\/api\/v1\/?$/, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

function getInitials(name: string | undefined): string {
  return (name || "U")
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "N/A";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "N/A";
  }
}

const KYC_LABEL_KEYS = ["editProfile.unverified", "editProfile.basic", "editProfile.intermediate", "editProfile.advanced"] as const;

function getKYCLabelKey(tier: number | undefined): string {
  return KYC_LABEL_KEYS[tier ?? 0] || KYC_LABEL_KEYS[0];
}

function getKYCColor(tier: number | undefined): string {
  switch (tier) {
    case 1:
      return colors.info;
    case 2:
      return colors.warning;
    case 3:
      return colors.success;
    default:
      return colors.textMuted;
  }
}

// ── Edit Form Step ───────────────────────────────────────────────────────────
function EditFormStep({
  fullName,
  setFullName,
  email,
  setEmail,
  phone,
  avatarUri,
  avatarUrl,
  kycTier,
  memberSince,
  emailVerified,
  isDesktop,
  isTablet,
  tc,
  ts,
  onPickImage,
  onSubmit,
  nameFocused,
  setNameFocused,
  emailFocused,
  setEmailFocused,
  onVerifyEmail,
  userEmail,
}: {
  fullName: string;
  setFullName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  phone: string;
  avatarUri: string | null;
  avatarUrl: string | null;
  kycTier: number;
  memberSince: string;
  emailVerified: boolean;
  isDesktop: boolean;
  isTablet: boolean;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
  onPickImage: () => void;
  onSubmit: () => void;
  nameFocused: boolean;
  setNameFocused: (v: boolean) => void;
  emailFocused: boolean;
  setEmailFocused: (v: boolean) => void;
  onVerifyEmail?: () => void;
  userEmail?: string;
}) {
  const avatarSize = isDesktop ? 120 : 100;
  const displayAvatar = avatarUri || avatarUrl;
  const { t } = useLocale();
  const initials = getInitials(fullName);
  const useColumns = isDesktop || isTablet;

  const inputStyle = (focused: boolean) => ({
    backgroundColor: tc.dark.elevated,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: focused ? colors.primary[500] + "80" : tc.glass.border,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "web" ? 14 : 12,
    fontSize: 15,
    fontFamily: "DMSans_500Medium",
    color: tc.textPrimary,
    ...(isWeb
      ? ({
          outlineStyle: "none",
          transition: "all 0.2s ease",
          boxShadow: focused
            ? `0 0 0 3px ${colors.primary[500]}25`
            : "none",
        } as any)
      : {}),
  });

  return (
    <>
      {/* Avatar Section */}
      <View
        style={{
          alignItems: "center",
          marginBottom: isDesktop ? 36 : 28,
        }}
      >
        <Pressable
          onPress={onPickImage}
          style={({ pressed, hovered }: any) => ({
            position: "relative",
            opacity: pressed ? 0.85 : 1,
            ...(isWeb
              ? ({
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  transform: hovered ? "scale(1.03)" : "scale(1)",
                } as any)
              : {}),
          })}
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
        >
          {displayAvatar ? (
            <ExpoImage
              source={displayAvatar}
              style={{
                width: avatarSize,
                height: avatarSize,
                borderRadius: avatarSize / 2,
                borderWidth: 3,
                borderColor: colors.primary[500] + "50",
              }}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={200}
            />
          ) : (
            <UserAvatar
              fullName={fullName}
              size={avatarSize}
              borderRadius={avatarSize / 2}
              borderWidth={3}
            />
          )}
          {/* Camera badge */}
          <View
            style={{
              position: "absolute",
              bottom: 2,
              right: 2,
              width: 34,
              height: 34,
              borderRadius: 17,
              backgroundColor: colors.primary[500],
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 3,
              borderColor: tc.dark.bg,
              ...ts.sm,
            }}
          >
            <Ionicons name="camera" size={16} color="#FFFFFF" />
          </View>
        </Pressable>
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 13,
            fontFamily: "DMSans_500Medium",
            marginTop: 12,
          }}
        >
          {t("editProfile.tapToChangePhoto")}
        </Text>
      </View>

      {/* Editable Fields Card */}
      <View
        style={{
          backgroundColor: tc.dark.card,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: tc.glass.border,
          padding: isDesktop ? 28 : 20,
          marginBottom: 20,
          ...ts.sm,
        }}
      >
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 16,
            fontFamily: "DMSans_700Bold",
            marginBottom: 20,
            letterSpacing: -0.2,
          }}
        >
          {t("editProfile.personalInfo")}
        </Text>

        <View
          style={
            useColumns
              ? { flexDirection: "row", gap: 16, marginBottom: 0 }
              : {}
          }
        >
          {/* Full Name */}
          <View style={{ flex: useColumns ? 1 : undefined, marginBottom: 16 }}>
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 13,
                fontFamily: "DMSans_600SemiBold",
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {t("editProfile.fullName")}
            </Text>
            <TextInput
              value={fullName}
              onChangeText={(text) => setFullName(text.replace(/[^a-zA-Z\u00C0-\u024F\s'\-\.]/g, ""))}
              onFocus={() => setNameFocused(true)}
              onBlur={() => setNameFocused(false)}
              placeholder="Enter your full name"
              placeholderTextColor={tc.textMuted}
              style={inputStyle(nameFocused)}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={50}
            />
          </View>

          {/* Email */}
          <View style={{ flex: useColumns ? 1 : undefined, marginBottom: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 13,
                  fontFamily: "DMSans_600SemiBold",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                {t("editProfile.emailAddress")}
              </Text>
              {email ? (
                emailVerified ? (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      backgroundColor: colors.success + "15",
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 8,
                    }}
                  >
                    <Ionicons name="checkmark-circle" size={12} color={colors.success} />
                    <Text style={{ color: colors.success, fontSize: 11, fontFamily: "DMSans_600SemiBold" }}>
                      {t("editProfile.verified")}
                    </Text>
                  </View>
                ) : (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      backgroundColor: colors.warning + "15",
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 8,
                    }}
                  >
                    <Ionicons name="alert-circle" size={12} color={colors.warning} />
                    <Text style={{ color: colors.warning, fontSize: 11, fontFamily: "DMSans_600SemiBold" }}>
                      {t("editProfile.notVerified")}
                    </Text>
                  </View>
                )
              ) : null}
            </View>
            <TextInput
              value={email}
              onChangeText={setEmail}
              onFocus={() => setEmailFocused(true)}
              onBlur={() => setEmailFocused(false)}
              placeholder="Enter your email"
              placeholderTextColor={tc.textMuted}
              style={inputStyle(emailFocused)}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {email && !emailVerified ? (
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6, gap: 8 }}>
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 12,
                    fontFamily: "DMSans_400Regular",
                    lineHeight: 17,
                    flex: 1,
                  }}
                >
                  {email === (userEmail || "")
                    ? "Email not verified."
                    : "A verification email will be sent when you save changes."}
                </Text>
                {email === (userEmail || "") && onVerifyEmail ? (
                  <Pressable onPress={onVerifyEmail}>
                    <Text
                      style={{
                        color: colors.warning,
                        fontSize: 12,
                        fontFamily: "DMSans_600SemiBold",
                      }}
                    >
                      Verify Now
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {/* Account Info Card (read-only) */}
      <View
        style={{
          backgroundColor: tc.dark.card,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: tc.glass.border,
          padding: isDesktop ? 28 : 20,
          marginBottom: 28,
          ...ts.sm,
        }}
      >
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 16,
            fontFamily: "DMSans_700Bold",
            marginBottom: 20,
            letterSpacing: -0.2,
          }}
        >
          Account Details
        </Text>

        <View
          style={
            useColumns
              ? { flexDirection: "row", flexWrap: "wrap", gap: 16 }
              : {}
          }
        >
          {/* Phone */}
          <InfoRow
            icon="call-outline"
            label={t("payment.phoneNumber")}
            value={phone || t("common.notSet")}
            badge={null}
            isDesktop={isDesktop}
            useColumns={useColumns}
            tc={tc}
          />

          {/* KYC Tier */}
          <InfoRow
            icon="shield-checkmark-outline"
            label={t("editProfile.kycLevel")}
            value={t(getKYCLabelKey(kycTier) as any)}
            badge={{ text: `Tier ${kycTier}`, color: getKYCColor(kycTier) }}
            isDesktop={isDesktop}
            useColumns={useColumns}
            tc={tc}
          />

          {/* Member Since */}
          <InfoRow
            icon="calendar-outline"
            label={t("editProfile.memberSince")}
            value={formatDate(memberSince)}
            badge={null}
            isDesktop={isDesktop}
            useColumns={useColumns}
            tc={tc}
          />
        </View>
      </View>

      {/* Save Button */}
      <View style={{ alignItems: isDesktop ? "flex-start" : "stretch", maxWidth: isDesktop ? 280 : undefined }}>
        <Pressable
          onPress={onSubmit}
          style={({ pressed, hovered }: any) => ({
            flexDirection: "row" as const,
            backgroundColor: hovered
              ? colors.primary[400]
              : colors.primary[500],
            borderRadius: 16,
            paddingVertical: 16,
            paddingHorizontal: 32,
            alignItems: "center" as const,
            justifyContent: "center" as const,
            width: "100%" as any,
            gap: 8,
            opacity: pressed ? 0.9 : 1,
            ...ts.md,
            ...(isWeb
              ? ({
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  transform: pressed
                    ? "scale(0.97)"
                    : hovered
                      ? "translateY(-1px)"
                      : "translateY(0px)",
                } as any)
              : {}),
          })}
          accessibilityRole="button"
          accessibilityLabel="Save changes"
        >
          <Ionicons name="checkmark-circle-outline" size={20} color="#FFFFFF" />
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 16,
              fontFamily: "DMSans_700Bold",
              letterSpacing: 0.3,
            }}
          >
            Save Changes
          </Text>
        </Pressable>
      </View>
    </>
  );
}

// ── Info Row ─────────────────────────────────────────────────────────────────
function InfoRow({
  icon,
  label,
  value,
  badge,
  isDesktop,
  useColumns,
  tc,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  badge: { text: string; color: string } | null;
  isDesktop: boolean;
  useColumns: boolean;
  tc: ReturnType<typeof getThemeColors>;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 14,
        borderBottomWidth: useColumns ? 0 : 1,
        borderBottomColor: tc.glass.border,
        flex: useColumns ? 1 : undefined,
        minWidth: useColumns ? 220 : undefined,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: tc.glass.highlight,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: tc.glass.border,
        }}
      >
        <Ionicons name={icon} size={18} color={tc.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 12,
            fontFamily: "DMSans_500Medium",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {label}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 15,
              fontFamily: "DMSans_600SemiBold",
            }}
          >
            {value}
          </Text>
          {badge && (
            <View
              style={{
                backgroundColor: badge.color + "18",
                borderRadius: 8,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}
            >
              <Text
                style={{
                  color: badge.color,
                  fontSize: 11,
                  fontFamily: "DMSans_700Bold",
                }}
              >
                {badge.text}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// ── PIN Verification Step ────────────────────────────────────────────────────
function PinStep({
  pin,
  setPin,
  error,
  loading,
  onCancel,
  onSubmit,
  isDesktop,
  tc,
  ts,
}: {
  pin: string[];
  setPin: (p: string[]) => void;
  error: string;
  loading: boolean;
  onCancel: () => void;
  onSubmit: (completedPin?: string[]) => void;
  isDesktop: boolean;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
}) {
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const handlePinChange = (text: string, index: number) => {
    // Only allow digits
    const digit = text.replace(/[^0-9]/g, "").slice(-1);
    const newPin = [...pin];
    newPin[index] = digit;
    setPin(newPin);

    // Auto-advance
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered — pass newPin directly
    // because React state hasn't flushed yet at this point
    if (digit && index === 5 && newPin.every((d) => d !== "")) {
      onSubmit(newPin);
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === "Backspace" && !pin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      const newPin = [...pin];
      newPin[index - 1] = "";
      setPin(newPin);
    }
  };

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 20,
      }}
    >
      <View
        style={{
          backgroundColor: tc.dark.card,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: tc.glass.border,
          padding: isDesktop ? 40 : 28,
          width: "100%",
          maxWidth: 420,
          alignItems: "center",
          ...ts.md,
        }}
      >
        {/* Lock Icon */}
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            backgroundColor: colors.primary[500] + "15",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}
        >
          <Ionicons name="lock-closed" size={28} color={colors.primary[400]} />
        </View>

        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 22,
            fontFamily: "DMSans_700Bold",
            textAlign: "center",
            letterSpacing: -0.3,
            marginBottom: 8,
          }}
        >
          Verify Your Identity
        </Text>
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 14,
            fontFamily: "DMSans_500Medium",
            textAlign: "center",
            lineHeight: 21,
            marginBottom: 32,
            maxWidth: 280,
          }}
        >
          Enter your PIN to confirm profile changes
        </Text>

        {/* PIN Inputs */}
        <View
          style={{
            flexDirection: "row",
            gap: isDesktop ? 12 : 10,
            marginBottom: error ? 16 : 32,
          }}
        >
          {pin.map((digit, i) => (
            <TextInput
              key={i}
              ref={(ref) => {
                inputRefs.current[i] = ref;
              }}
              value={digit ? "\u2022" : ""}
              onChangeText={(text) => handlePinChange(text, i)}
              onKeyPress={(e) => handleKeyPress(e, i)}
              maxLength={1}
              keyboardType="number-pad"
              secureTextEntry={false}
              autoFocus={i === 0}
              style={{
                width: isDesktop ? 52 : 46,
                height: isDesktop ? 58 : 52,
                borderRadius: 14,
                borderWidth: 2,
                borderColor: digit
                  ? colors.primary[500]
                  : error
                    ? colors.error + "60"
                    : tc.glass.borderStrong,
                backgroundColor: digit
                  ? colors.primary[500] + "10"
                  : tc.dark.elevated,
                textAlign: "center",
                fontSize: 22,
                fontFamily: "DMSans_700Bold",
                color: tc.textPrimary,
                ...(isWeb
                  ? ({
                      outlineStyle: "none",
                      transition: "all 0.15s ease",
                      boxShadow: digit
                        ? `0 0 0 3px ${colors.primary[500]}20`
                        : "none",
                    } as any)
                  : {}),
              }}
            />
          ))}
        </View>

        {/* Error */}
        {error ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginBottom: 24,
              backgroundColor: colors.error + "12",
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 10,
            }}
          >
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text
              style={{
                color: colors.error,
                fontSize: 13,
                fontFamily: "DMSans_500Medium",
              }}
            >
              {error}
            </Text>
          </View>
        ) : null}

        {/* Loading */}
        {loading && (
          <ActivityIndicator
            size="small"
            color={colors.primary[500]}
            style={{ marginBottom: 24 }}
          />
        )}

        {/* Cancel Button */}
        <Pressable
          onPress={onCancel}
          disabled={loading}
          style={({ pressed, hovered }: any) => ({
            paddingVertical: 12,
            paddingHorizontal: 28,
            borderRadius: 12,
            backgroundColor: hovered
              ? tc.glass.highlight
              : "transparent",
            borderWidth: 1,
            borderColor: tc.glass.border,
            opacity: pressed ? 0.8 : loading ? 0.5 : 1,
            ...(isWeb
              ? ({
                  cursor: loading ? "not-allowed" : "pointer",
                  transition: "all 0.2s ease",
                } as any)
              : {}),
          })}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 15,
              fontFamily: "DMSans_600SemiBold",
            }}
          >
            Cancel
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Success Step ─────────────────────────────────────────────────────────────
function SuccessStep({
  isDesktop,
  tc,
  ts,
}: {
  isDesktop: boolean;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
}) {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 60,
        friction: 8,
        useNativeDriver: Platform.OS !== "web",
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: Platform.OS !== "web",
      }),
    ]).start();
  }, []);

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 20,
      }}
    >
      <Animated.View
        style={{
          alignItems: "center",
          opacity: opacityAnim,
          transform: [{ scale: scaleAnim }],
        }}
      >
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: colors.success + "18",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
            ...ts.md,
          }}
        >
          <Ionicons name="checkmark-circle" size={44} color={colors.success} />
        </View>
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 24,
            fontFamily: "DMSans_700Bold",
            textAlign: "center",
            letterSpacing: -0.3,
            marginBottom: 8,
          }}
        >
          Profile Updated
        </Text>
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 15,
            fontFamily: "DMSans_500Medium",
            textAlign: "center",
            lineHeight: 22,
          }}
        >
          Your changes have been saved successfully.
        </Text>
      </Animated.View>
    </View>
  );
}

// ── Email Verify Step ────────────────────────────────────────────────────────
function EmailVerifyStep({
  email,
  isDesktop,
  tc,
  ts,
  onVerified,
  onSkip,
}: {
  email: string;
  isDesktop: boolean;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
  onVerified: () => void;
  onSkip: () => void;
}) {
  const [otp, setOtp] = useState<string[]>(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleOtpChange = (text: string, index: number) => {
    const digit = text.replace(/[^0-9]/g, "").slice(-1);
    const newOtp = [...otp];
    newOtp[index] = digit;
    setOtp(newOtp);

    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (digit && index === 5 && newOtp.every((d) => d !== "")) {
      handleVerify(newOtp);
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      const newOtp = [...otp];
      newOtp[index - 1] = "";
      setOtp(newOtp);
    }
  };

  const handleVerify = async (completedOtp?: string[]) => {
    const otpArray = completedOtp || otp;
    const code = otpArray.join("");
    if (code.length < 6) {
      setError("Please enter all 6 digits");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await authApi.confirmEmailVerification(code);
      onVerified();
    } catch (err) {
      const appError = normalizeError(err);
      setError(appError.message);
      setOtp(["", "", "", "", "", ""]);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setResending(true);
    try {
      await authApi.sendEmailVerification(email);
      setResendCooldown(60);
      setError("");
      setOtp(["", "", "", "", "", ""]);
    } catch (err) {
      const appError = normalizeError(err);
      setError(appError.message);
    } finally {
      setResending(false);
    }
  };

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 20,
      }}
    >
      <View
        style={{
          backgroundColor: tc.dark.card,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: tc.glass.border,
          padding: isDesktop ? 40 : 28,
          width: "100%",
          maxWidth: 440,
          alignItems: "center",
          ...ts.md,
        }}
      >
        {/* Mail Icon */}
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            backgroundColor: colors.info + "15",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}
        >
          <Ionicons name="mail" size={28} color={colors.info} />
        </View>

        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 22,
            fontFamily: "DMSans_700Bold",
            textAlign: "center",
            letterSpacing: -0.3,
            marginBottom: 8,
          }}
        >
          Verify Your Email
        </Text>
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 14,
            fontFamily: "DMSans_500Medium",
            textAlign: "center",
            lineHeight: 21,
            marginBottom: 8,
            maxWidth: 300,
          }}
        >
          Enter the 6-digit code sent to
        </Text>
        <Text
          style={{
            color: colors.primary[400],
            fontSize: 14,
            fontFamily: "DMSans_600SemiBold",
            textAlign: "center",
            marginBottom: 28,
          }}
        >
          {email}
        </Text>

        {/* OTP Inputs */}
        <View
          style={{
            flexDirection: "row",
            gap: isDesktop ? 12 : 10,
            marginBottom: error ? 16 : 28,
          }}
        >
          {otp.map((digit, i) => (
            <TextInput
              key={i}
              ref={(ref) => {
                inputRefs.current[i] = ref;
              }}
              value={digit}
              onChangeText={(text) => handleOtpChange(text, i)}
              onKeyPress={(e) => handleKeyPress(e, i)}
              maxLength={1}
              keyboardType="number-pad"
              autoFocus={i === 0}
              style={{
                width: isDesktop ? 52 : 46,
                height: isDesktop ? 58 : 52,
                borderRadius: 14,
                borderWidth: 2,
                borderColor: digit
                  ? colors.primary[500]
                  : error
                    ? colors.error + "60"
                    : tc.glass.borderStrong,
                backgroundColor: digit
                  ? colors.primary[500] + "10"
                  : tc.dark.elevated,
                textAlign: "center",
                fontSize: 22,
                fontFamily: "DMSans_700Bold",
                color: tc.textPrimary,
                ...(isWeb
                  ? ({
                      outlineStyle: "none",
                      transition: "all 0.15s ease",
                      boxShadow: digit
                        ? `0 0 0 3px ${colors.primary[500]}20`
                        : "none",
                    } as any)
                  : {}),
              }}
            />
          ))}
        </View>

        {/* Error */}
        {error ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginBottom: 20,
              backgroundColor: colors.error + "12",
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 10,
            }}
          >
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text
              style={{
                color: colors.error,
                fontSize: 13,
                fontFamily: "DMSans_500Medium",
              }}
            >
              {error}
            </Text>
          </View>
        ) : null}

        {/* Loading */}
        {loading ? (
          <ActivityIndicator
            size="small"
            color={colors.primary[500]}
            style={{ marginBottom: 20 }}
          />
        ) : null}

        {/* Resend */}
        <Pressable
          onPress={handleResend}
          disabled={resendCooldown > 0 || resending}
          style={({ pressed }: any) => ({
            paddingVertical: 8,
            opacity: pressed ? 0.7 : resendCooldown > 0 ? 0.5 : 1,
            marginBottom: 16,
          })}
        >
          <Text
            style={{
              color: resendCooldown > 0 ? tc.textMuted : colors.primary[400],
              fontSize: 14,
              fontFamily: "DMSans_600SemiBold",
              textAlign: "center",
            }}
          >
            {resending
              ? "Sending..."
              : resendCooldown > 0
                ? `Resend code in ${resendCooldown}s`
                : "Resend code"}
          </Text>
        </Pressable>

        {/* Skip / Verify Later */}
        <Pressable
          onPress={onSkip}
          disabled={loading}
          style={({ pressed, hovered }: any) => ({
            paddingVertical: 12,
            paddingHorizontal: 28,
            borderRadius: 12,
            backgroundColor: hovered
              ? tc.glass.highlight
              : "transparent",
            borderWidth: 1,
            borderColor: tc.glass.border,
            opacity: pressed ? 0.8 : loading ? 0.5 : 1,
            ...(isWeb
              ? ({
                  cursor: loading ? "not-allowed" : "pointer",
                  transition: "all 0.2s ease",
                } as any)
              : {}),
          })}
          accessibilityRole="button"
          accessibilityLabel="Skip email verification"
        >
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 15,
              fontFamily: "DMSans_600SemiBold",
            }}
          >
            Verify Later
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────────────
export default function EditProfileScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const isTablet = isWeb && width >= 600 && width < 900;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { user, refreshProfile } = useAuth();
  const toast = useToast();
  const { t } = useLocale();
  const params = useLocalSearchParams<{ verify?: string }>();

  const [step, setStep] = useState<Step>("edit");
  const [fullName, setFullName] = useState(user?.full_name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<any>(null);
  const [pin, setPin] = useState<string[]>(["", "", "", "", "", ""]);
  const [pinError, setPinError] = useState("");
  const [loading, setLoading] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);

  // Handle ?verify=1 param — jump straight to email verification
  useEffect(() => {
    if (params.verify && user?.email && !user?.email_verified) {
      setEmail(user.email);
      setStep("email-verify");
    }
  }, [params.verify, user?.email, user?.email_verified]);

  const phone = user?.phone || "";
  const kycTier = user?.kyc_tier ?? 0;
  const memberSince = user?.created_at || "";
  const avatarUrl = resolveAvatarUrl(user?.avatar_url);

  // Fade-in animation for page
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, []);

  const handlePickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        toast.warning("Permission Required", "Please allow access to your photo library.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setAvatarUri(asset.uri);

        if (isWeb) {
          // On web, fetch the blob and create a File
          const response = await fetch(asset.uri);
          const blob = await response.blob();
          const file = new File([blob], "avatar.jpg", { type: "image/jpeg" });
          setAvatarFile(file);
        } else {
          // On native, store metadata for FormData
          const uriParts = asset.uri.split(".");
          const ext = uriParts[uriParts.length - 1] || "jpg";
          setAvatarFile({
            uri: asset.uri,
            type: `image/${ext === "png" ? "png" : "jpeg"}`,
            name: `avatar.${ext}`,
          });
        }
      }
    } catch (err) {
      toast.error("Error", "Failed to pick image. Please try again.");
    }
  };

  const handleSavePress = () => {
    // Validate
    if (!fullName.trim()) {
      toast.warning("Missing Name", "Please enter your full name.");
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.warning("Invalid Email", "Please enter a valid email address.");
      return;
    }

    // Check if anything changed
    const nameChanged = fullName.trim() !== (user?.full_name || "");
    const emailChanged = email.trim() !== (user?.email || "");
    const avatarChanged = !!avatarFile;

    if (!nameChanged && !emailChanged && !avatarChanged) {
      toast.info("No Changes", "You haven't made any changes to save.");
      return;
    }

    // PIN only required for name/email changes, not avatar-only
    if (nameChanged || emailChanged) {
      setStep("pin");
      setPinError("");
      setPin(["", "", "", "", "", ""]);
    } else {
      // Avatar-only change — submit directly without PIN
      submitProfileUpdate();
    }
  };

  const submitProfileUpdate = async (pinStr?: string) => {
    setLoading(true);
    setPinError("");

    try {
      const formData = new FormData();
      if (pinStr) {
        formData.append("pin", pinStr);
      }
      // Only send changed fields to avoid unnecessary PIN requirement
      const nameChanged = fullName.trim() !== (user?.full_name || "");
      const emailChanged = email.trim() !== (user?.email || "");
      if (nameChanged) {
        formData.append("full_name", fullName.trim());
      }
      if (emailChanged) {
        formData.append("email", email.trim());
      }
      if (avatarFile) {
        formData.append("avatar", avatarFile);
      }

      const res = await authApi.updateProfile(formData);

      // Refresh user data in auth store
      await refreshProfile();

      // Check if email verification was sent
      const emailVerificationSent = (res.data as any)?.email_verification_sent;

      if (emailVerificationSent) {
        // Go to email verification step
        setStep("email-verify");
      } else {
        setStep("success");
        // Navigate back after brief delay
        setTimeout(() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace("/settings" as any);
          }
        }, 1800);
      }
    } catch (err) {
      const appError = normalizeError(err);
      if (step === "pin") {
        setPinError(appError.message);
        // Clear PIN on error so user can re-enter
        setPin(["", "", "", "", "", ""]);
      } else {
        toast.error("Update Failed", appError.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePinSubmit = async (completedPin?: string[]) => {
    // Use the passed-in pin array (from auto-submit) or fall back to state
    const pinArray = completedPin || pin;
    const pinStr = pinArray.join("");
    if (pinStr.length < 6) {
      setPinError("Please enter all 6 digits");
      return;
    }

    await submitProfileUpdate(pinStr);
  };

  const horizontalPadding = isDesktop ? 48 : isTablet ? 32 : 20;

  const navigateBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/settings" as any);
    }
  };

  const handleEmailVerified = async () => {
    await refreshProfile();
    setStep("success");
    setTimeout(navigateBack, 1800);
  };

  const handleSkipVerification = () => {
    toast.info("Verify Later", "You can verify your email from Settings anytime.");
    navigateBack();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {step === "success" ? (
          <SuccessStep isDesktop={isDesktop} tc={tc} ts={ts} />
        ) : step === "email-verify" ? (
          <EmailVerifyStep
            email={email.trim()}
            isDesktop={isDesktop}
            tc={tc}
            ts={ts}
            onVerified={handleEmailVerified}
            onSkip={handleSkipVerification}
          />
        ) : step === "pin" ? (
          <>
            {/* Header for PIN step */}
            <View
              style={{
                paddingHorizontal: horizontalPadding,
                paddingTop: isDesktop ? 12 : 8,
              }}
            >
              <Pressable
                onPress={() => {
                  setStep("edit");
                  setPin(["", "", "", "", "", ""]);
                  setPinError("");
                }}
                style={({ pressed, hovered }: any) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  backgroundColor: hovered
                    ? tc.glass.highlight
                    : pressed
                      ? tc.dark.elevated
                      : "transparent",
                  alignSelf: "flex-start",
                  opacity: pressed ? 0.9 : 1,
                  ...(isWeb
                    ? ({
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        transform: hovered
                          ? "translateX(-2px)"
                          : "translateX(0px)",
                      } as any)
                    : {}),
                })}
                accessibilityRole="button"
                accessibilityLabel="Go back to edit form"
              >
                <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 15,
                    fontFamily: "DMSans_500Medium",
                  }}
                >
                  Back
                </Text>
              </Pressable>
            </View>
            <PinStep
              pin={pin}
              setPin={setPin}
              error={pinError}
              loading={loading}
              onCancel={() => {
                setStep("edit");
                setPin(["", "", "", "", "", ""]);
                setPinError("");
              }}
              onSubmit={handlePinSubmit}
              isDesktop={isDesktop}
              tc={tc}
              ts={ts}
            />
          </>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: horizontalPadding,
              paddingTop: isDesktop ? 12 : 8,
              paddingBottom: 40,
            }}
          >
            {/* Back Button */}
            <Pressable
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace("/settings" as any);
              }}
              style={({ pressed, hovered }: any) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 12,
                backgroundColor: hovered
                  ? tc.glass.highlight
                  : pressed
                    ? tc.dark.elevated
                    : "transparent",
                alignSelf: "flex-start",
                marginBottom: 8,
                opacity: pressed ? 0.9 : 1,
                ...(isWeb
                  ? ({
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      transform: hovered
                        ? "translateX(-2px)"
                        : "translateX(0px)",
                    } as any)
                  : {}),
              })}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 15,
                  fontFamily: "DMSans_500Medium",
                }}
              >
                Back
              </Text>
            </Pressable>

            {/* Page Title */}
            <View
              style={{
                marginBottom: isDesktop ? 32 : 24,
                paddingHorizontal: 4,
              }}
            >
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: isDesktop ? 32 : 26,
                  fontFamily: "DMSans_700Bold",
                  letterSpacing: -0.5,
                }}
              >
                Edit Profile
              </Text>
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: isDesktop ? 16 : 14,
                  fontFamily: "DMSans_500Medium",
                  marginTop: 4,
                  lineHeight: 22,
                }}
              >
                Update your personal information and photo
              </Text>
            </View>

            <EditFormStep
              fullName={fullName}
              setFullName={setFullName}
              email={email}
              setEmail={setEmail}
              phone={phone}
              avatarUri={avatarUri}
              avatarUrl={avatarUrl}
              kycTier={kycTier}
              memberSince={memberSince}
              emailVerified={!!(user?.email_verified && email === (user?.email || ""))}
              isDesktop={isDesktop}
              isTablet={isTablet}
              tc={tc}
              ts={ts}
              onPickImage={handlePickImage}
              onSubmit={handleSavePress}
              nameFocused={nameFocused}
              setNameFocused={setNameFocused}
              emailFocused={emailFocused}
              setEmailFocused={setEmailFocused}
              userEmail={user?.email || ""}
              onVerifyEmail={async () => {
                try {
                  await authApi.sendEmailVerification(email);
                  setStep("email-verify");
                } catch {
                  // handled silently
                }
              }}
            />
          </ScrollView>
        )}
      </Animated.View>
    </SafeAreaView>
  );
}
