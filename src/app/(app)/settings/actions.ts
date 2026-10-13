"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hasRole, parseMyAccess } from "@/lib/auth/access";
import { PRODUCTION_AUTH_CONFIRM_URL } from "@/lib/auth/urls";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type SettingsActionResult = { error: string } | { ok: true; message?: string };

const assignableRoleSchema = z.enum(["company_admin", "manager", "employee"]);

async function currentAccess() {
  const supabase = await createServerClient();
  const { data } = await supabase.rpc("get_my_access");
  return { supabase, access: parseMyAccess(data) };
}

export async function switchCompany(companyId: string) {
  const parsed = z.string().uuid().safeParse(companyId);
  if (!parsed.success) return;
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("switch_active_company", { p_company_id: parsed.data });
  if (error) throw new Error("Could not switch company");
  revalidatePath("/", "layout");
  redirect("/");
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  displayName: z.string().trim().min(1).max(120),
  role: assignableRoleSchema,
});

// Creates the login (Supabase sends the invitation email, whose link lands on
// /auth/confirm to set a password) and grants the role in a company. Someone
// who already has a login is added without a second email.
async function inviteToCompany(input: z.infer<typeof inviteSchema>, companyId: string): Promise<SettingsActionResult> {
  const service = createServiceClient();
  const { error: inviteError } = await service.auth.admin.inviteUserByEmail(input.email, {
    redirectTo: PRODUCTION_AUTH_CONFIRM_URL,
    data: { display_name: input.displayName },
  });
  const alreadyRegistered = inviteError && /already (been )?registered|already exists/i.test(inviteError.message);
  if (inviteError && !alreadyRegistered) return { error: "Could not send the invitation" };

  const { error: grantError } = await service.rpc("grant_company_membership", {
    p_email: input.email,
    p_company_id: companyId,
    p_role: input.role,
    p_display_name: input.displayName,
  });
  if (grantError) return { error: "Could not add them to the company" };
  return {
    ok: true,
    message: alreadyRegistered
      ? `${input.displayName} already had a login and now has access.`
      : `Invitation sent to ${input.email}.`,
  };
}

export async function inviteMember(
  _previous: SettingsActionResult | null,
  formData: FormData,
): Promise<SettingsActionResult> {
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a name, a valid email and a role" };
  const { access } = await currentAccess();
  if (!access || !hasRole(access, "company_admin")) return { error: "Only a company admin can invite people" };

  const result = await inviteToCompany(parsed.data, access.companyId);
  revalidatePath("/settings/team");
  return result;
}

export async function updateMember(userId: string, role: string, isActive: boolean): Promise<SettingsActionResult> {
  const parsedRole = assignableRoleSchema.safeParse(role);
  const parsedUser = z.string().uuid().safeParse(userId);
  if (!parsedRole.success || !parsedUser.success) return { error: "Unknown role" };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("update_company_member", {
    p_user_id: parsedUser.data,
    p_role: parsedRole.data,
    p_is_active: isActive,
  });
  if (error) return { error: error.code === "42501" ? error.message : "Could not update that member" };
  revalidatePath("/settings/team");
  return { ok: true };
}

const companySchema = z.object({
  name: z.string().trim().min(1).max(120),
  jobnimbusEnvKey: z
    .string()
    .trim()
    .regex(/^(JOBNIMBUS_API_KEY(_[A-Z0-9]+)*)?$/, "Use a name like JOBNIMBUS_API_KEY_ACME"),
  adminEmail: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(320)]),
  adminName: z.string().trim().max(120),
});

export async function createCompany(
  _previous: SettingsActionResult | null,
  formData: FormData,
): Promise<SettingsActionResult> {
  const parsed = companySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the company details" };
  if (parsed.data.adminEmail && !parsed.data.adminName) return { error: "Add the first admin's name" };

  const { supabase, access } = await currentAccess();
  if (!access?.isPlatformAdmin) return { error: "Only a super admin can create companies" };

  const { data: companyId, error } = await supabase.rpc("create_company", {
    p_name: parsed.data.name,
    p_jobnimbus_env_key: parsed.data.jobnimbusEnvKey,
  });
  if (error || !companyId) return { error: "Could not create the company" };

  revalidatePath("/settings/companies");
  if (!parsed.data.adminEmail) return { ok: true, message: `${parsed.data.name} created.` };

  const invited = await inviteToCompany(
    { email: parsed.data.adminEmail, displayName: parsed.data.adminName, role: "company_admin" },
    companyId,
  );
  if ("error" in invited) return { error: `${parsed.data.name} was created, but ${invited.error.toLowerCase()}.` };
  return { ok: true, message: `${parsed.data.name} created. ${invited.message ?? ""}`.trim() };
}
