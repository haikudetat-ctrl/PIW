import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/lib/database.types";
import {
  runPostConsentPropertyPrefetch,
  type PostConsentPropertyPrefetchDependencies,
} from "../post-consent-property-prefetch";
import {SupabasePropertyPrefetchRepository} from "../supabase-property-prefetch-repository";

type TestEnvironment = Record<string, string | undefined>;
type DiagnosticEvent = {
  event: "assessment_context" | "place_details_called";
  sequence: number;
  recordedAtMs: number;
  entryPoint?: "roof-estimate";
  presentationKey?: "all-season-main";
};

declare global {
  var __roofAssessmentFakePlaceDetailsEvents: DiagnosticEvent[] | undefined;
}

function events() {
  globalThis.__roofAssessmentFakePlaceDetailsEvents ??= [];
  return globalThis.__roofAssessmentFakePlaceDetailsEvents;
}

export function isFakePlaceDetailsTestMode(environment: TestEnvironment) {
  return environment.NODE_ENV !== "production"
    && ["test", "development"].includes(environment.NODE_ENV ?? "")
    && environment.DEPLOYMENT_ENV === "development"
    && environment.ROOF_ASSESSMENT_TEST_FAKE_PLACE_DETAILS_ENABLED === "true";
}

export function readFakePlaceDetailsDiagnostics() {
  return {events: [...events()]};
}

export function resetFakePlaceDetailsDiagnostics() {
  globalThis.__roofAssessmentFakePlaceDetailsEvents = [];
}

export function recordFakeAssessmentContext(
  environment: TestEnvironment,
  input: {entryPoint: string; presentationKey: string},
) {
  if (!isFakePlaceDetailsTestMode(environment)) return;
  if (input.entryPoint !== "roof-estimate" || input.presentationKey !== "all-season-main") return;
  const diagnosticEvents = events();
  diagnosticEvents.push({
    event: "assessment_context",
    sequence: diagnosticEvents.length + 1,
    recordedAtMs: Date.now(),
    entryPoint: input.entryPoint,
    presentationKey: input.presentationKey,
  });
}

export function createFakePlaceDetailsPrefetch(
  environment: TestEnvironment,
  client: SupabaseClient<Database>,
  logCompletion?: PostConsentPropertyPrefetchDependencies["logCompletion"],
) {
  if (!isFakePlaceDetailsTestMode(environment)) return undefined;
  return (input: Parameters<typeof runPostConsentPropertyPrefetch>[0]) => (
    runPostConsentPropertyPrefetch(input, {
      enabled: true,
      repository: new SupabasePropertyPrefetchRepository(client),
      fetchGooglePlaceDetails: async ({submittedAddress, googlePlaceId}) => {
        const diagnosticEvents = events();
        diagnosticEvents.push({
          event: "place_details_called",
          sequence: diagnosticEvents.length + 1,
          recordedAtMs: Date.now(),
        });
        return {
          submittedAddress,
          googlePlaceId,
          canonicalAddress: "18 HARBOR VIEW DR, RED BANK, NJ 07701",
          latitude: 40.3501,
          longitude: -74.0642,
          municipality: "RED BANK",
          county: "MONMOUTH",
          stateCode: "NJ" as const,
          zip: "07701",
          matchMethod: "exact_single_match" as const,
          confidence: 98,
        };
      },
      logCompletion,
    })
  );
}
