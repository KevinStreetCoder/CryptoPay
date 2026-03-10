import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/stores/auth";
import { authApi, KYCDocument } from "../../src/api/auth";
import { useToast } from "../../src/components/Toast";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";

const DOCUMENT_TYPES = [
  {
    type: "national_id",
    label: "National ID",
    description: "Front and back of your Kenyan National ID",
    icon: "card-outline",
    tier: 1,
  },
  {
    type: "selfie",
    label: "Selfie",
    description: "A clear photo of your face for identity verification",
    icon: "camera-outline",
    tier: 1,
  },
  {
    type: "kra_pin",
    label: "KRA PIN Certificate",
    description: "Your Kenya Revenue Authority PIN certificate",
    icon: "document-text-outline",
    tier: 2,
  },
  {
    type: "proof_of_address",
    label: "Proof of Address",
    description: "Utility bill or bank statement (last 3 months)",
    icon: "home-outline",
    tier: 2,
  },
  {
    type: "passport",
    label: "Passport",
    description: "Bio-data page of your passport (alternative to National ID)",
    icon: "globe-outline",
    tier: 1,
  },
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    pending: { color: colors.warning, label: "Pending Review" },
    approved: { color: colors.success, label: "Approved" },
    rejected: { color: colors.error, label: "Rejected" },
  };
  const s = map[status] || map.pending;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: s.color + "15",
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.color }} />
      <Text style={{ color: s.color, fontSize: 11, fontFamily: "Inter_600SemiBold" }}>
        {s.label}
      </Text>
    </View>
  );
}

export default function KYCScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= 768;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

  const [documents, setDocuments] = useState<KYCDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      const { data } = await authApi.getKYCDocuments();
      setDocuments(Array.isArray(data) ? data : []);
    } catch {
      // Documents not loaded — show empty state
    } finally {
      setLoading(false);
    }
  };

  const getDocStatus = (type: string): KYCDocument | undefined => {
    return documents.find((d) => d.document_type === type);
  };

  const handleUpload = async (docType: string) => {
    // In production, this would open camera/file picker and upload to S3
    // For now, simulate the upload flow
    setUploading(docType);

    try {
      // Simulate file upload URL (in production: pick image → upload to S3 → get URL)
      const placeholderUrl = `https://storage.cryptopay.co.ke/kyc/${user?.id}/${docType}_${Date.now()}.jpg`;

      await authApi.uploadKYCDocument({
        document_type: docType,
        file_url: placeholderUrl,
      });

      toast.success("Uploaded", "Document submitted for review");
      await loadDocuments();
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Upload failed. Please try again.";
      toast.error("Error", msg);
    } finally {
      setUploading(null);
    }
  };

  const hPad = isDesktop ? 28 : 16;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: hPad,
          paddingTop: 12,
          paddingBottom: 16,
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/settings" as any);
          }}
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: tc.dark.card,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: tc.glass.border,
          }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={tc.textPrimary} />
        </Pressable>
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: isDesktop ? 28 : 24,
            fontFamily: "Inter_700Bold",
            letterSpacing: -0.5,
          }}
        >
          Verify Identity
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: hPad,
          paddingBottom: 32,
          maxWidth: isDesktop ? 640 : undefined,
        }}
      >
        {/* Current Tier Card */}
        <View
          style={{
            backgroundColor: tc.dark.card,
            borderRadius: 20,
            padding: 20,
            marginBottom: 20,
            borderWidth: 1,
            borderColor: tc.glass.border,
          }}
        >
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 11,
              fontFamily: "Inter_600SemiBold",
              textTransform: "uppercase",
              letterSpacing: 0.8,
              marginBottom: 8,
            }}
          >
            CURRENT VERIFICATION LEVEL
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: colors.primary[500],
              }}
            />
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 18,
                fontFamily: "Inter_700Bold",
              }}
            >
              Tier {user?.kyc_tier ?? 0}
            </Text>
          </View>
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 13,
              fontFamily: "Inter_400Regular",
              marginTop: 8,
              lineHeight: 18,
            }}
          >
            Upload documents below to upgrade your verification tier and increase transaction limits.
          </Text>
        </View>

        {/* Document Cards */}
        {DOCUMENT_TYPES.map((doc) => {
          const existing = getDocStatus(doc.type);
          const isUploading = uploading === doc.type;
          const isApproved = existing?.status === "approved";
          const isPending = existing?.status === "pending";

          return (
            <View
              key={doc.type}
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 18,
                padding: 18,
                marginBottom: 12,
                borderWidth: 1,
                borderColor: isApproved
                  ? colors.success + "30"
                  : existing?.status === "rejected"
                  ? colors.error + "30"
                  : tc.glass.border,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    backgroundColor: isApproved
                      ? colors.success + "20"
                      : tc.dark.elevated,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name={(isApproved ? "checkmark-circle" : doc.icon) as any}
                    size={22}
                    color={isApproved ? colors.success : tc.textSecondary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 15,
                        fontFamily: "Inter_600SemiBold",
                      }}
                    >
                      {doc.label}
                    </Text>
                    <View
                      style={{
                        backgroundColor: tc.dark.elevated,
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: 6,
                      }}
                    >
                      <Text
                        style={{
                          color: tc.textMuted,
                          fontSize: 10,
                          fontFamily: "Inter_600SemiBold",
                        }}
                      >
                        TIER {doc.tier}
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 12,
                      fontFamily: "Inter_400Regular",
                      lineHeight: 17,
                      marginBottom: 10,
                    }}
                  >
                    {doc.description}
                  </Text>

                  {existing ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <StatusBadge status={existing.status} />
                      {existing.status === "rejected" && existing.rejection_reason ? (
                        <Text
                          style={{
                            color: colors.error,
                            fontSize: 11,
                            fontFamily: "Inter_400Regular",
                            flex: 1,
                          }}
                          numberOfLines={1}
                        >
                          {existing.rejection_reason}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  {/* Upload / Re-upload button */}
                  {!isApproved && !isPending && (
                    <Pressable
                      onPress={() => handleUpload(doc.type)}
                      disabled={isUploading}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        paddingVertical: 10,
                        borderRadius: 12,
                        backgroundColor: pressed
                          ? colors.primary[600]
                          : colors.primary[500],
                        marginTop: 8,
                        opacity: isUploading ? 0.7 : 1,
                      })}
                      accessibilityRole="button"
                      accessibilityLabel={`Upload ${doc.label}`}
                    >
                      {isUploading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
                      )}
                      <Text
                        style={{
                          color: "#fff",
                          fontSize: 13,
                          fontFamily: "Inter_600SemiBold",
                        }}
                      >
                        {existing?.status === "rejected" ? "Re-upload" : "Upload"}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </View>
          );
        })}

        {/* Info */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 10,
            marginTop: 8,
            padding: 14,
            backgroundColor: colors.info + "10",
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.info + "20",
          }}
        >
          <Ionicons name="information-circle-outline" size={18} color={colors.info} style={{ marginTop: 1 }} />
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 12,
              fontFamily: "Inter_400Regular",
              lineHeight: 18,
              flex: 1,
            }}
          >
            Documents are reviewed within 24 hours. Your tier is automatically upgraded once all required documents are approved.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
