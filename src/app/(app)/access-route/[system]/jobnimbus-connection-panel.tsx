"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/card";
import { primaryButtonClasses, secondaryButtonClasses } from "@/components/ui/form";
import { humanize } from "@/lib/format";
import {
  importJobNimbusSample,
  testJobNimbusConnection,
} from "./actions";
import {
  idleJobNimbusActionState,
  type JobNimbusActionState,
  type JobNimbusProbe,
} from "./action-handlers";

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function ProbeResults({ probe }: { probe: JobNimbusProbe }) {
  return (
    <dl className="grid gap-3 md:grid-cols-2">
      {([probe.contacts, probe.jobs] as const).map((result) => (
        <div key={result.resource} className="rounded-md border border-border p-4">
          <dt className="font-semibold text-ink">{humanize(result.resource)}</dt>
          <dd className={`mt-1 text-sm font-medium ${result.ok ? "text-ink" : "text-danger"}`}>
            HTTP {result.status} · {pluralize(result.recordCount, "record")}
          </dd>
          <dd className="mt-2 text-xs text-ink-subtle">
            {result.ok
              ? (result.fieldNames.length ? result.fieldNames.join(", ") : "No fields returned")
              : result.errorCategory ?? "upstream"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function JobNimbusConnectionPanel() {
  const [probeState, probeAction, probePending] = useActionState<
    JobNimbusActionState,
    FormData
  >(testJobNimbusConnection, idleJobNimbusActionState);
  const [importState, importAction, importPending] = useActionState<
    JobNimbusActionState,
    FormData
  >(importJobNimbusSample, idleJobNimbusActionState);
  const probesPassed = Boolean(
    probeState.probe?.contacts.ok && probeState.probe.jobs.ok,
  );

  return (
    <Card title="JobNimbus connection canary" ariaLabel="JobNimbus connection canary">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          Tests one contact and one job using read-only requests. Results contain field names only.
        </p>
        <form action={probeAction}>
          <button
            type="submit"
            disabled={probePending}
            className={secondaryButtonClasses}
          >
            {probePending ? "Testing connection..." : "Test JobNimbus connection"}
          </button>
        </form>

        {probeState.probe ? <ProbeResults probe={probeState.probe} /> : null}
        {probeState.message ? <p role="alert" className="text-sm text-danger">{probeState.message}</p> : null}

        {probesPassed ? (
          <form action={importAction} className="border-t border-border pt-4">
            <p className="mb-3 text-xs text-ink-subtle">
              Imports at most the configured staging cap. Scheduled JobNimbus ingestion stays disabled.
            </p>
            <button
              type="submit"
              disabled={importPending}
              className={primaryButtonClasses}
            >
              {importPending ? "Importing sample..." : "Import limited sample"}
            </button>
          </form>
        ) : null}

        {importState.importResult ? (
          <dl className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Contacts</dt>
              <dd className="mt-1 text-sm text-ink">
                {importState.importResult.contactsSeen} seen · {importState.importResult.contactsWritten} written
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Jobs</dt>
              <dd className="mt-1 text-sm text-ink">
                {importState.importResult.jobsSeen} seen · {importState.importResult.jobsWritten} written
              </dd>
            </div>
          </dl>
        ) : null}
        {importState.message ? <p role="alert" className="text-sm text-danger">{importState.message}</p> : null}
      </div>
    </Card>
  );
}
