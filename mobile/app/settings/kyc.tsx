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
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "../../src/stores/auth";
import { authApi, KYCDocument } from "../../src/api/auth";
import { useToast } from "../../src/components/Toast";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { useLocale } from "../../src/hooks/useLocale";
import { Spinner } from "../../src/components/brand/Spinner";
import { KycIdFront, KycSelfie, KycReview } from "../../src/components/brand/PolishAssets";

const DOCUMENT_TYPES = [
  {
    type: "national_id",
    labelKey: "kyc.nationalId",
    descKey: "kyc.nationalIdDesc",
    icon: "card-outline",
    tier: 1,
  },
  {
    type: "selfie",
    labelKey: "kyc.selfie",
    descKey: "kyc.selfieDesc",
    icon: "camera-outline",
    tier: 1,
  },
  {
    type: "kra_pin",
    labelKey: "kyc.kraPinCert",
    descKey: "kyc.kraPinDesc",
    icon: "document-text-outline",
    tier: 2,
  },
  {
    type: "proof_of_address",
    labelKey: "kyc.proofOfAddress",
    descKey: "kyc.proofOfAddressDesc",
    icon: "home-outline",
    tier: 2,
  },
  {
    type: "passport",
    labelKey: "kyc.passport",
    descKey: "kyc.passportDesc",
    icon: "globe-outline",
    tier: 1,
  },
];

function StatusBadge({ status }: { status: string }) {
  const { t } = useLocale();
  const map: Record<string, { color: string; labelKey: string }> = {
    pending: { color: colors.warning, labelKey: "kyc.pendingReview" },
    approved: { color: colors.success, labelKey: "kyc.approved" },
    rejected: { color: colors.error, labelKey: "kyc.rejected" },
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
      <Text style={{ color: s.color, fontSize: 11, fontFamily: "DMSans_600SemiBold" }}>
        {t(s.labelKey)}
      </Text>
    </View>
  );
}

