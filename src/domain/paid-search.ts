import { z } from "zod";

const count = z.coerce.number().int().nonnegative();
const money = z.coerce.number();

export const paidSearchReportSchema = z.object({
  spend: money,
  clicks: count,
  impressions: count,
  arrivals: count,
  leads: count,
  qualified: count,
  appointments_set: count,
  appointments_ran: count,
  sold: count,
  revenue: money,
  flagged: count,
  last_spend_import_at: z.string().nullable(),
  daily: z.array(z.object({
    date: z.string(),
    spend: money,
    clicks: count,
    arrivals: count,
    leads: count,
    qualified: count,
  })),
  keywords: z.array(z.object({
    ad_group_id: z.string().nullable(),
    criterion_id: z.string().nullable(),
    ad_group_name: z.string().nullable(),
    keyword_text: z.string().nullable(),
    match_type: z.string().nullable(),
    cost: money,
    clicks: count,
    leads: count,
    qualified: count,
    appointments: count,
    sold: count,
  })),
  deliveries: z.array(z.object({event_name: z.string(), status: z.string(), count})),
  recent_leads: z.array(z.object({
    lead_id: z.uuid(),
    created_at: z.string(),
    google_keyword: z.string().nullable(),
    google_match_type: z.string().nullable(),
    landing_path: z.string().nullable(),
    click_id_type: z.string().nullable(),
    qualified: z.boolean(),
    appointment_set: z.boolean(),
    sold: z.boolean(),
    flag: z.string().nullable(),
  })),
});

export type PaidSearchReport = z.infer<typeof paidSearchReportSchema>;

/** Cost per outcome, or null when there were no outcomes to divide by. */
export function costPer(spend: number, outcomes: number): number | null {
  return outcomes > 0 ? spend / outcomes : null;
}

export const LEAD_FLAGS = [
  {value: "spam", label: "Spam"},
  {value: "invalid", label: "Invalid contact"},
  {value: "duplicate", label: "Duplicate"},
  {value: "not_homeowner", label: "Not the homeowner"},
  {value: "out_of_area", label: "Outside service area"},
  {value: "test", label: "Test"},
] as const;

export type LeadFlag = (typeof LEAD_FLAGS)[number]["value"];

export function isLeadFlag(value: string): value is LeadFlag {
  return LEAD_FLAGS.some((flag) => flag.value === value);
}

const EVENT_LABEL: Record<string, string> = {
  qualified_lead: "Qualified lead",
  appointment_set: "Appointment set",
  appointment_ran: "Appointment ran",
  sold: "Sold",
};

export function eventLabel(eventName: string) {
  return EVENT_LABEL[eventName] ?? eventName;
}

export const MATCH_TYPE_LABEL: Record<string, string> = {
  e: "Exact", p: "Phrase", b: "Broad", EXACT: "Exact", PHRASE: "Phrase", BROAD: "Broad",
};
