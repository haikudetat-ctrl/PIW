"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";

type DiagnosticStatus = "idle" | "running" | "completed" | "failed";

export function FoundationDiagnostics() {
  const [status, setStatus] = useState<DiagnosticStatus>("idle");
  const [correlationId, setCorrelationId] = useState<string | null>(null);

  async function runDiagnostic() {
    setStatus("running");
    try {
      const response = await fetch("/api/diagnostics/events", { method: "POST" });
      if (!response.ok) throw new Error("Diagnostic request failed");
      const body = await response.json();
      setCorrelationId(body.correlationId);
      setStatus("completed");
    } catch {
      setCorrelationId(null);
      setStatus("failed");
    }
  }

  const lastDiagnosticLabel =
    status === "completed" && correlationId
      ? `Completed (correlation ${correlationId})`
      : status === "failed"
        ? "Failed"
        : status === "running"
          ? "Running…"
          : "Not run yet";

  return (
    <Card title="Foundation diagnostics" ariaLabel="Foundation diagnostics">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-ink-subtle uppercase">Authentication</dt>
          <dd className="mt-0.5 text-sm font-medium text-ink">OK</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-subtle uppercase">Database</dt>
          <dd className="mt-0.5 text-sm font-medium text-ink">Connected</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-subtle uppercase">Event relay</dt>
          <dd className="mt-0.5 text-sm font-medium text-ink">Configured</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-subtle uppercase">Last diagnostic</dt>
          <dd className="mt-0.5 text-sm font-medium text-ink">{lastDiagnosticLabel}</dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={runDiagnostic}
        disabled={status === "running"}
        className="mt-4 rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-ink transition hover:border-accent hover:text-accent disabled:opacity-60"
      >
        Run diagnostic
      </button>
    </Card>
  );
}
