import { storage } from "../utils/storage";

const STORAGE_KEY = "notifications_read_ids";

/**
 * Shared notification read-state store.
 * Uses a listener pattern (like auth store) so both the dashboard bell
 * and the notifications inbox react to the same state.
 */

let _readIds: Set<string> = new Set();
let _loaded = false;
const _listeners: Set<() => void> = new Set();

function notify() {
  _listeners.forEach((l) => l());
}

async function persist() {
  // Store as JSON array · keep last 200 IDs to avoid unbounded growth
  const arr = Array.from(_readIds).slice(-200);
  await storage.setItemAsync(STORAGE_KEY, JSON.stringify(arr));
}

/** Load read IDs from storage (call once on app start). */
export async function loadReadIds(): Promise<void> {
  if (_loaded) return;
  try {
    const raw = await storage.getItemAsync(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      _readIds = new Set(arr);
    }
  } catch {
    // ignore parse errors
  }
  _loaded = true;
  notify();
}

/** Check if a notification/transaction ID has been read. */
export function isRead(id: string): boolean {
  return _readIds.has(id);
}

/** Mark a single notification as read. */
export async function markRead(id: string): Promise<void> {
  if (_readIds.has(id)) return;
  _readIds.add(id);
  notify();
  await persist();
}

/** Mark multiple IDs as read at once. */
export async function markAllRead(ids: string[]): Promise<void> {
  let changed = false;
  for (const id of ids) {
    if (!_readIds.has(id)) {
      _readIds.add(id);
      changed = true;
    }
  }
  if (changed) {
    notify();
    await persist();
  }
}

/** Get the count of unread IDs from a list of transaction IDs. */
export function getUnreadCount(txIds: string[]): number {
  if (!_loaded) return 0;
  return txIds.filter((id) => !_readIds.has(id)).length;
}

/** Subscribe to read-state changes. Returns an unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/** Whether the store has loaded from storage. */
export function isLoaded(): boolean {
  return _loaded;
}
