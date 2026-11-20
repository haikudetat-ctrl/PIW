import { z } from "zod";

// A production closeout: what the production manager confirms when an
// installed job is finished, and what the homeowner signs at the walkthrough.

export const CLOSEOUT_PACKAGE_PHOTO_LIMIT = 12;

// Bump when any homeowner-facing wording below changes. The version signed
// is stored with the signature, so a package can be traced to its words.
export const HOMEOWNER_TERMS_VERSION = "2026-11-20";

export type ChecklistAnswer = "done" | "na";

export type ChecklistItem = {
  key: string;
  label: string;
  // Items that only some jobs have.
  appliesTo?: (job: { jobType: string | null }) => boolean;
};

// Solar panels are removed and reinstalled ("R&R") around the new roof.
export function hasSolarRemoveAndReinstall(jobType: string | null): boolean {
  return /\bR\s*&\s*R\b|\bRR\b|remove\s*(and|&)\s*reinstall/i.test(jobType ?? "");
}

export const CLOSEOUT_CHECKLIST: readonly ChecklistItem[] = [
  { key: "tear_off", label: "Old roofing removed to the deck" },
  { key: "deck_inspected", label: "Deck inspected and soft sheathing replaced" },
  { key: "ice_and_water", label: "Ice and water shield at eaves, valleys and penetrations" },
  { key: "underlayment", label: "Underlayment installed" },
  { key: "drip_edge", label: "Drip edge installed" },
  { key: "flashing", label: "Flashing replaced at walls, chimneys and pipes" },
  { key: "ventilation", label: "Ridge and attic ventilation installed" },
  { key: "shingles_to_spec", label: "Shingles installed to the manufacturer's instructions" },
  {
    key: "solar_reinstalled",
    label: "Solar panels reinstalled and producing",
    appliesTo: (job) => hasSolarRemoveAndReinstall(job.jobType),
  },
  { key: "gutters_cleared", label: "Gutters and downspouts cleared of debris" },
  { key: "magnet_sweep", label: "Yard and driveway swept for nails" },
  { key: "site_cleared", label: "Dumpster and leftover material removed" },
];

export function checklistFor(jobType: string | null): ChecklistItem[] {
  return CLOSEOUT_CHECKLIST.filter((item) => !item.appliesTo || item.appliesTo({ jobType }));
}

// A delivered job still in a pre-sale JobNimbus status means the office
// never moved it: worth a second look before closing it out. Custom
// production statuses that aren't mapped to a stage are not flagged;
// "Lead", JobNimbus's default first status, is.
const PRE_SALE_STAGES = new Set([
  "lead_received",
  "handoff",
  "contacted",
  "appointment_set",
  "appointment_ran",
  "appointment_no_show",
  "quoted",
  "lost",
]);

export function isPreSaleStatus(statusName: string | null, stage: string | null): boolean {
  if (stage) return PRE_SALE_STAGES.has(stage);
  return /^\s*lead\s*$/i.test(statusName ?? "");
}

// -----------------------------------------------------------------------------
// Form input
// -----------------------------------------------------------------------------

const isoDate = z.union([z.literal(""), z.iso.date()]);
const optionalText = (max: number) =>
  z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().max(max)).default("");
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? "" : value),
    z.union([z.literal(""), z.coerce.number().pipe(schema)]),
  );

export const closeoutFieldsSchema = z
  .object({
    install_started_on: isoDate.default(""),
    install_completed_on: isoDate.default(""),
    crew: optionalText(120),
    squares_installed: optionalNumber(z.number().gt(0).lt(1000)).default(""),
    layers_removed: optionalNumber(z.number().int().min(0).max(5)).default(""),
    decking_sheets_replaced: optionalNumber(z.number().int().min(0).max(500)).default(""),
    checklist: z.record(z.string().regex(/^[a-z_]+$/), z.enum(["done", "na"])).default({}),
    punch_items: optionalText(2000),
    production_notes: optionalText(4000),
    feature_note: optionalText(280),
    selected_photo_jnids: z.array(z.string().min(1).max(64)).max(CLOSEOUT_PACKAGE_PHOTO_LIMIT).default([]),
    homeowner_unavailable_reason: optionalText(500),
  })
  .refine(
    (fields) =>
      !fields.install_started_on
      || !fields.install_completed_on
      || fields.install_started_on <= fields.install_completed_on,
    { message: "The install can't finish before it starts", path: ["install_completed_on"] },
  );

