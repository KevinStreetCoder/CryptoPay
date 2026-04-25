/**
 * On-device bank preferences for the Send-to-Bank picker.
 *
 * Tracks two pieces of state, both persisted via the cross-platform
 * `storage` helper (SecureStore on native, localStorage on web):
 *
 *   1. Favourites · explicit user pins. Renders a pill at the top
 *      of the picker so primary banks are one tap away. List is
 *      capped at 6 entries (FIFO eviction) so it stays scannable.
 *   2. Frequencies · monotonic per-slug counter incremented on
 *      every successful confirmation. The picker surfaces the top
 *      3 counts as a "Frequent" section beneath Favourites. Counts
 *      decay by half every 90 days so a one-off 100-payment burst
 *      doesn't pin a bank forever.
 *
 * This is a pure on-device store · NO server round-trip. The
 * downside is that fresh devices start blank, but the user-control
 * upside (no telemetry, no cross-device leak) is worth it for a
 * picker that's already deterministic on the alphabetical fallback.
 *
 * If we ever ship multi-device favourites the existing keys
 * (`bank_favourites_v1` / `bank_freq_v1`) get renamed and we add a
 * one-way migration · they're not load-bearing in any business flow.
 */
import { storage } from "./storage";

const FAVOURITES_KEY = "bank_favourites_v1";
const FREQ_KEY = "bank_freq_v1";

/** Hard cap so the favourites pill row never wraps to two lines. */
export const MAX_FAVOURITES = 6;
/** How many "frequent" rows to show. Top-N by use count. */
export const FREQUENT_TOP_N = 3;
/** Decay half-life in days · prevents one-off bursts from sticking. */
const DECAY_HALF_LIFE_DAYS = 90;
const DECAY_HALF_LIFE_MS = DECAY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;

interface FreqRow {
  count: number;
  /** Last increment time in ms since epoch · used for decay. */
  ts: number;
}
type FreqMap = Record<string, FreqRow>;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await storage.getItemAsync(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt entry · clear it and return fallback so we never crash
    // the picker because of a previous-version JSON shape.
    try { await storage.deleteItemAsync(key); } catch {}
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await storage.setItemAsync(key, JSON.stringify(value));
  } catch {
    // Storage failures are non-fatal · the picker just degrades to
    // alphabetical (no favourites / no frequents).
  }
}

// ── Favourites ─────────────────────────────────────────────────────

export async function getFavouriteBanks(): Promise<string[]> {
  const arr = await readJson<unknown>(FAVOURITES_KEY, []);
  if (!Array.isArray(arr)) return [];
  // Filter to non-empty strings · defensive against partial corruption.
  return arr.filter((s): s is string => typeof s === "string" && s.length > 0);
}

export async function isFavourite(slug: string): Promise<boolean> {
  const favs = await getFavouriteBanks();
  return favs.includes(slug);
}

export async function toggleFavourite(slug: string): Promise<string[]> {
  if (!slug) return getFavouriteBanks();
  const favs = await getFavouriteBanks();
  let next: string[];
  if (favs.includes(slug)) {
    next = favs.filter((s) => s !== slug);
  } else {
    // Newest pin lands at the head · feels right for a recency-tinted
    // pin row, and FIFO-evicts the oldest if we hit MAX_FAVOURITES.
    next = [slug, ...favs.filter((s) => s !== slug)].slice(0, MAX_FAVOURITES);
  }
  await writeJson(FAVOURITES_KEY, next);
  return next;
}

// ── Frequencies ────────────────────────────────────────────────────

function decayCount(row: FreqRow, now: number): number {
  if (!row || !row.count) return 0;
  const ageMs = Math.max(0, now - row.ts);
  if (ageMs <= 0) return row.count;
  // Continuous-half-life decay · count * 0.5 ^ (age / halfLife).
  const halfLives = ageMs / DECAY_HALF_LIFE_MS;
  return row.count * Math.pow(0.5, halfLives);
}

async function readFreqMap(): Promise<FreqMap> {
  const obj = await readJson<unknown>(FREQ_KEY, {});
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  // Coerce shape · guard against legacy values where we stored a bare
  // count number under a slug rather than `{count, ts}`.
  const out: FreqMap = {};
  const now = Date.now();
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === "number") {
      out[k] = { count: v, ts: now };
    } else if (
      v && typeof v === "object" &&
      typeof (v as any).count === "number" &&
      typeof (v as any).ts === "number"
    ) {
      out[k] = { count: (v as any).count, ts: (v as any).ts };
    }
  }
  return out;
}

export async function recordBankUse(slug: string): Promise<void> {
  if (!slug) return;
  const map = await readFreqMap();
  const now = Date.now();
  const prev = map[slug];
  const decayed = prev ? decayCount(prev, now) : 0;
  map[slug] = { count: decayed + 1, ts: now };
  await writeJson(FREQ_KEY, map);
}

/**
 * Top-N most-frequent bank slugs (excluding favourites · favourites
 * already have their own pinned row, so duplicating them in "Frequent"
 * just wastes scannable space).
 */
export async function getFrequentBanks(
  excludeSlugs: string[] = [],
  limit: number = FREQUENT_TOP_N,
): Promise<string[]> {
  const map = await readFreqMap();
  const now = Date.now();
  const exclude = new Set(excludeSlugs);
  const decayed: Array<{ slug: string; count: number }> = [];
  for (const [slug, row] of Object.entries(map)) {
    if (exclude.has(slug)) continue;
    const c = decayCount(row, now);
    if (c <= 0.05) continue; // ignore rounded-out residue
    decayed.push({ slug, count: c });
  }
  decayed.sort((a, b) => b.count - a.count);
  return decayed.slice(0, limit).map((r) => r.slug);
}

/** Test / settings hook · wipes both stores. */
export async function clearBankPrefs(): Promise<void> {
  await Promise.all([
    storage.deleteItemAsync(FAVOURITES_KEY),
    storage.deleteItemAsync(FREQ_KEY),
  ]);
}
