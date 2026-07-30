import { leadStageSchema } from "@/domain/crm";

export const leadStages = leadStageSchema.options;
export type LeadStage = (typeof leadStages)[number];

export type ChangeLeadStageDependencies = {
  applyStageChange: (input: {
    leadId: string;
    toStage: LeadStage;
  }) => Promise<{ fromStage: LeadStage }>;
  recordAuditEntry: (input: {
    leadId: string;
    fromStage: LeadStage;
    toStage: LeadStage;
  }) => Promise<void>;
};

export async function changeLeadStage(
  input: { leadId: string; toStage: LeadStage },
  deps: ChangeLeadStageDependencies,
) {
  const { fromStage } = await deps.applyStageChange(input);
  await deps.recordAuditEntry({ leadId: input.leadId, fromStage, toStage: input.toStage });
  return { fromStage, toStage: input.toStage };
}
