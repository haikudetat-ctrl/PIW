import { leadStages, type LeadStage } from "@/modules/leads/change-lead-stage";
import { moveLeadStage } from "./actions";

type BoardLead = { id: string; name: string; submitted_address: string; stage: LeadStage };

export function PipelineBoard({ leads }: { leads: BoardLead[] }) {
  return (
    <div>
      {leadStages.map((stage) => (
        <section key={stage} aria-label={stage}>
          <h2>{stage}</h2>
          <ul>
            {leads
              .filter((lead) => lead.stage === stage)
              .map((lead) => (
                <li key={lead.id}>
                  <a href={`/leads/${lead.id}`}>{lead.name}</a>
                  <p>{lead.submitted_address}</p>
                  <form
                    action={async (formData) => {
                      "use server";
                      await moveLeadStage(lead.id, formData.get("toStage") as LeadStage);
                    }}
                  >
                    <label>
                      Move to
                      <select name="toStage" defaultValue={stage}>
                        {leadStages.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit">Move</button>
                  </form>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
