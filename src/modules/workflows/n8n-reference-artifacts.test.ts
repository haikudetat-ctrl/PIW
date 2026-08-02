import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const referenceDirectory = resolve(
  process.cwd(),
  "n8n/workflows/reference/lead-automation-2026-08-01",
);

const artifacts = [
  "meta-capi-workflow.inactive.json",
  "roof-lookup-workflow.superseded.json",
  "speed-to-lead-workflow.inactive.json",
];

describe("audited n8n reference artifacts", () => {
  it.each(artifacts)("keeps %s inactive and credential-free", (artifact) => {
    const source = readFileSync(resolve(referenceDirectory, artifact), "utf8");
    const workflow = JSON.parse(source) as {
      active?: boolean;
      nodes?: Array<{ credentials?: unknown }>;
    };

    expect(workflow.active).toBe(false);
    expect(workflow.nodes?.length).toBeGreaterThan(0);
    expect(workflow.nodes?.every((node) => node.credentials === undefined)).toBe(true);
    expect(source).not.toMatch(/(?:service_role|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}/i);
  });
});
