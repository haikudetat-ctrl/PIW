// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userRpc: vi.fn(),
  serviceRpc: vi.fn(),
  invite: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({ rpc: mocks.userRpc })),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    rpc: mocks.serviceRpc,
    auth: { admin: { inviteUserByEmail: mocks.invite } },
  })),
}));

const { createCompany, inviteMember, switchCompany, updateMember } = await import("./actions");

const COMPANY = "10000000-0000-4000-8000-000000000001";
const NEW_COMPANY = "10000000-0000-4000-8000-000000000002";

function access(role: string, isPlatformAdmin = false) {
  return {
    data: [{ user_id: "u1", company_id: COMPANY, display_name: "Chris", role, is_platform_admin: isPlatformAdmin }],
    error: null,
  };
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.serviceRpc.mockResolvedValue({ data: "user-2", error: null });
  mocks.invite.mockResolvedValue({ data: {}, error: null });
});

test("a company admin invites someone into their company with the chosen role", async () => {
  mocks.userRpc.mockResolvedValue(access("company_admin"));

  const result = await inviteMember(null, form({ displayName: "Riley Kane", email: "Riley@Example.com ", role: "manager" }));

  expect(result).toEqual({ ok: true, message: "Invitation sent to riley@example.com." });
  expect(mocks.invite).toHaveBeenCalledWith("riley@example.com", {
    redirectTo: "https://piw-sepia.vercel.app/auth/confirm?next=/reset-password",
    data: { display_name: "Riley Kane" },
  });
  expect(mocks.serviceRpc).toHaveBeenCalledWith("grant_company_membership", {
    p_email: "riley@example.com",
    p_company_id: COMPANY,
    p_role: "manager",
    p_display_name: "Riley Kane",
  });
});

test("someone who already has a login is added without a second email", async () => {
  mocks.userRpc.mockResolvedValue(access("company_admin"));
  mocks.invite.mockResolvedValue({ data: null, error: { message: "A user with this email address has already been registered" } });

  const result = await inviteMember(null, form({ displayName: "Riley Kane", email: "riley@example.com", role: "employee" }));

  expect(result).toEqual({ ok: true, message: "Riley Kane already had a login and now has access." });
  expect(mocks.serviceRpc).toHaveBeenCalledWith("grant_company_membership", expect.objectContaining({ p_role: "employee" }));
});

test("managers cannot invite, and super admin is never an assignable role", async () => {
  mocks.userRpc.mockResolvedValue(access("manager"));
  expect(await inviteMember(null, form({ displayName: "A", email: "a@example.com", role: "employee" }))).toEqual({
    error: "Only a company admin can invite people",
  });
  expect(await inviteMember(null, form({ displayName: "A", email: "a@example.com", role: "super_admin" }))).toEqual({
    error: "Enter a name, a valid email and a role",
  });
  expect(mocks.invite).not.toHaveBeenCalled();
});

test("role changes go through the database check and surface its refusal", async () => {
  mocks.userRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "You cannot change your own role or access" } });
  expect(await updateMember("10000000-0000-4000-8000-0000000000aa", "employee", true)).toEqual({
    error: "You cannot change your own role or access",
  });
  expect(mocks.userRpc).toHaveBeenCalledWith("update_company_member", {
    p_user_id: "10000000-0000-4000-8000-0000000000aa",
    p_role: "employee",
    p_is_active: true,
  });
});

test("a super admin creates a company and invites its first admin", async () => {
  mocks.userRpc.mockImplementation(async (name: string) =>
    name === "get_my_access" ? access("super_admin", true) : { data: NEW_COMPANY, error: null },
  );

  const result = await createCompany(
    null,
    form({ name: "Acme Roofing", jobnimbusEnvKey: "JOBNIMBUS_API_KEY_ACME", adminName: "Ana Ruiz", adminEmail: "ana@acme.com" }),
  );

  expect(mocks.userRpc).toHaveBeenCalledWith("create_company", { p_name: "Acme Roofing", p_jobnimbus_env_key: "JOBNIMBUS_API_KEY_ACME" });
  expect(mocks.serviceRpc).toHaveBeenCalledWith("grant_company_membership", {
    p_email: "ana@acme.com",
    p_company_id: NEW_COMPANY,
    p_role: "company_admin",
    p_display_name: "Ana Ruiz",
  });
  expect(result).toEqual({ ok: true, message: "Acme Roofing created. Invitation sent to ana@acme.com." });
});

test("only a super admin creates companies, and the key name must be a JobNimbus key", async () => {
  mocks.userRpc.mockResolvedValue(access("company_admin"));
  expect(await createCompany(null, form({ name: "Acme", jobnimbusEnvKey: "", adminName: "", adminEmail: "" }))).toEqual({
    error: "Only a super admin can create companies",
  });
  expect(await createCompany(null, form({ name: "Acme", jobnimbusEnvKey: "DATABASE_URL", adminName: "", adminEmail: "" }))).toEqual({
    error: "Use a name like JOBNIMBUS_API_KEY_ACME",
  });
});

test("switching company reloads the app in the new company", async () => {
  mocks.userRpc.mockResolvedValue({ data: null, error: null });
  await switchCompany(NEW_COMPANY);
  expect(mocks.userRpc).toHaveBeenCalledWith("switch_active_company", { p_company_id: NEW_COMPANY });
  expect(mocks.redirect).toHaveBeenCalledWith("/");
});