export type CloseoutFields = z.infer<typeof closeoutFieldsSchema>;

// Reads the closeout form. Checklist answers arrive as `checklist.<key>`,
// photo picks as repeated `photo` values.
export function parseCloseoutForm(formData: FormData, jobType: string | null): CloseoutFields {
  const allowed = new Set(checklistFor(jobType).map((item) => item.key));
  const checklist: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("checklist.") || typeof value !== "string") continue;
    const key = name.slice("checklist.".length);
    if (allowed.has(key) && (value === "done" || value === "na")) checklist[key] = value;
  }
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return closeoutFieldsSchema.parse({
    install_started_on: text("install_started_on"),
    install_completed_on: text("install_completed_on"),
    crew: text("crew"),
    squares_installed: text("squares_installed"),
    layers_removed: text("layers_removed"),
    decking_sheets_replaced: text("decking_sheets_replaced"),
    checklist,
    punch_items: text("punch_items"),
    production_notes: text("production_notes"),
    feature_note: text("feature_note"),
    selected_photo_jnids: formData.getAll("photo").filter((value): value is string => typeof value === "string"),
    homeowner_unavailable_reason: text("homeowner_unavailable_reason"),
  });
}

// -----------------------------------------------------------------------------
// Readiness
// -----------------------------------------------------------------------------

export type CloseoutState = {
  installStartedOn: string | null;
  installCompletedOn: string | null;
  checklist: Record<string, unknown>;
  homeownerSignedAt: string | null;
  homeownerUnavailableReason: string | null;
  selectedPhotoCount: number;
};

// What still stands between this closeout and submit, in the order the form
// asks for it. Empty means ready.
export function closeoutGaps(state: CloseoutState, jobType: string | null, today: string): string[] {
  const gaps: string[] = [];
  if (!state.installStartedOn || !state.installCompletedOn) gaps.push("Add the install start and finish dates");
  else if (state.installCompletedOn > today) gaps.push("The finish date is in the future");
  const unanswered = checklistFor(jobType).filter((item) => {
    const answer = state.checklist[item.key];
    return answer !== "done" && answer !== "na";
  });
  if (unanswered.length > 0) {
    gaps.push(`Answer ${unanswered.length} checklist ${unanswered.length === 1 ? "item" : "items"}`);
  }
  if (state.selectedPhotoCount === 0) gaps.push("Pick at least one photo for the package");
  if (!state.homeownerSignedAt && !state.homeownerUnavailableReason) {
    gaps.push("Get the homeowner's sign-off, or note why they couldn't sign");
  }
  return gaps;
}

// -----------------------------------------------------------------------------
// Homeowner wording
// -----------------------------------------------------------------------------

export type HomeownerOutcome = "complete" | "complete_with_items";

// The open items are part of the sentence the homeowner signs, so the
// signed record stands on its own wherever it is read.
export function homeownerStatement(input: {
  companyName: string;
  workDescription: string;
  address: string;
  completedOn: string;
  outcome: HomeownerOutcome;
  openItems?: string | null;
}): string {
  const base = `I walked the finished work with ${input.companyName} and confirm the ${input.workDescription} at ${input.address}, finished on ${formatLongDate(input.completedOn)}, is complete`;
  const items = input.openItems?.trim().replace(/\s+/g, " ").replace(/[.;,\s]+$/, "");
  if (input.outcome === "complete" || !items) return `${base}.`;
  return `${base}, except for these open items: ${items}.`;
}

export function photoReleaseText(companyName: string): string {
  return `${companyName} may share photos of my new roof on its website and social media. It will name my town only, never my name or street address.`;
}

export function reviewRequestText(companyName: string): string {
  return `${companyName} may send me a link to leave a review.`;
}

export function workDescription(jobType: string | null): string {
  if (hasSolarRemoveAndReinstall(jobType)) return "roof replacement, with solar panels removed and reinstalled,";
  return "roof replacement";
}

