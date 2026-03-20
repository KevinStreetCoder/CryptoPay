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

/**
 * Hook that wraps expo-auth-session Google provider.
 * Returns the Google ID token on success.
 */
export function useGoogleAuth() {
  const redirectUri = Platform.OS === "web"
    ? makeRedirectUri({ path: "auth/google/callback" })
    : undefined;

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    redirectUri,
  });

  return {
    /** Whether the Google auth request is ready to prompt */
    ready: !!request,
    /** The auth response (check response?.type === "success") */
    response,
    /** Trigger Google Sign-In prompt */
    promptAsync,
    /** Extract the id_token from a successful response */
    getIdToken: (): string | null => {
      if (response?.type === "success") {
        return response.params.id_token ?? null;
      }
      return null;
    },
  };
}
