import { Platform } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "../src/stores/auth";
import LandingPage from "./landing";

/**
 * Root route (cpay.co.ke/)
 * - Unauthenticated web visitors → Landing page (no /landing URL)
 * - Unauthenticated native → Login
 * - Authenticated → Dashboard
 * - app.cpay.co.ke → Login
 */
export default function RootIndex() {
  const { user } = useAuth();

  // Authenticated → dashboard
  if (user) {
    return <Redirect href="/(tabs)" />;
  }

  // Web: check if app subdomain
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const host = window.location?.hostname || "";
    if (host === "app.cpay.co.ke") {
      return <Redirect href="/auth/login" />;
    }
    // cpay.co.ke root → render landing page directly (no URL change)
    return <LandingPage />;
  }

  // Native → login
  return <Redirect href="/auth/login" />;
}
