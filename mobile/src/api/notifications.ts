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

export const notificationsApi = {
  /** Fetch user notifications (paginated). */
  list: (page = 1, category?: string) => {
    const params: Record<string, string | number> = { page };
    if (category && category !== "all") {
      params.category = category;
    }
    return api.get<PaginatedNotifications>("/notifications/", { params });
  },

  /** Get unread notification count. */
  unreadCount: () =>
    api.get<UnreadCountResponse>("/notifications/unread-count/"),

  /** Mark a single notification as read. */
  markRead: (id: string) =>
    api.post(`/notifications/${id}/read/`),

  /** Mark all notifications as read. */
  markAllRead: () =>
    api.post("/notifications/read-all/"),
};
