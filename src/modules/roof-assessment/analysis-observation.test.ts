import {describe, expect, test} from "vitest";
import {selectAssessmentObservation} from "./analysis-observation";

const correlation = "raj_0123456789abcdef0123456789abcdef";

function baseEvents() {
  return [
    {
      correlation,
      eventType: "assessment_prefetch_path_selected" as const,
      outcome: "prefetch_candidate",
      occurredAt: 1,
      ingestId: "a",
    },
    {
      correlation,
      eventType: "roof_assessment_property_prefetch" as const,
      outcome: "applied",
      occurredAt: 2,
      ingestId: "b",
    },
    {
      correlation,
      eventType: "assessment_analysis_revealed" as const,
      outcome: "ready_at_8s",
      occurredAt: 8_000,
      ingestId: "reveal",
    },
  ];
}

describe("assessment observation selection", () => {
  test.each([
    [
      "pending then ready",
      [
        {outcome: "coordinates_pending", status: 404, occurredAt: 50},
        {outcome: "ready", status: 200, occurredAt: 3_000},
      ],
    ],
    [
      "provider failure then ready",
      [
        {outcome: "provider_failed", status: 502, occurredAt: 75},
        {outcome: "ready", status: 200, occurredAt: 3_500},
      ],
    ],
    [
      "immediate ready",
      [{outcome: "ready", status: 200, occurredAt: 100}],
    ],
  ] as const)("includes a clean successful aerial after %s", (_case, imageEvents) => {
    const selection = selectAssessmentObservation([
      ...baseEvents(),
      ...imageEvents.map((event, index) => ({
        correlation,
        eventType: "roof estimate image request completed" as const,
        ingestId: `image-${index}`,
        ...event,
      })),
    ]);

    expect(selection.cleanSuccessfulAerial).toEqual([{
      correlation,
      revealOutcome: "ready_at_8s",
    }]);
  });

  test("keeps persistent failure outside the denominator and inside failure series", () => {
    const selection = selectAssessmentObservation([
      ...baseEvents(),
      {
        correlation,
        eventType: "roof estimate image request completed",
        outcome: "provider_failed",
        status: 502,
        occurredAt: 75,
        ingestId: "failure-1",
      },
      {
        correlation,
        eventType: "roof estimate image request completed",
        outcome: "provider_failed",
        status: 502,
        occurredAt: 100,
        ingestId: "failure-2",
      },
    ]);

    expect(selection.cleanSuccessfulAerial).toEqual([]);
    expect(selection.imageFallbacks).toEqual([{
      correlation,
      outcome: "provider_failed",
      status: 502,
    }]);
  });

  test("dedupes path, completion, and reveal exactly while preserving image outcomes", () => {
    const selection = selectAssessmentObservation([
      ...baseEvents(),
      {
        correlation,
        eventType: "assessment_analysis_revealed",
        outcome: "ready_between_8s_12s",
        occurredAt: 9_000,
        ingestId: "duplicate-reveal",
      },
      {
        correlation,
        eventType: "roof estimate image request completed",
        outcome: "coordinates_pending",
        status: 404,
        occurredAt: 25,
        ingestId: "pending",
      },
      {
        correlation,
        eventType: "roof estimate image request completed",
        outcome: "ready",
        status: 200,
        occurredAt: 100,
        ingestId: "ready",
      },
    ]);

    expect(selection.cleanSuccessfulAerial[0]?.revealOutcome).toBe("ready_at_8s");
    expect(selection.imageFallbacks).toEqual([{
      correlation,
      outcome: "coordinates_pending",
      status: 404,
    }]);
  });
});
