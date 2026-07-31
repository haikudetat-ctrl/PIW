import { interactionTypeSchema } from "@/domain/crm";
import { logInteraction } from "./interaction-actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { inputClasses, labelClasses, primaryButtonClasses } from "@/components/ui/form";
import { formatDateTime, humanize } from "@/lib/format";

type Interaction = { id: string; type: string; summary: string; occurred_at: string };

export function InteractionList({
  leadId,
  interactions,
}: {
  leadId: string;
  interactions: Interaction[];
}) {
  return (
    <Card title="Interactions" ariaLabel="Interactions">
      <ul className="flex flex-col divide-y divide-border">
        {interactions.map((interaction) => (
          <li key={interaction.id} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-3">
              <Badge tone="info">{humanize(interaction.type)}</Badge>
              <time className="text-xs text-ink-subtle">
                {formatDateTime(interaction.occurred_at)}
              </time>
            </div>
            <p className="mt-1.5 text-sm text-ink">{interaction.summary}</p>
          </li>
        ))}
        {interactions.length === 0 ? (
          <li className="py-2.5 text-sm text-ink-subtle">No interactions logged</li>
        ) : null}
      </ul>
      <form
        action={async (formData) => {
          "use server";
          await logInteraction(leadId, formData);
        }}
        className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end"
      >
        <label className={labelClasses}>
          Type
          <select name="type" defaultValue="call" className={inputClasses}>
            {interactionTypeSchema.options.map((type) => (
              <option key={type} value={type}>
                {humanize(type)}
              </option>
            ))}
          </select>
        </label>
        <label className={`${labelClasses} flex-1`}>
          Summary
          <input name="summary" required className={inputClasses} />
        </label>
        <button type="submit" className={primaryButtonClasses}>
          Log interaction
        </button>
      </form>
    </Card>
  );
}
