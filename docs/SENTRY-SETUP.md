# Sentry Error Tracking Setup

## Backend (Django) -- Already Configured

The Django backend has Sentry fully integrated in `backend/config/settings/production.py`.

### Required Environment Variables

```bash
SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
SENTRY_ENVIRONMENT=production        # or staging
SENTRY_TRACES_SAMPLE_RATE=0.1        # 10% of requests traced (adjust for volume)
```

### Integrations Active
- **DjangoIntegration** -- catches unhandled exceptions, slow DB queries
- **CeleryIntegration** -- tracks task failures, retries, timeouts
- **RedisIntegration** -- monitors cache/queue errors

### Verification
1. Set `SENTRY_DSN` in your `.env`
2. Restart the Django process
3. Trigger a test error: `python manage.py shell -c "1/0"` or visit a broken URL
4. Check your Sentry dashboard for the event

---

## Frontend (React Native / Expo) -- Setup Required

The mobile app does **not** yet have `@sentry/react-native` installed.

### Step 1: Install the Package

```bash
cd mobile
npx expo install @sentry/react-native
```

### Step 2: Add Sentry Initialization

Edit `mobile/app/_layout.tsx` and add near the top (before the component):

```typescript
import * as Sentry from "@sentry/react-native";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN || "",
  environment: __DEV__ ? "development" : "production",
  tracesSampleRate: __DEV__ ? 1.0 : 0.2,
  enableAutoSessionTracking: true,
  attachScreenshot: true,
  // Don't send PII
  sendDefaultPii: false,
  // Only enable in production builds
  enabled: !__DEV__,
  beforeSend(event) {
    // Scrub sensitive data from breadcrumbs
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((b) => {
        if (b.data?.url?.includes("/auth/")) {
          b.data = { ...b.data, body: "[REDACTED]" };
        }
        return b;
      });
    }
    return event;
  },
});
```

### Step 3: Wrap the Root Layout

In `_layout.tsx`, wrap the exported component:

```typescript
export default Sentry.wrap(RootLayout);
```

### Step 4: Add Environment Variable

Add to `mobile/.env` (and EAS secrets):

```bash
EXPO_PUBLIC_SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
```

### Step 5: EAS Build Configuration

For source maps and proper stack traces in production:

```bash
# Install the Sentry Expo plugin
npx expo install @sentry/react-native

# Add to app.json plugins array:
# ["@sentry/react-native/expo", {
#   "organization": "your-org",
#   "project": "cryptopay-mobile"
# }]
```

Add to `mobile/eas.json` build profiles:

```json
{
  "build": {
    "production": {
      "env": {
        "SENTRY_AUTH_TOKEN": "sntrys_YOUR_TOKEN_HERE"
      }
    }
  }
}
```

### Step 6: Error Boundary Integration

The existing `ErrorBoundary` component at `mobile/src/components/ErrorBoundary.tsx` already catches React errors. After installing Sentry, update it to report:

```typescript
componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
  console.error("ErrorBoundary caught:", error, errorInfo);
  // Add this line:
  Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
}
```

### Step 7: Verify

1. Build with EAS: `eas build --platform ios --profile preview`
2. Open the app and trigger `Sentry.captureMessage("Test from CryptoPay mobile")`
3. Check your Sentry dashboard

---

## Recommended Sentry Project Setup

- Create two Sentry projects: `cryptopay-backend` (Python/Django) and `cryptopay-mobile` (React Native)
- Set up alerts for:
  - New unhandled exceptions
  - Payment task failures (`apps.payments.*`, `apps.mpesa.*`)
  - Blockchain listener errors (`apps.blockchain.*`)
  - Error rate spike > 5% of transactions
- Configure release tracking to correlate deploys with error rates
