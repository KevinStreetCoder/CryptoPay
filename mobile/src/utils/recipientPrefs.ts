/**
 * On-device recipient preferences for ALL payment rails.
 *
 * Generalises `bankPrefs.ts` to cover paybill / till / phone / bank
 * pickers behind a single API. Each rail gets its own namespaced
 * storage key so a frequent KPLC paybill (888880) never collides
 * with a frequent phone number that happens to share the digits.
 *
 * Two stores per rail (mirrors bankPrefs):
 *   1. Favourites · explicit user pins. Cap 6 per rail (FIFO eviction)
 *      so the favourites pill row never wraps.
 *   2. Frequencies · monotonic per-recipient counter incremented on
 *      every successful confirmation. Top-N (default 3) surface in a
 *      "Frequent" section beneath Favourites. Counts decay by half
 *      every 90 days so a one-off burst doesn't pin forever.
 *
 * Stores label-with-id pairs so the picker can render
 * "KPLC PREPAID · 888880" rather than just "888880" · resolved label
 * comes from `merchant_name` / phone-holder lookup at the time of use.
 *
 * Pure on-device · NO server round-trip. Fresh devices start blank
 * (acceptable trade-off · alphabetical/numerical fallback works).
 *
 * 2026-05-09 · created so the paybill / till / send / send-to-bank
 * pickers all render consistent "Frequent" + "Favourite" sections.
 */
import { storage } from "./storage";

// ── Rail-namespaced keys ──────────────────────────────────────────
// Increment the suffix when shape changes · graceful migration
// happens via `readJson<T>(key, fallback)` returning fallback on parse
// failure (the corrupt entry is wiped on read).
type RecipientRail = "bank" | "paybill" | "till" | "phone";

const KEY_FAV_PREFIX = "recipient_fav_v1";
const KEY_FREQ_PREFIX = "recipient_freq_v1";

const favKey = (rail: RecipientRail) => `${KEY_FAV_PREFIX}_${rail}`;
const freqKey = (rail: RecipientRail) => `${KEY_FREQ_PREFIX}_${rail}`;

/** Hard cap so the favourites pill row never wraps to two lines. */
export const MAX_FAVOURITES = 6;
/** How many "frequent" rows to show. Top-N by use count. */
export const FREQUENT_TOP_N = 3;
/** Decay half-life in days · prevents one-off bursts from sticking. */
const DECAY_HALF_LIFE_DAYS = 90;
const DECAY_HALF_LIFE_MS = DECAY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;

export interface RecipientEntry {
  /** The wire identifier · paybill #, till #, phone, bank slug. */
  id: string;
  /** Optional label · merchant_name / phone-holder name resolved at
   *  the time of use. Picker renders this above the id when present. */
  label?: string;
  /** Optional account ref for paybill (KPLC meter, DSTV smartcard). */
  account?: string;
}

interface FreqRow extends RecipientEntry {
  count: number;
  ts: number; // last increment, ms since epoch
}
type FreqMap = Record<string, FreqRow>;

// ── Storage helpers ───────────────────────────────────────────────

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await storage.getItemAsync(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    try { await storage.deleteItemAsync(key); } catch {}
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await storage.setItemAsync(key, JSON.stringify(value));
  } catch {
    // Storage failures are non-fatal · the picker just degrades to
    // its alphabetical / numerical fallback.
  }
}

// ── Favourites ────────────────────────────────────────────────────

export async function getFavourites(rail: RecipientRail): Promise<RecipientEntry[]> {
  const arr = await readJson<unknown>(favKey(rail), []);
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s): s is RecipientEntry =>
      !!s && typeof s === "object" && typeof (s as any).id === "string" && (s as any).id.length > 0
    )
    .map((s) => ({ id: s.id, label: s.label, account: s.account }));
}

export async function isFavourite(rail: RecipientRail, id: string, account?: string): Promise<boolean> {
  const favs = await getFavourites(rail);
  return favs.some((f) => f.id === id && (f.account || "") === (account || ""));
}

