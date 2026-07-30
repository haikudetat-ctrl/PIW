export type ActivityItem =
  | { kind: "stage_change"; occurredAt: string; fromStage: string | null; toStage: string }
  | { kind: "interaction"; occurredAt: string; interactionType: string; summary: string };

export function buildActivityTimeline(
  stageHistory: { changed_at: string; from_stage: string | null; to_stage: string }[],
  interactions: { occurred_at: string; type: string; summary: string }[],
): ActivityItem[] {
  const stageItems: ActivityItem[] = stageHistory.map((row) => ({
    kind: "stage_change",
    occurredAt: row.changed_at,
    fromStage: row.from_stage,
    toStage: row.to_stage,
  }));

  const interactionItems: ActivityItem[] = interactions.map((row) => ({
    kind: "interaction",
    occurredAt: row.occurred_at,
    interactionType: row.type,
    summary: row.summary,
  }));

  return [...stageItems, ...interactionItems].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
}
