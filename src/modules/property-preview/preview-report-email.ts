import type { RoofComplexity } from "@/domain/roof-complexity";

// Homeowner-facing "Email me this" report and its two reminders. Plain text,
// no price (the price is unlocked on the site), always with an unsubscribe link.

export type PreviewReportKind = "report" | "reminder_1" | "reminder_2";

const COMPLEXITY_PHRASE: Record<RoofComplexity, string> = {
  simple: "a simple roof",
  moderate: "a moderately complex roof",
  complex: "a complex roof",
};

export function composePreviewReportEmail(input: {
  kind: PreviewReportKind;
  brandName: string;
  address: string;
  roof: {squares: number; complexity: RoofComplexity} | null;
  resumeUrl: string;
  unsubscribeUrl: string;
}) {
  const roofLine = input.roof
    ? `About ${input.roof.squares} roofing squares, measured from above: ${COMPLEXITY_PHRASE[input.roof.complexity]}.`
    : "A roofing specialist will confirm your roof’s measurements.";

  const subject = {
    report: `Your roof report for ${input.address}`,
    reminder_1: "Your roof price is one step away",
    reminder_2: "Still thinking about your roof?",
  }[input.kind];

  const opening = {
    report: `Here’s the roof report you asked for.`,
    reminder_1: `You started a roof estimate yesterday. Your price is one step away.`,
    reminder_2: `Your roof estimate is saved. Pick up where you left off whenever you’re ready.`,
  }[input.kind];

  const text = [
    opening,
    "",
    input.address,
    roofLine,
    "",
    `See your Good, Better and Best options: ${input.resumeUrl}`,
    "",
    `— ${input.brandName}`,
    "",
    `You’re receiving this because you asked us to email this report. Unsubscribe: ${input.unsubscribeUrl}`,
  ].join("\n");

  return {subject, text};
}
