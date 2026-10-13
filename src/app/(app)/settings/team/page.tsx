import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { parseMyAccess } from "@/lib/auth/access";
import { createServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { InviteForm, MemberControls } from "./team-controls";

// What each role can do in PIW today. Kept in step with canUseCrm/hasRole in
// src/lib/auth/access.ts and the role checks in the database.
const ROLE_CARDS = [
  {
    title: "Employee",
    body: "Signs in to their own view. Sees the JobNimbus jobs assigned to them.",
    points: ["Own assigned jobs only", "No CRM, pricing or reports"],
  },
  {
    title: "Manager",
    body: "Runs the CRM for the whole company.",
    points: ["All leads, pipeline and proposals", "Reports", "Review queue"],
  },
  {
    title: "Company admin",
    body: "Everything a manager can do, plus managing the team.",
    points: ["Invite people", "Change roles and access", "JobNimbus sync runs"],
  },
] as const;

const SUPER_ADMIN_CARD = {
  title: "Super admin",
  body: "Rake staff. Works across every company on the platform.",
  points: ["Switch companies", "Create companies", "Platform health"],
};

function initials(name: string) {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default async function TeamSettingsPage() {
  const supabase = await createServerClient();
  const [{ data: accessRows }, { data: members, error }] = await Promise.all([
    supabase.rpc("get_my_access"),
    supabase.rpc("list_company_members"),
  ]);
  if (error) throw new Error("Failed to load the team");
  const access = parseMyAccess(accessRows);
  const rows = members ?? [];
  const active = rows.filter((member) => member.is_active && member.confirmed).length;
  const pending = rows.filter((member) => member.is_active && !member.confirmed).length;
  const cards = access?.isPlatformAdmin ? [...ROLE_CARDS, SUPER_ADMIN_CARD] : ROLE_CARDS;

  return (
    <main className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[28px] font-bold tracking-tight text-ink">Team &amp; roles</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {active} {active === 1 ? "member" : "members"}
            {pending > 0 ? ` · ${pending} pending ${pending === 1 ? "invite" : "invites"}` : ""}
          </p>
        </div>
      </div>

      <section aria-label="Members" className="overflow-hidden rounded-2xl bg-surface shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-[13px]">
            <thead className="border-b border-border text-left text-xs text-ink-subtle">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium">Member</th>
                <th scope="col" className="px-5 py-2.5 font-medium">Role</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">Open tasks</th>
                <th scope="col" className="px-5 py-2.5 font-medium">Last active</th>
                <th scope="col" className="px-5 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((member) => {
                const isSelf = member.user_id === access?.userId;
                return (
                  <tr key={member.user_id} className="border-b border-border last:border-b-0">
                    <th scope="row" className="px-5 py-3 text-left font-normal">
                      <div className="flex items-center gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-fill-selected text-[11px] font-medium text-tint">
                          {member.confirmed ? initials(member.display_name) : "?"}
                        </span>
                        <span className="min-w-0">
                          <span className={`block font-medium ${member.is_active ? "text-ink" : "text-ink-muted"}`}>
                            {member.display_name}
                            {isSelf ? <span className="font-normal text-ink-subtle"> (you)</span> : null}
                          </span>
                          <span className="block truncate text-xs text-ink-subtle">{member.email}</span>
                        </span>
                      </div>
                    </th>
                    <td className="px-5 py-3">
                      <MemberControls
                        userId={member.user_id}
                        name={member.display_name}
                        role={member.role}
                        isActive={member.is_active}
                        locked={isSelf}
                      />
                    </td>
                    <td className="px-5 py-3 text-right text-ink tabular-nums">{member.open_tasks || "—"}</td>
                    <td className="px-5 py-3 text-ink-muted">
                      {member.last_sign_in_at ? formatDateTime(member.last_sign_in_at) : "—"}
                    </td>
                    <td className="px-5 py-3">
                      {!member.is_active ? (
                        <Badge tone="neutral">Deactivated</Badge>
                      ) : !member.confirmed ? (
                        <Badge tone="warning">Invite sent</Badge>
                      ) : (
                        <Badge tone="success">Active</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <InviteForm />

      <div className={`grid gap-4 md:grid-cols-2 ${cards.length > 3 ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
        {cards.map((card) => (
          <section key={card.title} aria-label={card.title} className="rounded-2xl bg-surface p-5 shadow-card">
            <h3 className="text-[15px] font-semibold text-ink">{card.title}</h3>
            <p className="mt-1 text-[13px] text-ink-muted">{card.body}</p>
            <ul className="mt-3 flex flex-col gap-1.5">
              {card.points.map((point) => (
                <li key={point} className="flex items-center gap-2 text-[13px] text-ink">
                  <Icon name="check" size={14} className="text-success" />
                  {point}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
