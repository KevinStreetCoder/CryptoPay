import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { authApi } from "../../src/api/auth";
import { useToast } from "../../src/components/Toast";
import { getThemeColors } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { normalizeError } from "../../src/utils/apiErrors";
import * as Clipboard from "expo-clipboard";

const isWeb = Platform.OS === "web";

type SetupStep = "intro" | "qr" | "verify" | "backup" | "done";

export default function TOTPSetupScreen() {
  const router = useRouter();
  const toast = useToast();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;

  const [step, setStep] = useState<SetupStep>("intro");
  const [secret, setSecret] = useState("");
  const [provisioningUri, setProvisioningUri] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [alreadyEnabled, setAlreadyEnabled] = useState(false);

  const handleStartSetup = async () => {
    setLoading(true);
    try {
      const { data } = await authApi.setupTOTP();
      setSecret(data.secret);
      setProvisioningUri(data.provisioning_uri);
      setAlreadyEnabled(data.already_enabled);
      setStep("qr");
    } catch (err) {
      const e = normalizeError(err);
      toast.error(e.title, e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (code.length < 6) return;
    setLoading(true);
    try {
      const { data } = await authApi.enableTOTP(code);
      setBackupCodes(data.backup_codes);
      setStep("backup");
      toast.success("Enabled", "Authenticator app is now active!");
    } catch (err) {
      const e = normalizeError(err);
      toast.error(e.title, e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopySecret = async () => {
    await Clipboard.setStringAsync(secret);
    toast.success("Copied", "Secret key copied to clipboard");
  };

  const handleCopyBackupCodes = async () => {
    const text = backupCodes.join("\n");
    await Clipboard.setStringAsync(text);
    toast.success("Copied", "Backup codes copied to clipboard");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        contentContainerStyle={{
          padding: isDesktop ? 32 : 20,
          maxWidth: 520,
          width: "100%",
          alignSelf: "center",
        }}
      >
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 28 }}>
          <Pressable
            onPress={() => router.canGoBack() ? router.back() : router.replace("/settings/security" as any)}
            style={{ marginRight: 16 }}
          >
            <Ionicons name="arrow-back" size={24} color={tc.textPrimary} />
          </Pressable>
          <Text style={{ color: tc.textPrimary, fontSize: 22, fontFamily: "DMSans_700Bold", flex: 1 }}>
            Authenticator Setup
          </Text>
        </View>

        {step === "intro" && (
          <View>
            <View
              style={{
                alignItems: "center",
                padding: 32,
                backgroundColor: tc.dark.card,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: tc.glass.border,
                marginBottom: 24,
              }}
            >
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 20,
                  backgroundColor: "rgba(139, 92, 246, 0.12)",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 20,
                }}
              >
                <Ionicons name="key" size={36} color="#8B5CF6" />
              </View>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 20,
                  fontFamily: "DMSans_700Bold",
                  textAlign: "center",
                  marginBottom: 8,
                }}
              >
                Two-Factor Authentication
              </Text>
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 14,
                  fontFamily: "DMSans_400Regular",
                  textAlign: "center",
                  lineHeight: 22,
                }}
              >
                Add an extra layer of security with Google Authenticator, Authy, or any TOTP app.
                You'll need to enter a code from the app each time you log in.
              </Text>
            </View>

            <Pressable
              onPress={handleStartSetup}
              disabled={loading}
              style={{
                backgroundColor: "#8B5CF6",
                borderRadius: 16,
                padding: 16,
                alignItems: "center",
              }}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontSize: 17, fontFamily: "DMSans_600SemiBold" }}>
                  Begin Setup
                </Text>
              )}
            </Pressable>
          </View>
        )}

        {step === "qr" && (
          <View>
            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 20,
                padding: 24,
                borderWidth: 1,
                borderColor: tc.glass.border,
                marginBottom: 24,
              }}
            >
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 17,
                  fontFamily: "DMSans_600SemiBold",
                  marginBottom: 8,
                }}
              >
                1. Add to your authenticator app
              </Text>
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 14,
                  fontFamily: "DMSans_400Regular",
                  lineHeight: 22,
                  marginBottom: 16,
                }}
              >
                Open Google Authenticator or Authy and manually enter this secret key:
              </Text>

              {/* Secret key display */}
              <Pressable
                onPress={handleCopySecret}
                style={{
                  backgroundColor: tc.dark.elevated,
                  borderRadius: 12,
                  padding: 16,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: tc.dark.border,
                }}
              >
                <Text
                  style={{
                    color: tc.primary[300],
                    fontSize: 16,
                    fontFamily: "DMSans_700Bold",
                    letterSpacing: 2,
                    flex: 1,
                    textAlign: "center",
                  }}
                  selectable
                >
                  {secret}
                </Text>
                <Ionicons name="copy" size={20} color={tc.textMuted} style={{ marginLeft: 8 }} />
              </Pressable>
              <Text style={{ color: tc.textMuted, fontSize: 12, textAlign: "center", marginTop: 8 }}>
                Tap to copy
              </Text>
            </View>

            <Pressable
              onPress={() => setStep("verify")}
              style={{
                backgroundColor: "#8B5CF6",
                borderRadius: 16,
                padding: 16,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#fff", fontSize: 17, fontFamily: "DMSans_600SemiBold" }}>
                I've Added It
              </Text>
            </Pressable>
          </View>
        )}

        {step === "verify" && (
          <View>
            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 20,
                padding: 24,
                borderWidth: 1,
                borderColor: tc.glass.border,
                marginBottom: 24,
              }}
            >
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 17,
                  fontFamily: "DMSans_600SemiBold",
                  marginBottom: 8,
                }}
              >
                2. Enter the code from your app
              </Text>
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 14,
                  fontFamily: "DMSans_400Regular",
                  lineHeight: 22,
                  marginBottom: 20,
                }}
              >
                Enter the 6-digit code shown in your authenticator app to verify the setup.
              </Text>

              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="000000"
                placeholderTextColor={tc.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                style={{
                  backgroundColor: tc.dark.elevated,
                  borderRadius: 14,
                  padding: 18,
                  color: tc.textPrimary,
                  fontSize: 28,
                  letterSpacing: 8,
                  textAlign: "center",
                  fontFamily: "DMSans_700Bold",
                  borderWidth: 2,
                  borderColor: code.length === 6 ? tc.primary[500] : tc.dark.border,
                  ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                }}
              />
            </View>

            <Pressable
              onPress={handleVerifyCode}
              disabled={loading || code.length < 6}
              style={{
                backgroundColor: "#8B5CF6",
                borderRadius: 16,
                padding: 16,
                alignItems: "center",
                opacity: code.length < 6 ? 0.6 : 1,
              }}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontSize: 17, fontFamily: "DMSans_600SemiBold" }}>
                  Verify & Enable
                </Text>
              )}
            </Pressable>
          </View>
        )}

        {step === "backup" && (
          <View>
            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 20,
                padding: 24,
                borderWidth: 1,
                borderColor: tc.glass.border,
                marginBottom: 24,
              }}
            >
              <View
                style={{
                  alignItems: "center",
                  marginBottom: 20,
                }}
              >
                <Ionicons name="checkmark-circle" size={48} color={tc.primary[500]} />
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 18,
                    fontFamily: "DMSans_700Bold",
                    marginTop: 12,
                    textAlign: "center",
                  }}
                >
                  Authenticator Enabled!
                </Text>
              </View>

              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 15,
                  fontFamily: "DMSans_600SemiBold",
                  marginBottom: 8,
                }}
              >
                Save your backup codes
              </Text>
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 13,
                  fontFamily: "DMSans_400Regular",
                  lineHeight: 20,
                  marginBottom: 16,
                }}
              >
                If you lose access to your authenticator app, you can use these codes to sign in.
                Each code can only be used once. Store them safely.
              </Text>

              <View
                style={{
                  backgroundColor: tc.dark.elevated,
                  borderRadius: 12,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: tc.dark.border,
                }}
              >
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {backupCodes.map((c, i) => (
                    <View
                      key={i}
                      style={{
                        backgroundColor: tc.dark.bg,
                        borderRadius: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        minWidth: "45%",
                      }}
                    >
                      <Text
                        style={{
                          color: tc.primary[300],
                          fontSize: 14,
                          fontFamily: "DMSans_700Bold",
                          letterSpacing: 1,
                          textAlign: "center",
                        }}
                        selectable
                      >
                        {c}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              <Pressable
                onPress={handleCopyBackupCodes}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  marginTop: 12,
                  padding: 12,
                }}
              >
                <Ionicons name="copy" size={18} color={tc.primary[400]} />
                <Text style={{ color: tc.primary[400], fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
                  Copy All Codes
                </Text>
              </Pressable>
            </View>

            {/* Warning */}
            <View
              style={{
                backgroundColor: "rgba(245, 158, 11, 0.08)",
                borderRadius: 14,
                padding: 16,
                borderWidth: 1,
                borderColor: "rgba(245, 158, 11, 0.15)",
                flexDirection: "row",
                gap: 12,
                marginBottom: 24,
              }}
            >
              <Ionicons name="warning" size={20} color="#F59E0B" style={{ marginTop: 2 }} />
              <Text style={{ color: "#F59E0B", fontSize: 13, fontFamily: "DMSans_500Medium", flex: 1, lineHeight: 20 }}>
                These codes will NOT be shown again. Make sure to save them before continuing.
              </Text>
            </View>

            <Pressable
              onPress={() => router.canGoBack() ? router.back() : router.replace("/settings/security" as any)}
              style={{
                backgroundColor: tc.primary[500],
                borderRadius: 16,
                padding: 16,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#fff", fontSize: 17, fontFamily: "DMSans_600SemiBold" }}>
                I've Saved My Codes
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
