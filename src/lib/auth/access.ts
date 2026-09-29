export const COMPANY_ROLES = ["employee", "manager", "company_admin", "super_admin"] as const;

export type CompanyRole = (typeof COMPANY_ROLES)[number];

export type MyAccess = {
  userId: string;
  companyId: string;
  displayName: string;
  role: CompanyRole;
  isPlatformAdmin: boolean;
};

// Mirrors public.company_role_rank in the database, which is what actually
// enforces access. This copy only decides what the UI offers.
export function roleRank(role: CompanyRole): number {
  return COMPANY_ROLES.indexOf(role) + 1;
}

export function hasRole(access: Pick<MyAccess, "role">, minimum: CompanyRole): boolean {
  return roleRank(access.role) >= roleRank(minimum);
}

// The existing CRM (leads, pipeline, review, access route) is Manager and
// above. Employees get a scoped view with the journey dashboard.
export function canUseCrm(access: Pick<MyAccess, "role">): boolean {
  return hasRole(access, "manager");
}

type AccessRow = {
  user_id: string;
  company_id: string;
  display_name: string;
  role: string;
  is_platform_admin: boolean;
};

export function parseMyAccess(rows: AccessRow[] | null | undefined): MyAccess | null {
  const row = rows?.[0];
  if (!row || !COMPANY_ROLES.includes(row.role as CompanyRole)) return null;
  return {
    userId: row.user_id,
    companyId: row.company_id,
    displayName: row.display_name,
    role: row.role as CompanyRole,
    isPlatformAdmin: row.is_platform_admin,
  };
}
