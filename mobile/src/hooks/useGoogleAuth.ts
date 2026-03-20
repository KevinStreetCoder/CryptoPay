import { useEffect } from "react";
import { Platform } from "react-native";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import Constants from "expo-constants";

WebBrowser.maybeCompleteAuthSession();

// Google OAuth Client IDs
const GOOGLE_WEB_CLIENT_ID =
  Constants.expoConfig?.extra?.googleWebClientId ||
  process.env.GOOGLE_WEB_CLIENT_ID ||
  "797403635202-t2i871kkg2qfsoq19appg47c6ud0c6ac.apps.googleusercontent.com";
const GOOGLE_ANDROID_CLIENT_ID =
  Constants.expoConfig?.extra?.googleAndroidClientId ||
  process.env.GOOGLE_ANDROID_CLIENT_ID ||
  "797403635202-rr8vc02i4ba7j5hs1iqp7nev845pb69t.apps.googleusercontent.com";
const GOOGLE_IOS_CLIENT_ID =
  Constants.expoConfig?.extra?.googleIosClientId ||
  process.env.GOOGLE_IOS_CLIENT_ID ||
  "";

// EAS project ID for auth proxy redirect
const PROJECT_ID =
  Constants.expoConfig?.extra?.eas?.projectId || "3ca5c56b-30ff-454d-ad81-801f8d888db8";

/**
 * Build the correct redirect URI per platform:
 * - Web: standard redirect to auth/google/callback
 * - Android/iOS standalone (EAS): use Expo auth proxy via projectId
 *   This generates https://auth.expo.io which Google accepts as a valid redirect.
 *   The custom scheme (cryptopay://) does NOT work with Google OAuth.
 */
function getRedirectUri(): string {
  if (Platform.OS === "web") {
    return makeRedirectUri({ path: "auth/google/callback" });
  }
  // For native (Android/iOS), use the Expo auth proxy
  // This generates: https://auth.expo.io/@anonymous/cryptopay
  // which must be added to Google Cloud Console as an authorized redirect URI
  return makeRedirectUri({
    native: `${Constants.expoConfig?.scheme ?? "cryptopay"}://`,
  } as any);
}

/**
 * Hook that wraps expo-auth-session Google provider.
 * Returns the Google ID token on success.
 */
export function useGoogleAuth() {
  const redirectUri = getRedirectUri();

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    redirectUri,
  });

  // Wrap promptAsync to pass useProxy on native platforms
  const wrappedPromptAsync = () => {
    if (Platform.OS === "web") {
      return promptAsync();
    }
    // On native, use the Expo auth proxy so Google gets an https:// redirect
    return promptAsync({ useProxy: true } as any);
  };

  return {
    /** Whether the Google auth request is ready to prompt */
    ready: !!request,
    /** The auth response (check response?.type === "success") */
    response,
    /** Trigger Google Sign-In prompt */
    promptAsync: wrappedPromptAsync,
    /** Extract the id_token from a successful response */
    getIdToken: (): string | null => {
      if (response?.type === "success") {
        return response.params.id_token ?? null;
      }
      return null;
    },
  };
}
