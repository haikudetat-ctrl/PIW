import { LeadIntakeForm } from "./lead-intake-form";

export default function NewLeadPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">New lead</h1>
        <p className="mt-1 text-sm text-ink-subtle">
          Collects the approved input fields and starts the enrichment pipeline.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-6">
        <LeadIntakeForm />
      </div>
    </main>
  );
}
