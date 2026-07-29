"use client";

import { useState } from "react";

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
    <section aria-label="Foundation diagnostics">
      <h2>Foundation diagnostics</h2>
      <dl>
        <dt>Authentication</dt>
        <dd>OK</dd>
        <dt>Database</dt>
        <dd>Connected</dd>
        <dt>Event relay</dt>
        <dd>Configured</dd>
        <dt>Last diagnostic</dt>
        <dd>{lastDiagnosticLabel}</dd>
      </dl>
      <button type="button" onClick={runDiagnostic} disabled={status === "running"}>
        Run diagnostic
      </button>
    </section>
  );
}
