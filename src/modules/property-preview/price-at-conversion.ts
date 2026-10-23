import type {RoofEstimateEvent} from "@/inngest/functions/roof-estimate-worker";

/**
 * Prices a value-first lead inside its contact submission, so the estimate is
 * ready when the homeowner lands on it.
 *
 * The preview already measured the roof at the address step. What used to take
 * seconds to minutes was the hand-off: the intake writes a
 * `property/discovery_requested` event to the outbox, a once-a-minute cron
 * publishes it, and only then does the estimate worker price from the cached
 * measurement. This runs that same worker step (`runRoofEstimate`) on that
 * same event straight away. The worker's idempotency key (pipeline run and
 * attempt) makes the later cron-driven run a no-op.
 *
 * It only runs when the measurement is already cached, so it never calls
 * Google from the submit request, and it gives up waiting after `budgetMs`
 * (the work then finishes after the response). Anything it skips is priced by
 * the worker as before.
 */
export type ConversionPricingOutcome =
  | {kind: "priced"; outcome: string; durationMs: number}
  | {kind: "skipped"; reason: "no_discovery_event" | "not_measured"}
  | {kind: "deferred"; durationMs: number}
  | {kind: "failed"; durationMs: number};

export type ConversionPricingDependencies = {
  /** The discovery event the intake queued for this lead, if it has one. */
  findDiscoveryEvent(input: {companyId: string; leadId: string}): Promise<RoofEstimateEvent | null>;
  /** True when the roof measurement for this address is already cached. */
  hasCachedMeasurement(input: {companyId: string; event: RoofEstimateEvent}): Promise<boolean>;
  /** The estimate worker's own step. */
  run(event: RoofEstimateEvent): Promise<{outcome: string}>;
  /** Lets unfinished work complete after the response (`after()` in a route). */
  defer(work: Promise<unknown>): void;
  log(record: Record<string, unknown>): void;
  now?: () => number;
};

export const CONVERSION_PRICING_BUDGET_MS = 4_000;

export async function priceConvertedLead(
  input: {companyId: string; leadId: string; budgetMs?: number},
  dependencies: ConversionPricingDependencies,
): Promise<ConversionPricingOutcome> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const finish = (outcome: ConversionPricingOutcome) => {
    dependencies.log({message: "preview_conversion_pricing", ...outcome});
    return outcome;
  };

  const event = await dependencies.findDiscoveryEvent(input);
  if (!event) return finish({kind: "skipped", reason: "no_discovery_event"});
  if (!await dependencies.hasCachedMeasurement({companyId: input.companyId, event})) {
    return finish({kind: "skipped", reason: "not_measured"});
  }

  const work = dependencies.run(event).then(
    (result) => ({kind: "done" as const, outcome: result.outcome}),
    (error: unknown) => ({kind: "error" as const, message: error instanceof Error ? error.message : "unknown"}),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{kind: "timeout"}>((resolve) => {
    timer = setTimeout(() => resolve({kind: "timeout"}), input.budgetMs ?? CONVERSION_PRICING_BUDGET_MS);
  });
  const first = await Promise.race([work, timeout]);
  clearTimeout(timer);
  const durationMs = Math.max(0, now() - startedAt);

  if (first.kind === "timeout") {
    dependencies.defer(work);
    return finish({kind: "deferred", durationMs});
  }
  if (first.kind === "error") {
    dependencies.log({message: "preview_conversion_pricing_error", error: first.message});
    return finish({kind: "failed", durationMs});
  }
  return finish({kind: "priced", outcome: first.outcome, durationMs});
}
