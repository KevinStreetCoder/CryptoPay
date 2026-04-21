import { useCallback, useRef } from "react";
import { paymentsApi } from "../api/payments";

const POLL_INTERVAL = 3000; // 3 seconds
const MAX_POLL_DURATION = 120000; // 2 minutes timeout

type TransactionStatus = "pending" | "processing" | "confirming" | "completed" | "failed";

interface PollResult {
  status: TransactionStatus;
  transaction: any;
}

/**
 * Polls a transaction until it reaches a terminal state (completed/failed)
 * or times out. Used by all payment flows to wait for backend confirmation
 * before showing success.
 */
export function useTransactionPoller() {
  const abortRef = useRef(false);

  const pollTransaction = useCallback(
    async (
      transactionId: string,
      onStatusChange?: (status: TransactionStatus) => void
    ): Promise<PollResult> => {
      abortRef.current = false;
      const startTime = Date.now();

      if (!transactionId) {
        // No transaction ID · can't poll, return immediately
        return { status: "processing", transaction: null };
      }

      // Initial delay · give backend time to process STK Push
      onStatusChange?.("processing");
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));

      while (!abortRef.current) {
        try {
          const { data } = await paymentsApi.transactionStatus(transactionId);
          const status = (data.status || "processing") as TransactionStatus;

          onStatusChange?.(status);

          if (status === "completed" || status === "failed") {
            return { status, transaction: data };
          }
        } catch {
          // Network error · keep polling (backend might be temporarily unavailable)
        }

        // Check timeout
        if (Date.now() - startTime > MAX_POLL_DURATION) {
          // Timed out · still processing, navigate with current status
          return { status: "processing", transaction: null };
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      }

      return { status: "processing", transaction: null };
    },
    []
  );

  const cancel = useCallback(() => {
    abortRef.current = true;
  }, []);

  return { pollTransaction, cancel };
}
