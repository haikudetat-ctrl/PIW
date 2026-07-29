import { createServerClient } from "@/lib/supabase/server";
import { PipelineBoard } from "./pipeline-board";

export default async function PipelinePage() {
  const supabase = await createServerClient();
  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, submitted_address, stage")
    .order("created_at", { ascending: false });

  return (
    <main>
      <h1>Pipeline</h1>
      <PipelineBoard leads={leads ?? []} />
    </main>
  );
}