export async function toggleFavourite(rail: RecipientRail, entry: RecipientEntry): Promise<RecipientEntry[]> {
  if (!entry?.id) return getFavourites(rail);
  const favs = await getFavourites(rail);
  const matchIdx = favs.findIndex(
    (f) => f.id === entry.id && (f.account || "") === (entry.account || "")
  );
  let next: RecipientEntry[];
  if (matchIdx >= 0) {
    next = favs.filter((_, i) => i !== matchIdx);
  } else {
    next = [entry, ...favs.filter(
      (f) => !(f.id === entry.id && (f.account || "") === (entry.account || ""))
    )].slice(0, MAX_FAVOURITES);
  }
  await writeJson(favKey(rail), next);
  return next;
}

// ── Frequencies ───────────────────────────────────────────────────

function decayCount(row: FreqRow, now: number): number {
  if (!row || !row.count) return 0;
  const ageMs = Math.max(0, now - row.ts);
  if (ageMs <= 0) return row.count;
  const halfLives = ageMs / DECAY_HALF_LIFE_MS;
  return row.count * Math.pow(0.5, halfLives);
}

function entryKey(entry: RecipientEntry): string {
  // Compound key so the same paybill with different account refs
  // (e.g. KPLC for two meters) tracks separately.
  return entry.account ? `${entry.id}|${entry.account}` : entry.id;
}

async function readFreqMap(rail: RecipientRail): Promise<FreqMap> {
  const obj = await readJson<unknown>(freqKey(rail), {});
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out: FreqMap = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (
      v && typeof v === "object" &&
      typeof (v as any).count === "number" &&
      typeof (v as any).ts === "number" &&
      typeof (v as any).id === "string"
    ) {
      const r = v as FreqRow;
      out[k] = {
        id: r.id,
        label: r.label,
        account: r.account,
        count: r.count,
        ts: r.ts,
      };
    }
  }
  return out;
}

/**
 * Bump the frequency counter for a recipient · call this from the
 * confirm-screen success path after the saga returns COMPLETED.
 *
 * The label is OPTIONAL · pass the resolved merchant_name when you
 * have it so the picker can render "KPLC PREPAID · 888880" instead
 * of just "888880". When omitted, an existing label on the row is
 * preserved.
 */
export async function recordRecipientUse(
  rail: RecipientRail,
  entry: RecipientEntry,
): Promise<void> {
  if (!entry?.id) return;
  const map = await readFreqMap(rail);
  const now = Date.now();
  const key = entryKey(entry);
  const prev = map[key];
  const decayed = prev ? decayCount(prev, now) : 0;
  map[key] = {
    id: entry.id,
    // Keep an existing label when caller didn't supply one this time
    // · merchant_name lookups can fail transiently and we don't want
    // to clobber a previously-resolved name with empty.
    label: entry.label || prev?.label,
    account: entry.account || prev?.account,
    count: decayed + 1,
    ts: now,
  };
  await writeJson(freqKey(rail), map);
}

/**
 * Top-N most-frequent recipients for a rail (excluding favourites
 * · favourites already have their own pinned section, so duplicating
 * them in "Frequent" wastes scannable space).
 */
export async function getFrequent(
  rail: RecipientRail,
  excludeIds: string[] = [],
  limit: number = FREQUENT_TOP_N,
): Promise<RecipientEntry[]> {
  const map = await readFreqMap(rail);
  const now = Date.now();
  const exclude = new Set(excludeIds);
  const decayed: Array<{ entry: RecipientEntry; count: number }> = [];
  for (const [, row] of Object.entries(map)) {
    if (exclude.has(row.id)) continue;
    const c = decayCount(row, now);
    if (c <= 0.05) continue;
    decayed.push({
      entry: { id: row.id, label: row.label, account: row.account },
      count: c,
    });
  }
  decayed.sort((a, b) => b.count - a.count);
  return decayed.slice(0, limit).map((r) => r.entry);
}

/** Test / settings hook · wipes stores for a single rail (or all). */
export async function clearRecipientPrefs(rail?: RecipientRail): Promise<void> {
  const rails: RecipientRail[] = rail
    ? [rail]
    : ["bank", "paybill", "till", "phone"];
  await Promise.all(rails.flatMap((r) => [
    storage.deleteItemAsync(favKey(r)),
    storage.deleteItemAsync(freqKey(r)),
  ]));
}

export type { RecipientRail };
