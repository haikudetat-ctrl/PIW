import { interactionTypeSchema } from "@/domain/crm";
import { logInteraction } from "./interaction-actions";

type Interaction = { id: string; type: string; summary: string; occurred_at: string };

export function InteractionList({
  leadId,
  interactions,
}: {
  leadId: string;
  interactions: Interaction[];
}) {
  return (
    <section aria-label="Interactions">
      <h2>Interactions</h2>
      <ul>
        {interactions.map((interaction) => (
          <li key={interaction.id}>
            {interaction.type}: {interaction.summary} ({interaction.occurred_at})
          </li>
        ))}
      </ul>
      <form
        action={async (formData) => {
          "use server";
          await logInteraction(leadId, formData);
        }}
      >
        <label>
          Type
          <select name="type" defaultValue="call">
            {interactionTypeSchema.options.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Summary
          <input name="summary" required />
        </label>
        <button type="submit">Log interaction</button>
      </form>
    </section>
  );
}
