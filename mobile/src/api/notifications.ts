import { api } from "./client";

export interface ServerNotification {
  id: string;
  title: string;
  body: string;
  category: "security" | "update" | "promotion" | "maintenance";
  priority: "low" | "normal" | "high" | "critical";
  read: boolean;
  read_at: string | null;
  delivered_via: string;
  created_at: string;
}

export interface UnreadCountResponse {
  unread_count: number;
}

export interface PaginatedNotifications {
  count: number;
  next: string | null;
  previous: string | null;
  results: ServerNotification[];
}

/** Full detail response for the modal. Includes sender, timestamps,
 *  engagement counters, and edit metadata. */
export interface NotificationDetail extends ServerNotification {
  opened_at: string | null;
  open_count: number;
  sent_at: string;
  sender_name: string;
  is_edited: boolean;
  last_edited_at: string | null;
}

/** Admin per-broadcast stats. Distinguishes "read" (scrolled past in the
 *  list) from "opened" (actually tapped the notification card). */
export interface AdminNotificationStatsDetail {
  id: string;
  title: string;
  body: string;
  category: ServerNotification["category"];
  priority: ServerNotification["priority"];
  created_at: string;
  updated_at: string;
  edit_count: number;
  created_by: string | null;
  totals: {
    recipients: number;
    read: number;
    opened: number;
    total_opens: number;
    read_rate_percent: number;
    open_rate_percent: number;
  };
  channels: Array<{ channel: string; count: number }>;
}

export const notificationsApi = {
  /** Fetch user notifications (paginated). */
  list: (page = 1, category?: string) => {
    const params: Record<string, string | number> = { page };
    if (category && category !== "all") {
      params.category = category;
    }
    return api.get<PaginatedNotifications>("/notifications/", { params });
  },

  /** Fetch full notification detail. Records an "opened" event server-side
   *  · the returned `open_count` reflects this call. */
  detail: (id: string) =>
    api.get<NotificationDetail>(`/notifications/${id}/`),

  /** Get unread notification count. */
  unreadCount: () =>
    api.get<UnreadCountResponse>("/notifications/unread-count/"),

  /** Mark a single notification as read. */
  markRead: (id: string) =>
    api.post(`/notifications/${id}/read/`),

  /** Mark all notifications as read. */
  markAllRead: () =>
    api.post("/notifications/read-all/"),

  // ── Admin ───────────────────────────────────────────────────────────
  /** Fetch per-broadcast stats (admin only). */
  adminStatsDetail: (id: string) =>
    api.get<AdminNotificationStatsDetail>(`/notifications/admin/${id}/stats/`),

  /** Edit a broadcast (admin only). Updates propagate to every delivered
   *  copy via the ForeignKey join. Email/SMS are not re-sent; the edit
   *  surfaces in the in-app detail view with an "Edited" badge. */
  adminEdit: (
    id: string,
    patch: Partial<Pick<ServerNotification, "title" | "body" | "category" | "priority">>,
  ) => api.patch<{ status: string; edit_count: number; changed_fields: string[]; updated_at: string }>(
    `/notifications/admin/${id}/`,
    patch,
  ),
};