export default function KYCScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLocale();
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
      // Documents not loaded · show empty state
    } finally {
      setLoading(false);
    }
  };

  const getDocStatus = (type: string): KYCDocument | undefined => {
    return documents.find((d) => d.document_type === type);
  };

  const pickImage = async (docType: string, useCamera: boolean) => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: docType === "selfie",
      aspect: docType === "selfie" ? [1, 1] : undefined,
    };

    let result: ImagePicker.ImagePickerResult;
    if (useCamera) {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        toast.warning(t("kyc.cameraPermission"), t("kyc.cameraPermissionDesc"));
        return null;
      }
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        toast.warning(t("kyc.galleryPermission"), t("kyc.galleryPermissionDesc"));
        return null;
      }
      result = await ImagePicker.launchImageLibraryAsync(options);
    }

    if (result.canceled || !result.assets?.[0]) return null;
    return result.assets[0];
  };

  const handleUpload = async (docType: string) => {
    // For selfie, prefer camera; for documents, prefer gallery
    const useCamera = docType === "selfie";
    const asset = await pickImage(docType, useCamera);
    if (!asset) return;

    setUploading(docType);

    try {
      const formData = new FormData();
      formData.append("document_type", docType);

      const uri = asset.uri;
      const filename = uri.split("/").pop() || `${docType}.jpg`;
      const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
      const mimeType = ext === "png" ? "image/png" : ext === "pdf" ? "application/pdf" : "image/jpeg";

      if (Platform.OS === "web") {
        // On web, fetch the blob from the object URL
        const response = await fetch(uri);
        const blob = await response.blob();
        formData.append("file", blob, filename);
      } else {
        // On native, pass the URI directly (React Native handles it)
        formData.append("file", {
          uri,
          name: filename,
          type: mimeType,
        } as any);
      }

      await authApi.uploadKYCDocument(formData);

      toast.success(t("kyc.uploaded"), t("kyc.documentSubmitted"));
      await loadDocuments();
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.error || t("kyc.uploadFailed");
      toast.error("Error", msg);
    } finally {
      setUploading(null);
    }
  };

  const hPad = isDesktop ? 48 : 16;

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
            fontFamily: "DMSans_700Bold",
            letterSpacing: -0.5,
          }}
        >
          {t("kyc.verifyIdentity")}
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: hPad,
          paddingBottom: 32,
        }}
      >
        {/* Current Tier Card with brand KYC illustration */}
        <View
          style={{
            backgroundColor: tc.dark.card,
            borderRadius: 20,
            padding: 20,
            marginBottom: 20,
            borderWidth: 1,
            borderColor: tc.glass.border,
            flexDirection: isDesktop ? "row" : "column",
            alignItems: isDesktop ? "center" : "flex-start",
            gap: isDesktop ? 20 : 12,
          }}
        >
          <View style={{ alignItems: "center", justifyContent: "center" }}>
            {(() => {
              // Illustration reflects where the user is in the flow:
              //  · No ID yet → KycIdFront (show them what to upload)
              //  · ID uploaded, no selfie → KycSelfie
              //  · Both uploaded, review pending → KycReview
              const idDoc = getDocStatus("national_id") ?? getDocStatus("passport");
              const selfieDoc = getDocStatus("selfie");
              if (!idDoc) return <KycIdFront size={100} />;
              if (!selfieDoc) return <KycSelfie size={100} />;
              return <KycReview size={100} />;
            })()}
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 11,
                fontFamily: "DMSans_600SemiBold",
                textTransform: "uppercase",
                letterSpacing: 0.8,
                marginBottom: 8,
              }}
            >
              {t("kyc.currentVerificationLevel")}
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
                  fontFamily: "DMSans_700Bold",
                }}
              >
                {t("kyc.tier")} {user?.kyc_tier ?? 0}
              </Text>
            </View>
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 13,
                fontFamily: "DMSans_400Regular",
                marginTop: 8,
                lineHeight: 18,
              }}
            >
              {t("kyc.uploadDocumentsDesc")}
            </Text>
          </View>
        </View>

        {/* Document Cards */}
        <View style={isDesktop ? { flexDirection: "row", flexWrap: "wrap", gap: 12 } : {}}>
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
                ...(isDesktop ? { width: "48%", minWidth: 320, flexGrow: 1 } : {}),
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
                        fontFamily: "DMSans_600SemiBold",
                      }}
                    >
                      {t(doc.labelKey)}
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
                          fontFamily: "DMSans_600SemiBold",
                        }}
                      >
                        {t("kyc.tier").toUpperCase()} {doc.tier}
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 12,
                      fontFamily: "DMSans_400Regular",
                      lineHeight: 17,
                      marginBottom: 10,
                    }}
                  >
                    {t(doc.descKey)}
                  </Text>

                  {existing ? (
                    isApproved ? (
                      /* Approved: show success status with audit trail */
                      <View
                        style={{
                          backgroundColor: colors.success + "0C",
                          borderRadius: 10,
                          padding: 10,
                          borderWidth: 1,
                          borderColor: colors.success + "20",
                        }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                          <Text
                            style={{
                              color: colors.success,
                              fontSize: 13,
                              fontFamily: "DMSans_600SemiBold",
                            }}
                          >
                            {t("kyc.approved")}
                          </Text>
                        </View>
                        {existing.verified_at ? (
                          <Text
                            style={{
                              color: tc.textMuted,
                              fontSize: 11,
                              fontFamily: "DMSans_400Regular",
                              marginLeft: 24,
                            }}
                          >
                            {t("kyc.verifiedOn")} {new Date(existing.verified_at).toLocaleDateString()}
                          </Text>
                        ) : null}
                        {existing.verified_by_name ? (
                          <Text
                            style={{
                              color: tc.textMuted,
                              fontSize: 11,
                              fontFamily: "DMSans_400Regular",
                              marginLeft: 24,
                              marginTop: 2,
                            }}
                          >
                            {t("kyc.verifiedBy")} {existing.verified_by_name}
                          </Text>
                        ) : null}
                      </View>
                    ) : (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <StatusBadge status={existing.status} />
                        {existing.status === "rejected" && existing.rejection_reason ? (
                          <Text
                            style={{
                              color: colors.error,
                              fontSize: 11,
                              fontFamily: "DMSans_400Regular",
                              flex: 1,
                            }}
                            numberOfLines={1}
                          >
                            {existing.rejection_reason}
                          </Text>
                        ) : null}
                      </View>
                    )
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
                        maxWidth: isDesktop ? 240 : undefined,
                        opacity: isUploading ? 0.7 : 1,
                      })}
                      accessibilityRole="button"
                      accessibilityLabel={`${t("kyc.upload")} ${t(doc.labelKey)}`}
                    >
                      {isUploading ? (
                        <Spinner size={16} color="#fff" />
                      ) : (
                        <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
                      )}
                      <Text
                        style={{
                          color: "#fff",
                          fontSize: 13,
                          fontFamily: "DMSans_600SemiBold",
                        }}
                      >
                        {existing?.status === "rejected" ? t("kyc.reUpload") : t("kyc.upload")}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </View>
          );
        })}
        </View>

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
              fontFamily: "DMSans_400Regular",
              lineHeight: 18,
              flex: 1,
            }}
          >
            {t("kyc.documentsReviewedInfo")}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
