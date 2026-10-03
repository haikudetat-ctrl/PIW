import { summarizeRoofForPreview, type RoofComplexity } from "@/domain/roof-complexity";

// What the public preview page may know. Never a price, contact data, lead or
// row identifiers, coordinates, or the Place ID.

export type PreviewView = {
  status: "active" | "converted";
  address: {display: string; googleConfirmed: boolean};
  image: {state: "ready" | "unavailable"};
  roof:
    | {state: "ready"; squares: number; complexity: RoofComplexity}
    | {state: "pending"}
    | {state: "review_required"}
    | {state: "skipped"};
  answered: Array<"reason" | "roofAge" | "timeline">;
  savedEmail: boolean;
  campaign: string | null;
  presentationKey: string;
};

export type PreviewRow = {
  id: string;
  property_id: string;
  status: string;
  expires_at: string;
  submitted_address: string;
  canonical_address: string | null;
  address_mode: string;
  latitude: number | null;
  longitude: number | null;
  measurement_status: string;
  reveal_mode: string;
  roof_insight_id: string | null;
  responses: unknown;
  saved_email: string | null;
  campaign: string | null;
  presentation_key: string;
};

export type PreviewReadDependencies = {
  loadPreviewRow(scope: {companyId: string; tokenHash: string}): Promise<PreviewRow | null>;
  // The insight was linked by the measurement worker for this company's
  // canonical address. It may belong to an earlier property row for the same
  // address, so it is bound by company and id, not by the preview's property.
  loadRoofInsight(input: {companyId: string; roofInsightId: string}): Promise<{
    totalRoofSqft: number;
    roofSegments: Array<{pitchDegrees: number; azimuthDegrees: number; areaSqft: number}>;
  } | null>;
  now?: () => Date;
};

const ANSWER_KEYS = ["reason", "roofAge", "timeline"] as const;

export async function loadPreviewView(
  scope: {companyId: string; tokenHash: string},
  dependencies: PreviewReadDependencies,
): Promise<PreviewView | null> {
  const row = await dependencies.loadPreviewRow(scope);
  const now = (dependencies.now ?? (() => new Date()))();
  if (!row || (row.status !== "active" && row.status !== "converted")) return null;
  if (row.status === "active" && new Date(row.expires_at) <= now) return null;

  let roof: PreviewView["roof"];
  switch (row.measurement_status) {
    case "pending":
      roof = {state: "pending"};
      break;
    case "skipped":
      roof = {state: "skipped"};
      break;
    case "ready": {
      const insight = row.roof_insight_id
        ? await dependencies.loadRoofInsight({
            companyId: scope.companyId,
            roofInsightId: row.roof_insight_id,
          })
        : null;
      roof = insight && insight.totalRoofSqft > 0
        ? {state: "ready", ...summarizeRoofForPreview(insight)}
        : {state: "review_required"};
      break;
    }
    default:
      roof = {state: "review_required"};
  }

  const responses = row.responses && typeof row.responses === "object" ? row.responses as Record<string, unknown> : {};
  const googleConfirmed = row.address_mode === "google" && row.canonical_address !== null;
  return {
    status: row.status as PreviewView["status"],
    address: {display: googleConfirmed ? row.canonical_address! : row.submitted_address, googleConfirmed},
    image: {state: row.latitude !== null && row.longitude !== null ? "ready" : "unavailable"},
    roof,
    answered: ANSWER_KEYS.filter((key) => typeof responses[key] === "string"),
    savedEmail: row.saved_email !== null,
    campaign: row.campaign,
    presentationKey: row.presentation_key,
  };
}
