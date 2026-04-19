import axios from "axios";
import { api } from "./client";
import { config } from "../constants/config";

export interface MyReferralTotals {
  invited_sent: number;
  signed_up: number;
  qualified: number;
  total_earned_kes: string;
  available_credit_kes: string;
  pending_credit_kes: string;
}

export interface MyReferralResponse {
  code: string;
  share_url: string;
  share_message_en: string;
  share_message_sw: string;
  totals: MyReferralTotals;
  bonus_per_referral_kes: string;
  referee_bonus_kes: string;
  can_invite_more: boolean;
}

export interface ReferralHistoryItem {
  id: string;
  status: "signed_up" | "qualified" | "rewarded" | "clawed_back" | "rejected_fraud" | "pending";
  status_display: string;
  referee_masked_name: string;
  referee_masked_phone: string;
  attributed_at: string;
  qualified_at: string | null;
  rewarded_at: string | null;
  reward_amount_kes: string;
}

export interface ReferralHistoryPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: ReferralHistoryItem[];
}

export interface ValidateCodeResponse {
  valid: boolean;
  referrer_first_name?: string;
  reward_preview_kes?: string;
}

export interface PublicReferralLanding {
  is_valid: boolean;
  first_name?: string;
  reward_preview_kes?: string;
}

/** GET /referrals/me/ — the logged-in user's code, share URL, totals. */
export async function getMyReferral(): Promise<MyReferralResponse> {
  const { data } = await api.get<MyReferralResponse>("/referrals/me/");
  return data;
}

/** GET /referrals/history/?page=N — paginated referrals this user made. */
export async function getReferralHistory(page = 1): Promise<ReferralHistoryPage> {
  const { data } = await api.get<ReferralHistoryPage>(`/referrals/history/?page=${page}`);
  return data;
}

/** POST /referrals/share-event/ — record a share action (increments counter + logs). */
export async function logShareEvent(channel: string): Promise<void> {
  await api.post("/referrals/share-event/", { channel });
}

/** POST /referrals/validate/ — preflight check a code at sign-up time. Unauthenticated. */
export async function validateCode(code: string): Promise<ValidateCodeResponse> {
  try {
    const { data } = await api.post<ValidateCodeResponse>("/referrals/validate/", {
      code: code.trim().toUpperCase(),
    });
    return data;
  } catch {
    return { valid: false };
  }
}

/** GET /r/{code}/public/ — served publicly for the share-preview landing page.
 *  Lives at the site root (not under /api/v1/) so we strip the api prefix. */
export async function getPublicReferral(code: string): Promise<PublicReferralLanding> {
  try {
    const root = config.apiUrl.replace(/\/api\/v1\/?$/, "");
    const { data } = await axios.get<PublicReferralLanding>(
      `${root}/r/${code.trim().toUpperCase()}/public/`,
      { timeout: 10000 }
    );
    return data;
  } catch {
    return { is_valid: false };
  }
}
