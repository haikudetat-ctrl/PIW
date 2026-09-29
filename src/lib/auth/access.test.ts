import { describe, expect, it } from "vitest";
import { canUseCrm, hasRole, parseMyAccess } from "./access";

const row = {
  user_id: "user-1",
  company_id: "company-1",
  display_name: "Jane",
  role: "manager",
  is_platform_admin: false,
};

describe("parseMyAccess", () => {
  it("maps the database row", () => {
    expect(parseMyAccess([row])).toEqual({
      userId: "user-1",
      companyId: "company-1",
      displayName: "Jane",
      role: "manager",
      isPlatformAdmin: false,
    });
  });

  it("returns null when the user has no active access", () => {
    expect(parseMyAccess([])).toBeNull();
    expect(parseMyAccess(null)).toBeNull();
  });

  it("rejects a role the app does not know", () => {
    expect(parseMyAccess([{ ...row, role: "owner" }])).toBeNull();
  });
});

describe("role checks", () => {
  it("orders the four tiers", () => {
    expect(hasRole({ role: "super_admin" }, "company_admin")).toBe(true);
    expect(hasRole({ role: "company_admin" }, "manager")).toBe(true);
    expect(hasRole({ role: "manager" }, "company_admin")).toBe(false);
    expect(hasRole({ role: "employee" }, "employee")).toBe(true);
  });

  it("limits the existing CRM to managers and above", () => {
    expect(canUseCrm({ role: "manager" })).toBe(true);
    expect(canUseCrm({ role: "employee" })).toBe(false);
  });
});
