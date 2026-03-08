import { useEffect } from "react";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";

WebBrowser.maybeCompleteAuthSession();

// These would come from environment/app config in production
const GOOGLE_WEB_CLIENT_ID =
  Constants.expoConfig?.extra?.googleWebClientId ?? "";
const GOOGLE_ANDROID_CLIENT_ID =
  Constants.expoConfig?.extra?.googleAndroidClientId ?? "";
const GOOGLE_IOS_CLIENT_ID =
  Constants.expoConfig?.extra?.googleIosClientId ?? "";

/**
 * Hook that wraps expo-auth-session Google provider.
 * Returns the Google ID token on success.
 */
export function useGoogleAuth() {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
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