export function formatLongDate(isoDay: string): string {
  const [year, month, day] = isoDay.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// -----------------------------------------------------------------------------
// Signature
// -----------------------------------------------------------------------------

export const SIGNATURE_BOX = { width: 600, height: 200 } as const;

export type SignaturePoint = { x: number; y: number };

// Strokes become one SVG path of move and line commands, in the signature
// box's own units. Only digits and M/L reach storage, so a signature can
// never carry markup into the package.
export function signaturePath(strokes: SignaturePoint[][]): string {
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  const round = (value: number) => Math.round(value * 10) / 10;
  return strokes
    .filter((stroke) => stroke.length > 0)
    .map((stroke) =>
      stroke
        .map((point, index) => {
          const x = round(clamp(point.x, SIGNATURE_BOX.width));
          const y = round(clamp(point.y, SIGNATURE_BOX.height));
          return `${index === 0 ? "M" : "L"} ${x} ${y}`;
        })
        .join(" "),
    )
    .join(" ");
}

const SIGNATURE_PATTERN = /^[ML0-9., -]+$/;

// A real signature has some length to it, not a tap.
export function isUsableSignature(path: string): boolean {
  if (path.length < 20 || path.length > 200_000 || !SIGNATURE_PATTERN.test(path)) return false;
  const points = path.match(/[ML]\s*[0-9.]+\s+[0-9.]+/g) ?? [];
  if (points.length < 5) return false;
  let travel = 0;
  let previous: [number, number] | null = null;
  for (const point of points) {
    const [command, x, y] = point.trim().split(/\s+/);
    const current: [number, number] = [Number(x), Number(y)];
    if (command === "L" && previous) travel += Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    previous = current;
  }
  return travel >= 40;
}

export const signoffInputSchema = z.object({
  homeownerName: z.string().trim().min(1, "Type your name").max(120),
  outcome: z.enum(["complete", "complete_with_items"]),
  photoRelease: z.enum(["granted", "declined"], { message: "Choose yes or no for photos" }),
  reviewRequestOk: z.enum(["yes", "no"], { message: "Choose yes or no for the review link" }).transform((value) => value === "yes"),
  signaturePath: z.string().refine(isUsableSignature, "Sign in the box"),
});

// -----------------------------------------------------------------------------
// Prefill: what JobNimbus said when the closeout started
// -----------------------------------------------------------------------------

const nullableString = z.string().nullable().optional().transform((value) => value ?? null);

export const closeoutPrefillSchema = z.object({
  job: z
    .object({
      jnid: z.string(),
      number: nullableString,
      status_name: nullableString,
      record_type_name: nullableString,
      job_type: nullableString,
      shingle_line: nullableString,
      sales_rep_name: nullableString,
      address_line1: nullableString,
      city: nullableString,
      state: nullableString,
      zip: nullableString,
      customer_name: nullableString,
    })
    .partial({ jnid: true })
    .prefault({}),
  delivered_at: nullableString,
  delivery_documents: z
    .array(z.object({ jnid: z.string(), filename: nullableString, created_at: nullableString }))
    .default([]),
  install_photo_days: z
    .object({ first: nullableString, last: nullableString, photos: z.number().nullable().optional() })
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  roofr: z
    .object({ squares: z.number().nullable().optional(), pitch_12: z.number().nullable().optional() })
    .nullable()
    .optional()
    .transform((value) => value ?? null),
});

export type CloseoutPrefill = z.infer<typeof closeoutPrefillSchema>;

export function parsePrefill(value: unknown): CloseoutPrefill {
  const parsed = closeoutPrefillSchema.safeParse(value);
  return parsed.success ? parsed.data : closeoutPrefillSchema.parse({});
}

export function formatAddress(job: CloseoutPrefill["job"]): string {
  const street = job.address_line1?.trim();
  const place = [job.city?.trim(), [job.state?.trim(), job.zip?.trim()].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [street, place].filter(Boolean).join(", ");
}

export function packageFilename(jobNumber: string | null, closeoutId: string): string {
  const label = jobNumber ? `Job ${jobNumber.replace(/[^A-Za-z0-9-]/g, "")}` : `Closeout ${closeoutId.slice(0, 8)}`;
  return `Closeout package - ${label}.pdf`;
}
