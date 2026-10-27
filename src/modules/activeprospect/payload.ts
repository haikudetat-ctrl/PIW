import {z} from "zod";
import {toUsE164} from "@/modules/sms/rules";

const leaf = z.string().trim().max(1000).nullish().transform((value) => value || null);
export const activeProspectPayloadSchema = z.object({
  schema_version: z.literal(1),
  lead_id: z.string().trim().min(1).max(200),
  flow_id: z.string().trim().min(1).max(200),
  submitted_at: z.iso.datetime({offset: true}),
  is_test: z.boolean(),
  source: z.object({id: leaf, name: leaf}).strict().refine((source) => Boolean(source.id || source.name)),
  lead: z.object({
    name: leaf,
    phone: leaf.transform((value) => value ? toUsE164(value) : null),
    email: leaf.transform((value) => value?.toLowerCase() ?? null).refine((value) => value === null || z.email().safeParse(value).success),
    submitted_address: leaf,
  }).strict(),
  sms_consent: z.object({
    granted: z.boolean(),
    company_id: z.uuid().nullish(),
    disclosure: leaf,
    captured_at: z.iso.datetime({offset: true}).nullish(),
    evidence_url: z.url().max(2000).refine((value) => value.startsWith("https://")).nullish(),
  }).strict().optional(),
}).strict();

export type ActiveProspectPayload = z.infer<typeof activeProspectPayloadSchema>;
export class IntakeReplayConflict extends Error {
  constructor() {super("ActiveProspect replay conflict");}
}
