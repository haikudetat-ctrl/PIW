import { leadStages, type LeadStage } from "@/modules/leads/change-lead-stage";
import { humanize } from "@/lib/format";
import { moveLeadStage } from "./actions";

type BoardLead = { id: string; name: string; submitted_address: string; stage: LeadStage };

const selectClasses =
  "w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent";

export function PipelineBoard({ leads }: { leads: BoardLead[] }) {
  return (
    <div className="-mx-6 overflow-x-auto px-6 pb-2">
      <div className="flex gap-4">
        {leadStages.map((stage, index) => {
          const stageLeads = leads.filter((lead) => lead.stage === stage);
          return (
            <section
              key={stage}
              aria-label={stage}
              className="flex w-64 shrink-0 flex-col gap-3"
            >
              <div className="border-b-2 border-accent pb-2">
                <p className="text-xs font-semibold tracking-wider text-accent uppercase">
                  {index + 1}. {humanize(stage)}
                </p>
                <p className="text-xs text-ink-subtle">{stageLeads.length} leads</p>
              </div>
              <ul className="flex flex-col gap-3">
                {stageLeads.map((lead) => (
                  <li
                    key={lead.id}
                    className="rounded-lg border border-border bg-surface p-3"
                  >
                    <a
                      href={`/leads/${lead.id}`}
                      className="text-sm font-semibold text-accent hover:underline"
                    >
                      {lead.name}
                    </a>
                    <p className="mt-0.5 truncate text-xs text-ink-subtle">
                      {lead.submitted_address}
                    </p>
                    <form
                      action={async (formData) => {
                        "use server";
                        await moveLeadStage(lead.id, formData.get("toStage") as LeadStage);
                      }}
                      className="mt-2.5 flex items-center gap-1.5"
                    >
                      <label className="sr-only" htmlFor={`move-${lead.id}`}>
                        Move to
                      </label>
                      <select
                        id={`move-${lead.id}`}
                        name="toStage"
                        defaultValue={stage}
                        className={selectClasses}
                      >
                        {leadStages.map((option) => (
                          <option key={option} value={option}>
                            {humanize(option)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="shrink-0 rounded-md bg-accent px-2 py-1 text-xs font-semibold text-white transition hover:bg-accent-hover"
                      >
                        Move
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
