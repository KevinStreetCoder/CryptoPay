/**
 * UpdateAvailableBanner · in-app "new build available" prompt.
 *
 * Pings `/api/v1/app/version/` on mount + on every app-foreground
 * transition, compares the server's `latest_version_code` against
 * the build's own `expo.android.versionCode`, and surfaces one of
 * three escalations:
 *
 *  - Optional update  → slide-in banner with "Update / Later"
 *  - Recommended      → full-screen modal, dismissable
 *  - Forced           → full-screen modal, NO dismiss (we're shipping
 *                       a money-loss fix; user MUST update)
 *
 * Why this exists (2026-05-16 · post-Play migration):
 *   Old VPS-distributed APK users had no auto-update path · most
 *   stayed on stale builds with known bugs. After we cut over to
 *   Play Store, Android handles auto-update for new users · but
 *   the OS schedules updates at its own pace, sometimes 24-48h
 *   after a release lands in Play. The banner gives us an
 *   IN-APP signal that says "tap here to update right now" plus
 *   the hard "you can't keep using this build" lever when we
 *   ship a security / payment-correctness fix.
 *
 * Web is a no-op · the web bundle is always fresh after a CDN
 * cache-bust deploy, so there's no "old version" to nag about.
 * iOS is a no-op until the App Store listing ships.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../api/client";
import { useLanguage } from "../contexts/LanguageContext";

// ── Local module state ─────────────────────────────────────────
// Track which versionCodes the user has already dismissed for
// the current session so we don't pester them every time they
// open the app. Persistence beyond app-restart is intentional:
// we want a fresh check on every cold-start in case the user
// updated through Play directly without going through the banner.
const dismissedVersionsThisSession = new Set<number>();

// Throttle network polls · 5 min between checks. Without this,
// every AppState change (alt-tab, biometric prompt, etc.) would
// re-hit the endpoint. The server caches the response anyway,
// but burning request quotas for nothing is sloppy.
const POLL_TTL_MS = 5 * 60 * 1000;
let lastFetchMs = 0;
let lastFetchPayload: VersionPayload | null = null;

// ── Types ──────────────────────────────────────────────────────
type VersionPayload = {
  platform: "android" | "ios";
  available: boolean;
  latest_version: string | null;
  latest_version_code: number | null;
  minimum_supported_version_code: number | null;
  force_update_below_version_code: number | null;
  store_url: string | null;
  release_notes: string | null;
};

type Severity = "none" | "optional" | "recommended" | "forced";

// ── Helpers ────────────────────────────────────────────────────

function bundledVersionCode(): number {
  // expo.android.versionCode lives in app.json under
  // expoConfig.android.versionCode. Constants type doesn't surface
  // it on iOS / web so cast carefully.
  const android = (Constants.expoConfig as any)?.android;
  const code = android?.versionCode;
  if (typeof code === "number" && Number.isFinite(code)) return code;
  return 0;
}

function decideSeverity(
  bundled: number,
  payload: VersionPayload,
): Severity {
  if (!payload.available) return "none";
  if (payload.platform !== "android") return "none";
  const latest = payload.latest_version_code ?? 0;
  const minSup = payload.minimum_supported_version_code ?? 0;
  const forceBelow = payload.force_update_below_version_code ?? 0;

  if (bundled <= 0) return "none"; // can't compare · don't nag
  if (bundled >= latest) return "none";

  if (forceBelow > 0 && bundled < forceBelow) return "forced";
  if (minSup > 0 && bundled < minSup) return "recommended";
  return "optional";
}

async function fetchVersion(): Promise<VersionPayload | null> {
  const now = Date.now();
  if (lastFetchPayload && now - lastFetchMs < POLL_TTL_MS) {
    return lastFetchPayload;
  }
  try {
    const platform = Platform.OS === "ios" ? "ios" : "android";
    const { data } = await api.get<VersionPayload>(
      `/app/version/?platform=${platform}`,
      // No auth needed and this endpoint is public · don't let
      // missing-token logic dump us into the 401 retry loop.
      { headers: { "X-Cpay-Public": "1" } },
    );
    lastFetchMs = now;
    lastFetchPayload = data;
    return data;
  } catch {
    // Network blip / cold start before any DNS · stay silent.
    // We'll retry on the next AppState change.
    return null;
  }
}

// ── Component ──────────────────────────────────────────────────

export function UpdateAvailableBanner() {
  // Web bundle is always fresh after deploy · banner is meaningless.
  // iOS app not shipped yet (server returns available:false anyway,
  // but bail early so we don't even spin up an effect).
  if (Platform.OS !== "android") return null;

  return <UpdateAvailableBannerInner />;
}

function UpdateAvailableBannerInner() {
  const { t } = useLanguage();
  const [payload, setPayload] = useState<VersionPayload | null>(null);
  const [dismissedNow, setDismissedNow] = useState(false);
  const appState = useRef(AppState.currentState);

  // Fetch on mount + whenever the app comes back to the foreground.
  const refresh = useCallback(async () => {
    const data = await fetchVersion();
    if (data) setPayload(data);
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (next) => {
      if (
        appState.current.match(/inactive|background/) &&
        next === "active"
      ) {
        refresh();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [refresh]);

  if (!payload) return null;

  const bundled = bundledVersionCode();
  const severity = decideSeverity(bundled, payload);
  if (severity === "none") return null;

  const latestCode = payload.latest_version_code ?? 0;
  if (severity !== "forced" && dismissedVersionsThisSession.has(latestCode)) {
    return null;
  }
  if (severity !== "forced" && dismissedNow) return null;

  const onUpdate = () => {
    const url = payload.store_url || "https://cpay.co.ke/apk/";
    Linking.openURL(url).catch(() => {
      // Linking can fail on devices with no browser handler.
      // Last-ditch: render the URL inline so user can copy it.
    });
  };

  const onDismiss = () => {
    if (severity === "forced") return; // no-op · forced has no dismiss
    dismissedVersionsThisSession.add(latestCode);
    setDismissedNow(true);
  };

  // Forced + recommended both render as full-screen modals.
  // Optional renders as a slide-in banner.
  const isModal = severity === "forced" || severity === "recommended";
  const bodyText = severity === "forced"
    ? t("updateAvailable.bodyForced")
    : severity === "recommended"
      ? t("updateAvailable.bodyRecommended")
      : t("updateAvailable.body");

  if (isModal) {
    return (
      <Modal
        visible
        transparent
        animationType="fade"
        // Hardware back on Android: forced = no escape, recommended
        // = treat as "Later"
        onRequestClose={severity === "forced" ? () => {} : onDismiss}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <View style={styles.iconCircle}>
              <Ionicons name="rocket" size={32} color="#FFFFFF" />
            </View>
            <Text style={styles.modalTitle}>
              {t("updateAvailable.title")}
            </Text>
            <Text style={styles.modalBody}>{bodyText}</Text>

            {payload.latest_version ? (
              <Text style={styles.versionLine}>
                v{payload.latest_version}
                {payload.latest_version_code != null
                  ? ` (build ${payload.latest_version_code})`
                  : ""}
              </Text>
            ) : null}

            {payload.release_notes ? (
              <View style={styles.notesBox}>
                <Text style={styles.notesLabel}>
                  {t("updateAvailable.releaseNotesLabel")}
                </Text>
                <Text style={styles.notesText}>{payload.release_notes}</Text>
              </View>
            ) : null}

            <Pressable
              onPress={onUpdate}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t("updateAvailable.cta")}
            >
              <Text style={styles.primaryBtnText}>
                {t("updateAvailable.cta")}
              </Text>
            </Pressable>

            {severity !== "forced" ? (
              <Pressable
                onPress={onDismiss}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  pressed && { opacity: 0.6 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t("updateAvailable.later")}
              >
                <Text style={styles.secondaryBtnText}>
                  {t("updateAvailable.later")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    );
  }

  // Optional · slide-in banner pinned to top.
  return (
    <View style={styles.bannerOuter} pointerEvents="box-none">
      <View style={styles.banner}>
        <View style={styles.bannerLeft}>
          <Ionicons name="rocket-outline" size={20} color="#FFFFFF" />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle} numberOfLines={1}>
              {t("updateAvailable.title")}
            </Text>
            <Text style={styles.bannerBody} numberOfLines={1}>
              {payload.latest_version
                ? `v${payload.latest_version} · ${t("updateAvailable.body")}`
                : t("updateAvailable.body")}
            </Text>
          </View>
        </View>
        <View style={styles.bannerRight}>
          <Pressable
            onPress={onUpdate}
            style={({ pressed }) => [
              styles.bannerCta,
              pressed && { opacity: 0.8 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t("updateAvailable.cta")}
          >
            <Text style={styles.bannerCtaText}>
              {t("updateAvailable.cta")}
            </Text>
          </Pressable>
          <Pressable
            onPress={onDismiss}
            style={styles.bannerDismiss}
            accessibilityRole="button"
            accessibilityLabel={t("updateAvailable.later")}
            hitSlop={8}
          >
            <Ionicons name="close" size={16} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Optional · top banner
  bannerOuter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 900,
  },
  banner: {
    marginTop: Platform.OS === "android" ? 32 : 50,
    marginHorizontal: 12,
    backgroundColor: "#1F2937",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.4)",
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  bannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 10,
  },
  bannerTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontFamily: "DMSans_700Bold",
    letterSpacing: 0.2,
  },
  bannerBody: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    fontFamily: "DMSans_400Regular",
    marginTop: 1,
  },
  bannerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  bannerCta: {
    backgroundColor: "#3B82F6",
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  bannerCtaText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontFamily: "DMSans_700Bold",
    letterSpacing: 0.3,
  },
  bannerDismiss: {
    padding: 4,
  },

  // Recommended / Forced · full-screen modal
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(6,14,31,0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#0F172A",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.25)",
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 20,
    alignItems: "center",
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#3B82F6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  modalTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontFamily: "DMSans_700Bold",
    textAlign: "center",
    marginBottom: 8,
  },
  modalBody: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 14,
    fontFamily: "DMSans_400Regular",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 12,
  },
  versionLine: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontFamily: "DMSans_500Medium",
    marginBottom: 16,
  },
  notesBox: {
    width: "100%",
    backgroundColor: "rgba(96,165,250,0.08)",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 20,
  },
  notesLabel: {
    color: "#60A5FA",
    fontSize: 11,
    fontFamily: "DMSans_700Bold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  notesText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    fontFamily: "DMSans_400Regular",
    lineHeight: 18,
  },
  primaryBtn: {
    width: "100%",
    backgroundColor: "#3B82F6",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontFamily: "DMSans_700Bold",
    letterSpacing: 0.3,
  },
  secondaryBtn: {
    width: "100%",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  secondaryBtnText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontFamily: "DMSans_500Medium",
  },
});
