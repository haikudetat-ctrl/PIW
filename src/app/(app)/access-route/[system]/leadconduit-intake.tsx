import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { humanize } from "@/lib/format";
import {
  INTAKE_FLAG_LABELS,
  INTAKE_FLAGS,
  describeIntakeFlags,
  formatReceived,
  formatShare,
  formatTown,
  type IntakeFlag,
  type IntakeQualityRow,
  type IntakeScorecard,
  type SourceScore,
} from "@/modules/access-route/intake-quality";

export type LeadConduitRawEvent = {
  event_id: string;
  flow_id: string | null;
  source_name: string | null;
  event_type: string;
  raw_status: string | null;
  reason_category: string | null;
  occurred_at: string;
};

const FLAG_DEFINITIONS: Record<IntakeFlag, string> = {
  repeat: "same phone or email from any vendor in the 30 days before",
  known_customer: "already a JobNimbus contact more than a day before the lead arrived",
  no_trustedform: "no TrustedForm certificate URL",
  blank_address: "address empty or only punctuation",
  out_of_area: "state outside the company's service states",
  incomplete: "missing name, phone or email",
};

function show(value: string | null | undefined) {
  return value === null || value === undefined || value === "" ? "—" : value;
}

function FlagCell({ count, of, disabled = false }: { count: number; of: number; disabled?: boolean }) {
  if (disabled) return <td className="py-2.5 pl-3 text-right text-ink-subtle">—</td>;
  const share = formatShare(count, of);
  return (
    <td className="py-2.5 pl-3 text-right tabular-nums whitespace-nowrap">
      <span className={count ? "font-medium text-ink" : "text-ink-subtle"}>{count}</span>
      {share ? <span className="ml-1 text-xs text-ink-subtle">{share}</span> : null}
    </td>
  );
}

function ScoreRow({ score, serviceStatesConfigured, total = false }: {
  score: SourceScore;
  serviceStatesConfigured: boolean;
  total?: boolean;
}) {
  const Cell = total ? "th" : "td";
  return (
    <tr className={total ? "border-t border-border-strong" : undefined}>
      <th scope="row" className={`py-2.5 pr-3 text-left ${total ? "font-semibold" : "font-medium"} text-ink`}>
        {score.sourceName}
      </th>
      <Cell className="py-2.5 pl-3 text-right font-normal tabular-nums text-ink-muted">{score.today}</Cell>
      <Cell className="py-2.5 pl-3 text-right font-normal tabular-nums text-ink-muted">{score.last7Days}</Cell>
      <Cell className="py-2.5 pl-3 text-right font-semibold tabular-nums text-ink">{score.last30Days}</Cell>
      {INTAKE_FLAGS.map((flag) => (
        <FlagCell
          key={flag}
          count={score.flags[flag]}
          of={score.last30Days}
          disabled={flag === "out_of_area" && !serviceStatesConfigured}
        />
      ))}
    </tr>
  );
}

