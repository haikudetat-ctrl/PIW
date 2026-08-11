"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/card";
import { primaryButtonClasses, secondaryButtonClasses } from "@/components/ui/form";
import type { LeadConduitSanitizedProbeResult } from "@/modules/access-route/leadconduit-shadow-import";
import {
  importLeadConduitShadow,
  testLeadConduitConnection,
} from "./actions";
import {
  idleLeadConduitActionState,
  type LeadConduitActionState,
} from "./action-handlers";

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function ProbeResults({ probe }: { probe: LeadConduitSanitizedProbeResult }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-ink">
        HTTP {probe.status} · {pluralize(probe.visibleFlowCount, "visible flow")}
      </p>
      <dl className="grid gap-3 md:grid-cols-2">
        {probe.approvedFlows.map((flow) => (
          <div key={flow.flowName} className="rounded-md border border-border p-4">
            <dt className="font-semibold text-ink">{flow.flowName}</dt>
            <dd className="mt-1 text-sm font-medium text-ink">
              {pluralize(flow.sourceCount, "source")}
            </dd>
            <dd className="mt-2 text-xs text-ink-subtle">
              {flow.fieldNames.length ? flow.fieldNames.join(", ") : "No fields returned"}
            </dd>
          </div>
        ))}
      </dl>
      {probe.missingFlowNames.length ? (
        <div className="text-sm text-danger">
          {probe.missingFlowNames.map((flowName) => (
            <p key={flowName}>Missing approved flow: {flowName}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ImportResult({ state }: { state: LeadConduitActionState }) {
  if (!state.importResult) {
    return state.message ? <p role="alert" className="text-sm text-danger">{state.message}</p> : null;
  }
  return (
    <div className="mt-3 text-xs text-ink-subtle">
      <p>{state.importResult.eventsSeen} seen · {state.importResult.eventsWritten} written</p>
      <p>{pluralize(state.importResult.sourceMetadataSeen, "source metadata record")}</p>
      {state.message ? <p role="alert" className="mt-2 text-danger">{state.message}</p> : null}
    </div>
  );
}

export function LeadConduitConnectionPanel({
  initialProbe,
}: {
  initialProbe?: LeadConduitSanitizedProbeResult;
}) {
  const initialProbeState: LeadConduitActionState = initialProbe
    ? { status: initialProbe.ok ? "succeeded" : "failed", probe: initialProbe }
    : idleLeadConduitActionState;
  const [probeState, probeAction, probePending] = useActionState<
    LeadConduitActionState,
    FormData
  >(testLeadConduitConnection, initialProbeState);
  const [roofingState, roofingAction, roofingPending] = useActionState<
    LeadConduitActionState,
    FormData
  >(importLeadConduitShadow, idleLeadConduitActionState);
  const [quoteState, quoteAction, quotePending] = useActionState<
    LeadConduitActionState,
    FormData
  >(importLeadConduitShadow, idleLeadConduitActionState);
  const approvedNames = new Set(probeState.probe?.approvedFlows.map((flow) => flow.flowName) ?? []);
  const probePassed = Boolean(
    probeState.probe?.ok
    && probeState.probe.missingFlowNames.length === 0
    && approvedNames.has("Roofing")
    && approvedNames.has("Roofing Virtual Quote"),
  );

  return (
    <Card title="LeadConduit read-only shadow" ariaLabel="LeadConduit read-only shadow">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          Tests both approved flows using read-only requests. Results contain status, counts, flow names, and field names only.
        </p>
        <form action={probeAction}>
          <button
            type="submit"
            disabled={probePending}
            className={secondaryButtonClasses}
          >
            {probePending ? "Testing connection..." : "Test LeadConduit connection"}
          </button>
        </form>

        {probeState.probe ? <ProbeResults probe={probeState.probe} /> : null}
        {probeState.message ? <p role="alert" className="text-sm text-danger">{probeState.message}</p> : null}

        {probePassed ? (
          <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
            <form action={roofingAction}>
              <input type="hidden" name="flowSlug" value="roofing" />
              <button type="submit" disabled={roofingPending} className={primaryButtonClasses}>
                {roofingPending ? "Importing Roofing..." : "Import Roofing shadow sample"}
              </button>
              <ImportResult state={roofingState} />
            </form>
            <form action={quoteAction}>
              <input type="hidden" name="flowSlug" value="roofing-virtual-quote" />
              <button type="submit" disabled={quotePending} className={primaryButtonClasses}>
                {quotePending ? "Importing Roofing Virtual Quote..." : "Import Roofing Virtual Quote shadow sample"}
              </button>
              <ImportResult state={quoteState} />
            </form>
            <p className="text-xs text-ink-subtle md:col-span-2">
              Each action reads at most 50 events from one page. Scheduling, receipt, processing, and rescue remain disabled.
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
