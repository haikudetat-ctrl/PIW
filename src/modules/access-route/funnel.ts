export type ReconciledRoute = {
  lead_source: string | null;
  leadmaster_record_id: string | null;
  leadmaster_opportunity_status: string | null;
  leadmaster_opportunity_stage: string | null;
  jobnimbus_job_id: string | null;
  jobnimbus_status: string | null;
  jobnimbus_stage: string | null;
  jobnimbus_appointment_status: string | null;
  appointment_at: string | null;
  sold_value: number | null;
};

export type FunnelCounts = {
  source: number;
  contacted: number;
  appointment: number;
  sold: number;
  job: number;
};

function indicatesSold(route: ReconciledRoute): boolean {
  if ((route.sold_value ?? 0) > 0) return true;
  const status = [route.jobnimbus_status, route.jobnimbus_stage]
    .filter(Boolean).join(" ").toLowerCase();
  return /\b(sold|won|contracted)\b/.test(status);
}

export function summarizeFunnel(rows: ReconciledRoute[]): {
  total: FunnelCounts;
  bySource: Array<{ sourceName: string; counts: FunnelCounts }>;
} {
  const sourceMap = new Map<string, FunnelCounts>();
  const total: FunnelCounts = { source: 0, contacted: 0, appointment: 0, sold: 0, job: 0 };

  for (const row of rows) {
    const sourceName = row.lead_source?.trim() || "Unknown";
    const counts = sourceMap.get(sourceName)
      ?? { source: 0, contacted: 0, appointment: 0, sold: 0, job: 0 };
    const hasJob = Boolean(row.jobnimbus_job_id);
    const hasAppointment = hasJob || Boolean(
      row.appointment_at
      || row.jobnimbus_appointment_status
      || row.leadmaster_opportunity_status
      || row.leadmaster_opportunity_stage,
    );
    const hasContact = hasAppointment || Boolean(row.leadmaster_record_id);
    const sold = indicatesSold(row);
    const flags = {
      source: true,
      contacted: hasContact,
      appointment: hasAppointment,
      sold,
      job: hasJob,
    };
    for (const key of Object.keys(flags) as Array<keyof FunnelCounts>) {
      if (flags[key]) {
        counts[key] += 1;
        total[key] += 1;
      }
    }
    sourceMap.set(sourceName, counts);
  }

  return {
    total,
    bySource: [...sourceMap.entries()]
      .map(([sourceName, counts]) => ({ sourceName, counts }))
      .sort((a, b) => b.counts.source - a.counts.source),
  };
}
