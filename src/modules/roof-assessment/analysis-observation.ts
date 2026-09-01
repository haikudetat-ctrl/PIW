const CORRELATION = /^raj_[0-9a-f]{32}$/;

type AssessmentObservationRecord = {
  correlation: string;
  eventType:
    | "assessment_prefetch_path_selected"
    | "roof_assessment_property_prefetch"
    | "roof estimate image request completed"
    | "assessment_analysis_revealed";
  outcome: string;
  status?: number;
  occurredAt: number;
  ingestId: string;
};

function ordered(records: AssessmentObservationRecord[]) {
  return [...records].sort((left, right) => (
    left.occurredAt - right.occurredAt || left.ingestId.localeCompare(right.ingestId)
  ));
}

export function selectAssessmentObservation(records: AssessmentObservationRecord[]) {
  const exactEvents = new Map<string, AssessmentObservationRecord>();
  const imageOutcomes = new Map<string, AssessmentObservationRecord>();
  const firstReady = new Map<string, AssessmentObservationRecord>();

  for (const record of ordered(records)) {
    if (!CORRELATION.test(record.correlation)) continue;
    if (record.eventType === "roof estimate image request completed") {
      const outcomeKey = `${record.correlation}\0${record.outcome}`;
      if (!imageOutcomes.has(outcomeKey)) imageOutcomes.set(outcomeKey, record);
      if (
        record.outcome === "ready"
        && record.status === 200
        && !firstReady.has(record.correlation)
      ) {
        firstReady.set(record.correlation, record);
      }
      continue;
    }
    const exactKey = `${record.correlation}\0${record.eventType}`;
    if (!exactEvents.has(exactKey)) exactEvents.set(exactKey, record);
  }

  const correlations = new Set(
    [...exactEvents.values()].map((record) => record.correlation),
  );
  const cleanSuccessfulAerial = [...correlations].flatMap((correlation) => {
    const path = exactEvents.get(`${correlation}\0assessment_prefetch_path_selected`);
    const completion = exactEvents.get(`${correlation}\0roof_assessment_property_prefetch`);
    const reveal = exactEvents.get(`${correlation}\0assessment_analysis_revealed`);
    if (
      path?.outcome !== "prefetch_candidate"
      || !["applied", "already_applied"].includes(completion?.outcome ?? "")
      || !reveal
      || !firstReady.has(correlation)
    ) return [];
    return [{
      correlation,
      revealOutcome: reveal.outcome,
      occurredAt: reveal.occurredAt,
    }];
  }).sort((left, right) => (
    left.occurredAt - right.occurredAt || left.correlation.localeCompare(right.correlation)
  )).map(({correlation, revealOutcome}) => ({correlation, revealOutcome}));

  const imageFallbacks = [...imageOutcomes.values()]
    .filter((record) => record.outcome !== "ready" || record.status !== 200)
    .map((record) => ({
      correlation: record.correlation,
      outcome: record.outcome,
      status: record.status,
    }));

  return {cleanSuccessfulAerial, imageFallbacks};
}
