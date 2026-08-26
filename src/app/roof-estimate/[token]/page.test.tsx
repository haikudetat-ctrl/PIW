import {render, screen} from "@testing-library/react";
import {beforeEach, describe, expect, test, vi} from "vitest";

const database = vi.hoisted(() => ({
  selects: [] as {table: string; columns: string}[],
  rows: {
    roof_estimates: {
      id: "22222222-2222-4222-8222-222222222222",
      company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "pending",
      range_low_cents: null,
      range_high_cents: null,
      roof_squares: null,
      roof_insight_id: null,
      updated_at: "2026-08-26T12:00:00.000Z",
      failure_reason: null,
      lead_id: "33333333-3333-4333-8333-333333333333",
      property_id: "44444444-4444-4444-8444-444444444444",
    } as {
      id: string;
      company_id: string;
      status: "pending" | "ready" | "review_required";
      range_low_cents: number | null;
      range_high_cents: number | null;
      roof_squares: number | null;
      failure_reason: string | null;
      lead_id: string;
      property_id: string;
      roof_insight_id: string | null;
      updated_at: string;
    },
    pipeline_runs: {status: "complete"},
    roof_insights: {
      id: "55555555-5555-4555-8555-555555555555",
      company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      property_id: "44444444-4444-4444-8444-444444444444",
      provider: "google_solar",
      lookup_status: "success",
    },
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
      presentation_key: "weather-report",
    } as {
      status: "in_progress" | "abandoned" | "completed";
      revision: number;
      current_step: number;
      property_revealed_at: string | null;
      responses: Record<string, unknown>;
      recommendation: "monitor_or_repair" | "professional_inspection" | "replacement_may_make_sense" | null;
      presentation_key: string;
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
  AssessmentResult: ({calculation, context}: {calculation: unknown; context: {resultHeadline: string}}) => (
    <p data-calculation={JSON.stringify(calculation)} data-framing={context.resultHeadline}>Completed assessment result</p>
  ),
}));

const {default: RoofEstimateResultPage} = await import("./page");

describe("production roof assessment page", () => {
  beforeEach(() => {
    database.selects.length = 0;
    assessmentMounts.questionnaire = 0;
    serverEnv.assessmentEnabled = true;
    database.rows.pipeline_runs={status:"complete"};
    database.rows.roof_insights={id:"55555555-5555-4555-8555-555555555555",company_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",property_id:"44444444-4444-4444-8444-444444444444",provider:"google_solar",lookup_status:"success"};
    database.rows.roof_estimates = {
      id: "22222222-2222-4222-8222-222222222222",
      company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "pending",
      range_low_cents: null,
      range_high_cents: null,
      roof_squares: null,
      roof_insight_id: null,
      updated_at: "2026-08-26T12:00:00.000Z",
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
      presentation_key: "weather-report",
    };
  });

  test("selects and provides the persisted revision when resuming questions", async () => {
    render(await RoofEstimateResultPage({
      params: Promise.resolve({token: "11111111-1111-4111-8111-111111111111"}),
    }));

    expect(screen.getByText("Questionnaire revision 7 at step 4")).toBeVisible();
    expect(database.selects).toContainEqual({
      table: "roof_assessments",
      columns: "status, revision, current_step, property_revealed_at, responses, recommendation, presentation_key",
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
      presentation_key: "weather-report",
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
      presentation_key: "weather-report",
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
      presentation_key: "weather-report",
    };

    render(await RoofEstimateResultPage({
      params: Promise.resolve({token: "11111111-1111-4111-8111-111111111111"}),
    }));

    expect(screen.getByText("Completed assessment result")).toBeVisible();
    expect(assessmentMounts.questionnaire).toBe(0);
    expect(screen.getByText("Completed assessment result")).toHaveAttribute("data-framing", "Your roof weather outlook");
  });

  test("downgrades invalid ready values before crossing the client boundary", async () => {
    database.rows.roof_estimates = {
      ...database.rows.roof_estimates,
      status: "ready",
      range_low_cents: 1_850_000,
      range_high_cents: 2_475_000,
      roof_squares: 24.5,
      roof_insight_id: null,
    };
    database.rows.roof_assessments = {
      status: "completed", revision: 10, current_step: 9,
      property_revealed_at: "2026-08-26T12:00:00.000Z",
      responses: {reason:"planning",roofAge:"unknown",conditionSignals:["unsure"],roofVisible:"no",visibleCondition:"not_answered",stories:"two",complexityFeatures:["none_or_unsure"],priority:"understand_options",timeline:"researching",ownership:"owner"},
      recommendation: "monitor_or_repair", presentation_key: "weather-report",
    };
    render(await RoofEstimateResultPage({params: Promise.resolve({token: "11111111-1111-4111-8111-111111111111"})}));
    const result=screen.getByText("Completed assessment result");
    expect(result).toHaveAttribute("data-calculation", JSON.stringify({status:"review_required",reason:"low_confidence"}));
    expect(result.getAttribute("data-calculation")).not.toMatch(/1850000|2475000|24\.5/);
  });

  test.each([
    ["trusted Google insight", {}, "complete", "ready"],
    ["foreign company insight", {company_id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}, "complete", "review_required"],
    ["foreign property insight", {property_id:"66666666-6666-4666-8666-666666666666"}, "complete", "review_required"],
    ["wrong provider insight", {provider:"manual"}, "complete", "review_required"],
    ["failed insight", {lookup_status:"error"}, "complete", "review_required"],
    ["failed pipeline", {}, "failed", "review_required"],
    ["partial pipeline", {}, "partial", "review_required"],
  ])("binds ready output to %s", async (_label, insightPatch, pipelineStatus, expectedStatus) => {
    database.rows.roof_estimates={...database.rows.roof_estimates,status:"ready",range_low_cents:1_850_000,range_high_cents:2_475_000,roof_squares:24.5,roof_insight_id:"55555555-5555-4555-8555-555555555555"};
    database.rows.roof_insights={...database.rows.roof_insights,...insightPatch};
    database.rows.pipeline_runs.status=pipelineStatus;
    database.rows.roof_assessments={status:"completed",revision:10,current_step:9,property_revealed_at:"2026-08-26T12:00:00.000Z",responses:{reason:"planning",roofAge:"unknown",conditionSignals:["unsure"],roofVisible:"no",visibleCondition:"not_answered",stories:"two",complexityFeatures:["none_or_unsure"],priority:"understand_options",timeline:"researching",ownership:"owner"},recommendation:"monitor_or_repair",presentation_key:"weather-report"};
    render(await RoofEstimateResultPage({params:Promise.resolve({token:"11111111-1111-4111-8111-111111111111"})}));
    expect(JSON.parse(screen.getByText("Completed assessment result").getAttribute("data-calculation")!)).toMatchObject({status:expectedStatus});
  });
});
