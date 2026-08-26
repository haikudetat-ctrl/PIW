import {render, screen} from "@testing-library/react";
import {describe, expect, test, vi} from "vitest";

const database = vi.hoisted(() => ({
  selects: [] as {table: string; columns: string}[],
  rows: {
    roof_estimates: {
      id: "22222222-2222-4222-8222-222222222222",
      status: "pending",
      range_low_cents: null,
      range_high_cents: null,
      roof_squares: null,
      failure_reason: null,
      lead_id: "33333333-3333-4333-8333-333333333333",
      property_id: "44444444-4444-4444-8444-444444444444",
    },
    pipeline_runs: {status: "complete"},
    properties: {canonical_address: "1 Main St, Newark, NJ 07102"},
    leads: {submitted_address: "1 Main St, Newark, NJ 07102", campaign: "weather-report"},
    roof_assessments: {
      status: "in_progress",
      revision: 7,
      current_step: 4,
      property_revealed_at: "2026-08-26T12:00:00.000Z",
      responses: {
        reason: "planning",
        roofAge: "unknown",
        conditionSignals: ["unsure"],
        roofVisible: "no",
        visibleCondition: "not_answered",
      },
      recommendation: null,
    },
  },
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: keyof typeof database.rows) => ({
      select: (columns: string) => {
        database.selects.push({table, columns});
        const builder = {
          eq: () => builder,
          order: () => builder,
          limit: () => builder,
          maybeSingle: async () => ({data: database.rows[table]}),
        };
        return builder;
      },
    }),
  }),
}));

vi.mock("@/lib/env/server", () => ({
  parseServerEnv: () => ({ROOF_ASSESSMENT_ENABLED: true}),
}));

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not found"); },
}));

vi.mock("./assessment-questionnaire", async () => {
  const React = await import("react");
  const {AssessmentRevisionContext} = await import("./assessment-revision-context");
  return {
    AssessmentQuestionnaire: ({initialStep}: {initialStep: number}) => {
      const revision = React.useContext(AssessmentRevisionContext);
      return <p>Questionnaire revision {revision} at step {initialStep}</p>;
    },
  };
});

const {default: RoofEstimateResultPage} = await import("./page");

describe("production roof assessment page", () => {
  test("selects and provides the persisted revision when resuming questions", async () => {
    render(await RoofEstimateResultPage({
      params: Promise.resolve({token: "11111111-1111-4111-8111-111111111111"}),
    }));

    expect(screen.getByText("Questionnaire revision 7 at step 4")).toBeVisible();
    expect(database.selects).toContainEqual({
      table: "roof_assessments",
      columns: "status, revision, current_step, property_revealed_at, responses, recommendation",
    });
  });
});
