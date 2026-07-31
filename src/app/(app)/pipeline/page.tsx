import { createServerClient } from "@/lib/supabase/server";
import { PipelineBoard } from "./pipeline-board";

export default async function PipelinePage() {
  const supabase = await createServerClient();
  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, submitted_address, stage")
    .order("created_at", { ascending: false });

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Pipeline</h1>
        <p className="mt-1 text-sm text-ink-subtle">
          {(leads ?? []).length} leads across the commercial pipeline
        </p>
      </div>
      <PipelineBoard leads={leads ?? []} />
    </main>
  );
}
