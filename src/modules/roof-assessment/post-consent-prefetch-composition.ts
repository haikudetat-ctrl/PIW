import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/lib/database.types";
import {fetchGooglePlaceDetails} from "@/modules/providers/adapters/google-places";
import {
  buildAssessmentPrefetchPathLog,
  createAssessmentJourneyCorrelation,
} from "./analysis-telemetry";
import {
  runPostConsentPropertyPrefetch,
  type PostConsentPropertyPrefetchDependencies,
  type PostConsentPropertyPrefetchInput,
  type PropertyPrefetchRepository,
} from "./post-consent-property-prefetch";
import {SupabasePropertyPrefetchRepository} from "./supabase-property-prefetch-repository";
import {createFakePlaceDetailsPrefetch} from "./testing/fake-place-details";

type PrefetchEnvironment = {
  ROOF_ASSESSMENT_PROPERTY_PREFETCH_ENABLED: boolean;
  GOOGLE_MAPS_API_KEY?: string;
};

type FakeTestEnvironment = Record<string, string | undefined>;

type Completion = Parameters<
  NonNullable<PostConsentPropertyPrefetchDependencies["logCompletion"]>
>[0];

type PostConsentPrefetch = (
  input: PostConsentPropertyPrefetchInput,
) => ReturnType<typeof runPostConsentPropertyPrefetch>;

type CompositionDependencies = {
  createRepository(client: SupabaseClient<Database>): PropertyPrefetchRepository;
  createFakePrefetch(
    environment: FakeTestEnvironment,
    client: SupabaseClient<Database>,
    logCompletion: (completion: Completion) => void,
  ): PostConsentPrefetch | undefined;
  fetchGooglePlaceDetails(input: {
    submittedAddress: string;
    googlePlaceId: string;
    signal: AbortSignal;
    apiKey: string;
  }): Promise<unknown>;
  logInfo(label: string, record: unknown): void;
};

const defaultDependencies: CompositionDependencies = {
  createRepository: (client) => new SupabasePropertyPrefetchRepository(client),
  createFakePrefetch: (environment, client, logCompletion) => (
    createFakePlaceDetailsPrefetch(environment, client, logCompletion)
  ),
  fetchGooglePlaceDetails,
  logInfo: (label, record) => console.info(label, record),
};

export function createPostConsentPrefetchComposition(
  input: {
    environment: PrefetchEnvironment;
    client: SupabaseClient<Database>;
    companyId: string;
    submissionId: string;
    googlePlaceId?: string;
    signingSecret: string;
    testEnvironment: FakeTestEnvironment;
  },
  dependencyOverrides: Partial<CompositionDependencies> = {},
) {
  const dependencies = {...defaultDependencies, ...dependencyOverrides};
  const correlation = createAssessmentJourneyCorrelation(
    input.companyId,
    input.submissionId,
    input.signingSecret,
  );
  const completionBuffer: Completion[] = [];
  let accepted = false;
  let flushed = false;
  const safeLog = (label: string, record: unknown) => {
    try {
      dependencies.logInfo(label, record);
    } catch {
      // Operational telemetry must never alter intake or navigation.
    }
  };
  const logCompletion = (completion: Completion) => {
    if (!accepted) {
      completionBuffer.push(completion);
      return;
    }
    safeLog("roof_assessment_property_prefetch", {correlation, ...completion});
  };

  const selectedPlace = Boolean(input.googlePlaceId?.trim());
  const fakePrefetch = selectedPlace
    ? dependencies.createFakePrefetch(input.testEnvironment, input.client, logCompletion)
    : undefined;
  const realPrefetch = selectedPlace
    && !fakePrefetch
    && input.environment.ROOF_ASSESSMENT_PROPERTY_PREFETCH_ENABLED
    && input.environment.GOOGLE_MAPS_API_KEY
    ? (prefetchInput: PostConsentPropertyPrefetchInput) => runPostConsentPropertyPrefetch(
      prefetchInput,
      {
        enabled: true,
        repository: dependencies.createRepository(input.client),
        fetchGooglePlaceDetails: (details) => dependencies.fetchGooglePlaceDetails({
          ...details,
          apiKey: input.environment.GOOGLE_MAPS_API_KEY as string,
        }),
        logCompletion,
      },
    )
    : undefined;
  const postConsentPrefetch = fakePrefetch ?? realPrefetch;
  const pathOutcome = !selectedPlace
    ? "async_manual"
    : postConsentPrefetch ? "prefetch_candidate" : "async_google_flag_off";

  return {
    postConsentPrefetch,
    markAccepted() {
      if (flushed) return;
      accepted = true;
      flushed = true;
      safeLog("roof_assessment_prefetch_path", buildAssessmentPrefetchPathLog({
        correlation,
        outcome: pathOutcome,
      }));
      for (const completion of completionBuffer.splice(0)) {
        safeLog("roof_assessment_property_prefetch", {correlation, ...completion});
      }
    },
  };
}
