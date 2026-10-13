import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn(async () => ({ rpc })) }));
vi.mock("../actions", () => ({ inviteMember: vi.fn(), updateMember: vi.fn() }));

const { default: TeamSettingsPage } = await import("./page");

const ME = "10000000-0000-4000-8000-000000000001";

test("lists members with role controls, status and the role guide", async () => {
  rpc.mockImplementation(async (name: string) =>
    name === "get_my_access"
      ? { data: [{ user_id: ME, company_id: "c1", display_name: "Chris", role: "super_admin", is_platform_admin: true }], error: null }
      : {
          data: [
            { user_id: ME, email: "chris@example.com", display_name: "Chris Boland", role: "company_admin", is_active: true, invited_at: null, confirmed: true, last_sign_in_at: "2026-10-14T12:00:00Z", open_tasks: 0 },
            { user_id: "u2", email: "jordan@example.com", display_name: "Jordan Miles", role: "manager", is_active: true, invited_at: null, confirmed: true, last_sign_in_at: "2026-10-14T11:00:00Z", open_tasks: 5 },
            { user_id: "u3", email: "sam@example.com", display_name: "sam@example.com", role: "employee", is_active: true, invited_at: "2026-10-13T00:00:00Z", confirmed: false, last_sign_in_at: null, open_tasks: 0 },
            { user_id: "u4", email: "tess@example.com", display_name: "Tess Dunn", role: "employee", is_active: false, invited_at: null, confirmed: true, last_sign_in_at: null, open_tasks: 0 },
          ],
          error: null,
        },
  );

  render(await TeamSettingsPage());

  expect(screen.getByText("2 members · 1 pending invite")).toBeInTheDocument();
  const members = screen.getByRole("region", { name: "Members" });
  // You cannot change your own role.
  expect(within(members).queryByRole("combobox", { name: "Role for Chris Boland" })).not.toBeInTheDocument();
  expect(within(members).getByRole("combobox", { name: "Role for Jordan Miles" })).toHaveValue("manager");
  expect(within(members).getByText("Invite sent")).toBeInTheDocument();
  expect(within(members).getByText("Deactivated")).toBeInTheDocument();
  expect(within(members).getByRole("button", { name: "Reactivate" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Super admin" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Invite" })).toBeInTheDocument();
});
