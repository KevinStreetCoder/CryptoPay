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
import { useRouter } from "expo-router";
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

const isWeb = Platform.OS === "web";

type Step = "edit" | "pin" | "success";

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

function getKYCLabel(tier: number | undefined): string {
  switch (tier) {
    case 0:
      return "Unverified";
    case 1:
      return "Basic";
    case 2:
      return "Intermediate";
    case 3:
      return "Advanced";
    default:
      return "Unverified";
  }
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
}) {
  const avatarSize = isDesktop ? 120 : 100;
  const displayAvatar = avatarUri || avatarUrl;
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
            <Image
              source={{ uri: displayAvatar }}
              style={{
                width: avatarSize,
                height: avatarSize,
                borderRadius: avatarSize / 2,
                borderWidth: 3,
                borderColor: colors.primary[500] + "50",
              }}
            />
          ) : (
            <View
              style={{
                width: avatarSize,
                height: avatarSize,
                borderRadius: avatarSize / 2,
                backgroundColor: colors.primary[500] + "20",
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 3,
                borderColor: colors.primary[500] + "50",
              }}
            >
              <Text
                style={{
                  color: colors.primary[400],
                  fontSize: isDesktop ? 36 : 30,
                  fontFamily: "DMSans_700Bold",
                }}
              >
                {initials}
              </Text>
            </View>
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
          Tap to change photo
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
          Personal Information
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
              Full Name
            </Text>
            <TextInput
              value={fullName}
              onChangeText={setFullName}
              onFocus={() => setNameFocused(true)}
              onBlur={() => setNameFocused(false)}
              placeholder="Enter your full name"
              placeholderTextColor={tc.textMuted}
              style={inputStyle(nameFocused)}
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>

          {/* Email */}
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
              Email Address
            </Text>
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
            label="Phone Number"
            value={phone || "Not set"}
            badge={null}
            isDesktop={isDesktop}
            useColumns={useColumns}
            tc={tc}
          />

          {/* KYC Tier */}
          <InfoRow
            icon="shield-checkmark-outline"
            label="KYC Level"
            value={getKYCLabel(kycTier)}
            badge={{ text: `Tier ${kycTier}`, color: getKYCColor(kycTier) }}
            isDesktop={isDesktop}
            useColumns={useColumns}
            tc={tc}
          />

          {/* Member Since */}
          <InfoRow
            icon="calendar-outline"
            label="Member Since"
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
  onSubmit: () => void;
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

    // Auto-submit when all 6 digits entered
    if (digit && index === 5 && newPin.every((d) => d !== "")) {
      onSubmit();
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

    // Go to PIN step
    setStep("pin");
    setPinError("");
    setPin(["", "", "", "", "", ""]);
  };

  const handlePinSubmit = async () => {
    const pinStr = pin.join("");
    if (pinStr.length < 6) {
      setPinError("Please enter all 6 digits");
      return;
    }

    setLoading(true);
    setPinError("");

    try {
      const formData = new FormData();
      formData.append("full_name", fullName.trim());
      if (email.trim()) {
        formData.append("email", email.trim());
      }
      if (avatarFile) {
        formData.append("avatar", avatarFile);
      }

      await authApi.updateProfile(formData);

      // Refresh user data in auth store
      await refreshProfile();

      setStep("success");

      // Navigate back after brief delay
      setTimeout(() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace("/settings" as any);
        }
      }, 1800);
    } catch (err) {
      const appError = normalizeError(err);
      setPinError(appError.message);
    } finally {
      setLoading(false);
    }
  };

  const horizontalPadding = isDesktop ? 48 : isTablet ? 32 : 20;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {step === "success" ? (
          <SuccessStep isDesktop={isDesktop} tc={tc} ts={ts} />
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
            />
          </ScrollView>
        )}
      </Animated.View>
    </SafeAreaView>
  );
}