export function LeadConduitIntake({
  scorecard,
  leads,
  rawEvents,
  downstreamLive,
  truncated,
  now,
}: {
  scorecard: IntakeScorecard;
  leads: IntakeQualityRow[];
  rawEvents: LeadConduitRawEvent[];
  downstreamLive: boolean;
  truncated: boolean;
  now: Date;
}) {
  const { total, sources, serviceStatesConfigured } = scorecard;
  const newest = leads[0]?.received_at ?? null;

  return (
    <>
      {!downstreamLive ? (
        <div role="note" className="rounded-2xl bg-warning-bg px-5 py-3.5 text-sm text-warning">
          Only the intake checkpoint is reporting. PIW can&apos;t tell delivered leads from filtered ones until
          the after-CoreLogic and delivered recipients are added to the LeadConduit flow.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile value={total.today} label="Today" />
        <StatTile value={total.last7Days} label="Last 7 days" />
        <StatTile value={total.last30Days} label="Last 30 days" />
        <StatTile value={newest ? formatReceived(newest, now) : "None yet"} label="Last lead" />
      </div>

      <Card
        title="Vendor scorecard"
        ariaLabel="LeadConduit vendor scorecard"
        right={`Last 30 days${truncated ? " (partial: row limit reached)" : ""}`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="border-b border-border text-xs text-ink-subtle">
              <tr>
                <th scope="col" className="pb-2 pr-3 text-left font-medium">Source</th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">Today</th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">7 days</th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">30 days</th>
                {INTAKE_FLAGS.map((flag) => (
                  <th key={flag} scope="col" title={FLAG_DEFINITIONS[flag]} className="pb-2 pl-3 text-right font-medium">
                    {INTAKE_FLAG_LABELS[flag]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sources.map((score) => (
                <ScoreRow key={score.sourceName} score={score} serviceStatesConfigured={serviceStatesConfigured} />
              ))}
              {sources.length ? (
                <ScoreRow score={total} serviceStatesConfigured={serviceStatesConfigured} total />
              ) : (
                <tr><td colSpan={4 + INTAKE_FLAGS.length} className="py-6 text-center text-ink-subtle">No LeadConduit leads in the last 30 days.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-subtle">
          {INTAKE_FLAGS.map((flag, index) => (
            <span key={flag}>
              <span className="font-medium text-ink-muted">{INTAKE_FLAG_LABELS[flag]}</span>: {FLAG_DEFINITIONS[flag]}
              {index < INTAKE_FLAGS.length - 1 ? ". " : "."}
            </span>
          ))}
          {serviceStatesConfigured ? null : " Out of area is off until the company's service states are set."}
        </p>
      </Card>

      <Card title="Latest leads" ariaLabel="Latest LeadConduit leads" right={`Newest ${leads.length}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b border-border text-xs text-ink-subtle">
              <tr>
                <th scope="col" className="pb-2 pr-4 font-medium">Received</th>
                <th scope="col" className="pb-2 pr-4 font-medium">Lead</th>
                <th scope="col" className="pb-2 pr-4 font-medium">Town</th>
                <th scope="col" className="pb-2 pr-4 font-medium">Source</th>
                <th scope="col" className="pb-2 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leads.map((lead) => {
                const flags = describeIntakeFlags(lead);
                return (
                  <tr key={`${lead.flow_id}:${lead.lead_id}`} className="align-top">
                    <td className="py-2.5 pr-4 whitespace-nowrap text-ink-muted tabular-nums">
                      {lead.received_at ? formatReceived(lead.received_at, now) : "—"}
                    </td>
                    <td className="py-2.5 pr-4 font-medium text-ink">{show(lead.lead_name)}</td>
                    <td className="py-2.5 pr-4 text-ink-muted">{formatTown(lead)}</td>
                    <td className="py-2.5 pr-4 text-ink-muted">{show(lead.source_name)}</td>
                    <td className="py-2.5">
                      {flags.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {flags.map((detail) => (
                            <Badge key={detail.flag} tone={detail.tone}>{detail.label}</Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-ink-subtle">Clean</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!leads.length ? (
                <tr><td colSpan={5} className="py-6 text-center text-ink-subtle">No LeadConduit leads in the last 30 days.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <details className="rounded-2xl bg-surface px-5 py-4 shadow-card">
        <summary className="cursor-pointer text-[15px] font-semibold tracking-tight text-ink">
          Raw checkpoint events
          <span className="ml-2 text-xs font-normal text-ink-subtle">Latest {rawEvents.length}, for debugging the flow</span>
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead className="border-b border-border text-xs text-ink-subtle">
              <tr>
                {["Event", "Source / flow", "Type", "Status", "Reason", "Occurred"].map((header) => (
                  <th key={header} className="pb-2 pr-4 font-medium last:pr-0">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rawEvents.map((event, index) => (
                <tr key={`${event.event_id}-${index}`}>
                  <td className="max-w-[12rem] truncate py-2.5 pr-4 font-mono text-xs text-ink-subtle" title={event.event_id}>{event.event_id}</td>
                  <td className="py-2.5 pr-4 text-ink-muted">{event.source_name ?? event.flow_id}</td>
                  <td className="py-2.5 pr-4 text-ink-muted">{humanize(event.event_type)}</td>
                  <td className="py-2.5 pr-4 text-ink-muted">{show(event.raw_status ? humanize(event.raw_status) : null)}</td>
                  <td className="py-2.5 pr-4 text-ink-muted">{show(event.reason_category ? humanize(event.reason_category) : null)}</td>
                  <td className="py-2.5 text-ink-muted tabular-nums whitespace-nowrap">{formatReceived(event.occurred_at, now)}</td>
                </tr>
              ))}
              {!rawEvents.length ? (
                <tr><td colSpan={6} className="py-6 text-center text-ink-subtle">No records ingested yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
