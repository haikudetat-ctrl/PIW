import {render, screen} from "@testing-library/react";
import {beforeEach, describe, expect, test, vi} from "vitest";

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
    } as {
      id: string;
      status: "pending" | "ready" | "review_required";
      range_low_cents: number | null;
      range_high_cents: number | null;
      roof_squares: number | null;
      failure_reason: string | null;
      lead_id: string;
      property_id: string;
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
    } as {
      status: "in_progress" | "abandoned" | "completed";
      revision: number;
      current_step: number;
      property_revealed_at: string | null;
      responses: Record<string, unknown>;
      recommendation: "monitor_or_repair" | "professional_inspection" | "replacement_may_make_sense" | null;
    },
  },
}));

const assessmentMounts = vi.hoisted(() => ({
  questionnaire: 0,
}));

const serverEnv = vi.hoisted(() => ({
  assessmentEnabled: true,
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
  parseServerEnv: () => ({ROOF_ASSESSMENT_ENABLED: serverEnv.assessmentEnabled}),
}));

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not found"); },
  useRouter: () => ({refresh: vi.fn()}),
}));

vi.mock("./assessment-questionnaire", async () => {
  const React = await import("react");
  const {AssessmentRevisionContext} = await import("./assessment-revision-context");
  return {
    AssessmentQuestionnaire: ({initialStep, initialResponses}: {initialStep: number; initialResponses: unknown}) => {
      assessmentMounts.questionnaire += 1;
      const revision = React.useContext(AssessmentRevisionContext);
      return <p data-responses={JSON.stringify(initialResponses)}>Questionnaire revision {revision} at step {initialStep}</p>;
    },
  };
});

vi.mock("./assessment-result", () => ({
  AssessmentResult: () => <p>Completed assessment result</p>,
}));

const {default: RoofEstimateResultPage} = await import("./page");

describe("production roof assessment page", () => {
  beforeEach(() => {
    database.selects.length = 0;
    assessmentMounts.questionnaire = 0;
    serverEnv.assessmentEnabled = true;
    database.rows.roof_estimates = {
      id: "22222222-2222-4222-8222-222222222222",
      status: "pending",
      range_low_cents: null,
      range_high_cents: null,
      roof_squares: null,
      failure_reason: null,
      lead_id: "33333333-3333-4333-8333-333333333333",
      property_id: "44444444-4444-4444-8444-444444444444",
    };
    database.rows.roof_assessments = {
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
    };
  });

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

  test("never mounts or serializes saved assessment state from an abandoned public token", async () => {
    database.rows.roof_assessments = {
      status: "abandoned",
      revision: 19,
      current_step: 8,
      property_revealed_at: "2026-08-24T12:00:00.000Z",
      responses: {
        reason: "active_leak",
        priority: "long_warranty",
        timeline: "asap",
      },
      recommendation: null,
    };

    const {container} = render(await RoofEstimateResultPage({
      params: Promise.resolve({token: "11111111-1111-4111-8111-111111111111"}),
    }));

    expect(screen.getByRole("heading", {name: "Your secure assessment link has expired."})).toBeVisible();
    expect(screen.getByRole("link", {name: "Start a new RoofCheck"})).toHaveAttribute("href", "/roof-estimate");
    expect(assessmentMounts.questionnaire).toBe(0);
    expect(screen.queryByText(/Questionnaire revision/)).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("active_leak");
    expect(container.innerHTML).not.toContain("long_warranty");
    expect(container.innerHTML).not.toContain("11111111-1111-4111-8111-111111111111");
  });

  test("keeps a disabled abandoned assessment private without rendering legacy property or result data", async () => {
    serverEnv.assessmentEnabled = false;
    database.rows.roof_estimates = {
      ...database.rows.roof_estimates,
      status: "ready",
      range_low_cents: 1_850_000,
      range_high_cents: 2_475_000,
      roof_squares: 24.5,
    };
    database.rows.roof_assessments = {
      status: "abandoned",
      revision: 19,
      current_step: 8,
      property_revealed_at: "2026-08-24T12:00:00.000Z",
      responses: {
        reason: "private_active_leak",
        priority: "private_long_warranty",
        timeline: "asap",
      },
      recommendation: "replacement_may_make_sense",
    };

    const {container} = render(await RoofEstimateResultPage({
      params: Promise.resolve({token: "11111111-1111-4111-8111-111111111111"}),
    }));

    expect(screen.getByRole("heading", {name: "Your secure assessment link has expired."})).toBeVisible();
    expect(screen.getByRole("link", {name: "Start a new RoofCheck"})).toHaveAttribute("href", "/roof-estimate");
    expect(assessmentMounts.questionnaire).toBe(0);
    expect(screen.queryByText(/Questionnaire revision/)).not.toBeInTheDocument();
    expect(screen.queryByText("Completed assessment result")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("1 Main St, Newark, NJ 07102");
    expect(container.innerHTML).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(container.innerHTML).not.toContain("/api/roof-estimate/");
    expect(container.innerHTML).not.toContain("private_active_leak");
    expect(container.innerHTML).not.toContain("private_long_warranty");
    expect(container.innerHTML).not.toContain("$18,500");
    expect(container.innerHTML).not.toContain("$24,750");
  });

  test("keeps completed assessments on the result payoff", async () => {
    database.rows.roof_assessments = {
      status: "completed",
      revision: 10,
      current_step: 9,
      property_revealed_at: "2026-08-26T12:00:00.000Z",
      responses: {
        reason: "planning",
        roofAge: "unknown",
        conditionSignals: ["unsure"],
        roofVisible: "no",
        visibleCondition: "not_answered",
        stories: "two",
        complexityFeatures: ["none_or_unsure"],
        priority: "understand_options",
        timeline: "researching",
        ownership: "owner",
      },
      recommendation: "monitor_or_repair",
    };

    render(await RoofEstimateResultPage({
      params: Promise.resolve({token: "11111111-1111-4111-8111-111111111111"}),
    }));

    expect(screen.getByText("Completed assessment result")).toBeVisible();
    expect(assessmentMounts.questionnaire).toBe(0);
  });
});
