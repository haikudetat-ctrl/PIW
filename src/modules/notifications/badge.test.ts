import { expect, test } from "vitest";
import { formatNotificationBadge } from "./badge";

test("shows a plain label with zero unread notifications", () => {
  expect(formatNotificationBadge(0)).toBe("Notifications");
});

test("shows the unread count", () => {
  expect(formatNotificationBadge(3)).toBe("Notifications (3)");
});
