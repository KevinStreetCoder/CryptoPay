/**
 * Google OAuth redirect landing route.
 *
 * When Google completes sign-in on web it redirects the browser back to
 * `https://cpay.co.ke/auth/google/callback#id_token=...&state=...`.
 *
 * `expo-auth-session` normally handles this silently by closing the popup
 * window and resolving the promise started by `promptAsync()`. But when the
 * OAuth flow opens in the SAME browser tab (no popup — common on mobile
 * Safari, some in-app browsers, or when the OAuth client is a pure "Web
 * application" type), the browser lands on this URL and Expo Router renders
 * "Unmatched Route" because there was no file at this path.
 *
 * This file fixes that: it calls `WebBrowser.maybeCompleteAuthSession()` to
 * complete the flow, then parses the id_token from the URL fragment and
 * dispatches it to the backend Google-login endpoint. On success it routes
 * to the main app; on failure it routes back to login with an error toast.
 */
import { useEffect } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";

import { useAuth } from "../../../src/stores/auth";
import { useToast } from "../../../src/components/Toast";
import { LoadingScreen } from "../../../src/components/LoadingScreen";

// Complete any in-flight OAuth session — closes the popup if one is open
// and resolves the promptAsync() promise back in the origin tab. Must run
// at module scope for expo-auth-session to pick it up.
WebBrowser.maybeCompleteAuthSession();

export default function GoogleCallback() {
  const { googleLogin } = useAuth();
  const toast = useToast();

  useEffect(() => {
    if (Platform.OS !== "web") {
      // Native devices never land here — the auth proxy returns directly to
      // the app via the custom scheme. Safety net: go to login.
      router.replace("/auth/login" as any);
      return;
    }

    // Google returns the token after the URL fragment (#).
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (!hash || hash.length < 2) {
      // If this is actually a popup tab, maybeCompleteAuthSession() above has
      // already closed it. Only the non-popup case reaches here with no hash.
      toast.error("Google Sign-In", "No token returned. Please try again.");
      router.replace("/auth/login" as any);
      return;
    }

    const params = new URLSearchParams(hash.slice(1));
    const idToken = params.get("id_token");
    const error = params.get("error");

    if (error) {
      toast.error("Google Sign-In", error);
      router.replace("/auth/login" as any);
      return;
    }

    if (!idToken) {
      toast.error("Google Sign-In", "Missing identity token. Please try again.");
      router.replace("/auth/login" as any);
      return;
    }

    // Exchange the Google ID token for our own JWT pair.
    (async () => {
      try {
        const data: any = await googleLogin(idToken);
        if (data?.requires_profile_completion) {
          router.replace("/auth/google-complete-profile" as any);
        } else {
          router.replace("/(tabs)" as any);
        }
      } catch (err) {
        const message =
          (err as any)?.response?.data?.error ||
          (err as Error)?.message ||
          "Sign-in failed. Please try again.";
        toast.error("Google Sign-In", message);
        router.replace("/auth/login" as any);
      }
    })();
  }, []);

  return <LoadingScreen status="Completing sign-in..." />;
}
