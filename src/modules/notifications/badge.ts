export function formatNotificationBadge(unreadCount: number): string {
  return unreadCount > 0 ? `Notifications (${unreadCount})` : "Notifications";
}
