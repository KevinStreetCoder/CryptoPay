import { useEffect } from "react";
import { useRouter } from "expo-router";

/**
 * Public route: /terms
 * Redirects to the full Terms & Privacy screen with the terms tab active.
 * This URL is linked from email templates, app store listings, and legal docs.
 */
export default function TermsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/settings/terms?tab=terms" as any);
  }, [router]);

  return null;
}
