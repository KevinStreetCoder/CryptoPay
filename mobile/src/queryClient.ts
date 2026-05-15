/**
 * Shared React Query client singleton.
 *
 * 2026-05-15 · extracted from app/_layout.tsx so auth.ts (login/logout)
 * can call `removeQueries` / `clear` to wipe stale user data when the
 * session changes. Previously the QueryClient lived inside _layout.tsx
 * with no exported handle · the cache survived logout and on re-login
 * served the PREVIOUS user's balance for a few hundred milliseconds
 * before the background refetch landed. The user saw a "wrong value
 * flash" on the BalanceCard immediately after login.
 *
 * Now `auth.ts::login()` calls `queryClient.removeQueries({ queryKey:
 * ["wallets"] })` (and a few peers) so the next render has no cached
 * data · BalanceCardSkeleton fires correctly until the fresh fetch
 * lands.
 */
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Don't retry if session expired · user needs to re-login
        if (error && (error as any).name === "SessionExpiredError") return false;
        return failureCount < 2;
      },
      staleTime: 30000,
    },
  },
});

/**
 * Query-key sets that belong to the current user · cleared on every
 * login (so a previous session can't leak into the new one) and on
 * logout (so the next user / re-login starts cold).
 *
 * Add new user-scoped queries here as they appear in the app.
 */
export const USER_SCOPED_QUERY_KEYS: ReadonlyArray<string> = [
  "wallets",
  "transactions",
  "activity",
  "unread-count",
  "profile",
  "balance",
  "rate-alerts",
  "devices",
  "referrals",
];

/**
 * Drop every query whose first key segment matches one of the user-
 * scoped keys above. Cheaper + safer than `queryClient.clear()`
 * because it leaves cross-user queries (rates, supported-currencies,
 * config) cached.
 */
export function clearUserScopedQueries() {
  for (const key of USER_SCOPED_QUERY_KEYS) {
    queryClient.removeQueries({ queryKey: [key] });
  }
}
