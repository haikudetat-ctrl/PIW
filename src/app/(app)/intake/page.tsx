import Link from "next/link";
import {redirect} from "next/navigation";
import {canUseCrm, parseMyAccess} from "@/lib/auth/access";
import {createServerClient} from "@/lib/supabase/server";

const STATE_LABELS: Record<string, string> = {
  accepted: "Lead created", linked: "Linked to existing lead", test: "Test — no contact",
  external: "External owner — no contact", needs_review: "Contact details need review",
  ownership_conflict: "Ownership needs review",
};

export default async function IntakePage() {
  const client = await createServerClient();
  const access = parseMyAccess((await client.rpc("get_my_access")).data);
  if (!access || !canUseCrm(access)) redirect("/");
  const {data, error} = await client.from("activeprospect_intake_receipts")
    .select("id, received_at, appointment_type, contact_owner, state, lead_id, is_test")
    .eq("company_id", access.companyId).order("received_at", {ascending: false}).limit(100);
  if (error) throw new Error("Unable to load intake receipts");
  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">ActiveProspect intake</h1>
        <p className="mt-2 text-sm text-ink-subtle">The latest 100 submissions. Review incomplete details and ownership conflicts before contacting the homeowner.</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-sm">
          <thead><tr><th className="p-3">Received</th><th className="p-3">Inspection</th><th className="p-3">Routed to</th><th className="p-3">Status</th><th className="p-3">Record</th></tr></thead>
          <tbody>
            {(data ?? []).map((row) => <tr key={row.id} className="border-t border-line">
              <td className="p-3"><time dateTime={row.received_at}>{new Date(row.received_at).toISOString().replace("T", " ").slice(0, 16)} UTC</time></td>
              <td className="p-3">{row.appointment_type === "virtual" ? "Virtual" : "In-home"}</td>
              <td className="p-3">{row.contact_owner === "piw" ? "PIW" : "External team"}</td>
              <td className="p-3">{STATE_LABELS[row.state] ?? row.state}</td>
              <td className="p-3">{row.lead_id ? <Link href={`/leads/${row.lead_id}`} className="text-tint underline">Open lead</Link> : <span title={row.id}>Receipt {row.id.slice(0, 8)}</span>}</td>
            </tr>)}
            {!data?.length && <tr><td colSpan={5} className="p-6 text-ink-subtle">No operational intake submissions yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-ink-subtle">A manager can use the receipt ID to request a source correction. Replayed submissions preserve their original evidence and do not restart contact.</p>
    </main>
  );
}
