import { useEffect } from "react";
import { useRouter } from "expo-router";

/**
 * Public route: /privacy
 * Redirects to the full Terms & Privacy screen with the privacy tab active.
 * This URL is linked from email templates, app store listings, and legal docs.
 */
export default function PrivacyRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/settings/terms?tab=privacy" as any);
  }, [router]);

  return null;
}
