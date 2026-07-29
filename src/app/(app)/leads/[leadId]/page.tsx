import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { buildActivityTimeline } from "@/modules/leads/activity-timeline";

export default async function LeadWorkspacePage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const supabase = await createServerClient();

  const [{ data: lead }, { data: stageHistory }, { data: interactions }] = await Promise.all([
    supabase
      .from("leads")
      .select(
        "id, name, phone, email, submitted_address, notes, stage, property_id, properties(canonical_address, resolution_status)",
      )
      .eq("id", leadId)
      .maybeSingle(),
    supabase
      .from("lead_stage_history")
      .select("changed_at, from_stage, to_stage")
      .eq("lead_id", leadId),
    supabase
      .from("interactions")
      .select("occurred_at, type, summary")
      .eq("lead_id", leadId),
  ]);

  if (!lead) notFound();

  const timeline = buildActivityTimeline(stageHistory ?? [], interactions ?? []);

  return (
    <main>
      <h1>{lead.name}</h1>
      <section aria-label="Contact details">
        <p>{lead.phone}</p>
        <p>{lead.email}</p>
        <p>Stage: {lead.stage}</p>
      </section>

      <section aria-label="Property">
        <h2>Property</h2>
        <p>{lead.properties?.canonical_address ?? lead.submitted_address}</p>
        <p>Resolution: {lead.properties?.resolution_status}</p>
      </section>

      {lead.notes ? (
        <section aria-label="Notes">
          <h2>Notes</h2>
          <p>{lead.notes}</p>
        </section>
      ) : null}

      <section aria-label="Activity">
        <h2>Activity</h2>
        <ul>
          {timeline.map((item, index) => (
            <li key={index}>
              {item.kind === "stage_change"
                ? `${item.fromStage ?? "—"} → ${item.toStage}`
                : `${item.interactionType}: ${item.summary}`}{" "}
              ({item.occurredAt})
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
