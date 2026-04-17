/**
 * Approve-sign-in screen.
 *
 * Deep link: cryptopay://approve-login/<challenge_id>
 *
 * Triggered when the user taps a "Someone is trying to sign in" push
 * notification on their trusted device. Shows the requesting device + IP
 * and offers Approve / Deny buttons. One tap completes (or rejects) the
 * sign-in on the original device — no codes to type, no SIM-swap risk.
 *
 * This screen requires the user to already be authenticated on this device
 * (that's the whole point: this IS the trusted device). If the token is
 * missing/expired we bounce to login.
 */
import { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { authApi } from "../../../src/api/auth";
import { useAuth } from "../../../src/stores/auth";
import { useToast } from "../../../src/components/Toast";
import { getThemeColors } from "../../../src/constants/theme";
import { useThemeMode } from "../../../src/stores/theme";

type ChallengeStatus = "pending" | "approved" | "denied" | "expired";

type ChallengeDetail = {
  status: ChallengeStatus;
  requesting_device_name: string;
  requesting_ip: string;
};

export default function ApproveLogin() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const challengeId = typeof id === "string" ? id : "";

  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  const [detail, setDetail] = useState<ChallengeDetail | null>(null);
  const [fetching, setFetching] = useState(true);
  const [acting, setActing] = useState<"approve" | "deny" | null>(null);
  const [done, setDone] = useState<null | "approved" | "denied" | "expired">(null);

  // Bounce unauthenticated users back to login — they can't approve anything
  // without proving they own the account.
  useEffect(() => {
    if (!authLoading && !user) {
      toast.warning("Sign in first", "You must be signed in on this device to approve a sign-in.");
      router.replace("/auth/login" as any);
    }
  }, [authLoading, user]);

  // Fetch challenge detail on mount
  useEffect(() => {
    if (!challengeId || !user) return;
    (async () => {
      try {
        const { data } = await authApi.getChallengeStatus(challengeId);
        setDetail(data);
        if (data.status !== "pending") {
          setDone(data.status === "approved" ? "approved" : data.status === "denied" ? "denied" : "expired");
        }
      } catch (err) {
        const code = (err as any)?.response?.status;
        setDone("expired");
        if (code && code !== 404) {
          toast.error("Sign-in request", "Could not load the sign-in request.");
        }
      } finally {
        setFetching(false);
      }
    })();
  }, [challengeId, user]);

  const handleApprove = useCallback(async () => {
    if (!challengeId || acting) return;
    setActing("approve");
    try {
      await authApi.approveChallenge(challengeId);
      setDone("approved");
      toast.success("Sign-in approved", "You've approved the sign-in on the other device.");
    } catch (err) {
      toast.error("Couldn't approve", "The request may have expired. Please try again.");
    } finally {
      setActing(null);
    }
  }, [challengeId, acting]);

  const handleDeny = useCallback(async () => {
    if (!challengeId || acting) return;
    setActing("deny");
    try {
      await authApi.denyChallenge(challengeId);
      setDone("denied");
      toast.warning("Sign-in denied", "The sign-in attempt was blocked.");
    } catch (err) {
      toast.error("Couldn't deny", "The request may have expired.");
    } finally {
      setActing(null);
    }
  }, [challengeId, acting]);

  const textPrimary = tc.textPrimary;
  const textSecondary = tc.textSecondary;
  const textMuted = tc.textMuted;

  if (fetching) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={tc.primary[500]} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 48, maxWidth: 480, width: "100%", alignSelf: "center" }}>
        {/* Icon */}
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            backgroundColor: done === "approved"
              ? "rgba(16, 185, 129, 0.12)"
              : done === "denied"
                ? "rgba(239, 68, 68, 0.12)"
                : done === "expired"
                  ? "rgba(148, 163, 184, 0.12)"
                  : "rgba(59, 130, 246, 0.12)",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}
        >
          <Ionicons
            name={
              done === "approved" ? "checkmark-circle-outline"
              : done === "denied" ? "close-circle-outline"
              : done === "expired" ? "time-outline"
              : "shield-checkmark-outline"
            }
            size={32}
            color={
              done === "approved" ? tc.primary[500]
              : done === "denied" ? tc.error
              : done === "expired" ? textMuted
              : tc.info
            }
          />
        </View>

        {/* Title */}
        <Text
          style={{
            color: textPrimary,
            fontSize: 24,
            fontFamily: "DMSans_600SemiBold",
            letterSpacing: -0.4,
            marginBottom: 8,
          }}
        >
          {done === "approved" ? "Sign-in approved"
            : done === "denied" ? "Sign-in blocked"
            : done === "expired" ? "Request expired"
            : "Is this you signing in?"}
        </Text>

        {/* Subtitle */}
        <Text
          style={{
            color: textSecondary,
            fontSize: 15,
            fontFamily: "DMSans_400Regular",
            lineHeight: 22,
            marginBottom: 28,
          }}
        >
          {done === "approved"
            ? "You can return to the other device — you're signed in."
            : done === "denied"
              ? "We've stopped the sign-in attempt. If this wasn't you, your account is safe. Consider changing your PIN."
              : done === "expired"
                ? "This request is no longer valid. Sign-in requests expire after 5 minutes. Try again from the original device."
                : "Approve only if you're the one trying to sign in right now."}
        </Text>

        {/* Request details card */}
        {detail && done !== "expired" ? (
          <View
            style={{
              backgroundColor: tc.glass.bg,
              borderColor: tc.glass.border,
              borderWidth: 1,
              borderRadius: 16,
              padding: 18,
              marginBottom: 24,
              gap: 14,
            }}
          >
            <DetailRow label="Device" value={detail.requesting_device_name || "Unknown device"} tc={tc} />
            <DetailRow label="IP address" value={detail.requesting_ip || "—"} tc={tc} />
            <DetailRow label="Time" value="Just now" tc={tc} />
          </View>
        ) : null}

        {/* Action buttons — only show while pending */}
        {done === null ? (
          <View style={{ gap: 12 }}>
            <Pressable
              onPress={handleApprove}
              disabled={!!acting}
              style={({ pressed }) => ({
                backgroundColor: tc.primary[500],
                borderRadius: 14,
                paddingVertical: 16,
                alignItems: "center",
                justifyContent: "center",
                opacity: acting === "approve" ? 0.7 : pressed ? 0.9 : 1,
                ...((Platform.OS === "web"
                  ? { boxShadow: "0 6px 16px rgba(16,185,129,0.25)" }
                  : {
                      shadowColor: "#10B981",
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.25,
                      shadowRadius: 10,
                      elevation: 4,
                    }) as any),
              })}
              accessibilityLabel="Yes, this is me. Approve sign-in."
              testID="approve-btn"
            >
              {acting === "approve" ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={{ color: "#FFFFFF", fontSize: 16, fontFamily: "DMSans_600SemiBold" }}>
                  Yes, it's me — approve
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={handleDeny}
              disabled={!!acting}
              style={({ pressed }) => ({
                backgroundColor: "transparent",
                borderWidth: 1.5,
                borderColor: tc.glass.border,
                borderRadius: 14,
                paddingVertical: 16,
                alignItems: "center",
                justifyContent: "center",
                opacity: acting === "deny" ? 0.7 : pressed ? 0.8 : 1,
              })}
              accessibilityLabel="This wasn't me. Deny sign-in."
              testID="deny-btn"
            >
              {acting === "deny" ? (
                <ActivityIndicator color={textSecondary} />
              ) : (
                <Text style={{ color: textSecondary, fontSize: 16, fontFamily: "DMSans_500Medium" }}>
                  No — this wasn't me
                </Text>
              )}
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => router.replace("/(tabs)" as any)}
            style={({ pressed }) => ({
              backgroundColor: tc.primary[500],
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: "center",
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 16, fontFamily: "DMSans_600SemiBold" }}>Done</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

function DetailRow({ label, value, tc }: { label: string; value: string; tc: any }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_400Regular" }}>{label}</Text>
      <Text
        style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_500Medium", maxWidth: "60%", textAlign: "right" }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}
