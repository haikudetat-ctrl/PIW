import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {createClient} from "@supabase/supabase-js";
import {describe, expect, test} from "vitest";
import type {Database} from "@/lib/database.types";
import {
  completePublicAssessment,
  getPublicAssessment,
  savePublicAssessmentProgress,
} from "@/modules/roof-assessment/public-assessment";
import {SupabasePublicAssessmentRepository} from "@/modules/roof-assessment/supabase-public-assessment-repository";
import {
  checkResumeVerification,
  startResumeVerification,
  type ResumeVerificationDependencies,
} from "@/modules/roof-assessment/resume-verification";
import {requestRoofConsultation, SupabaseAssessmentResultRepository} from "@/modules/roof-assessment/request-consultation";
import {SupabaseAssessmentIntakeRepository} from "@/modules/roof-assessment/supabase-assessment-intake-repository";
import {startOrResumeRoofAssessment, type StartAssessmentInput} from "@/modules/roof-assessment/start-or-resume";
import {getAssessmentCalculationState} from "@/app/roof-estimate/[token]/public-estimate-flow";
import {
  runAddressValidation,
  SupabaseAddressValidationWorkerRepository,
} from "@/inngest/functions/address-validation-worker";
import {SupabaseRoofEstimateWorkerRepository} from "@/inngest/functions/roof-estimate-worker";
import {runPostConsentPropertyPrefetch} from "@/modules/roof-assessment/post-consent-property-prefetch";
import {SupabasePropertyPrefetchRepository} from "@/modules/roof-assessment/supabase-property-prefetch-repository";

const runIntegration = process.env.RUN_SUPABASE_INTEGRATION === "1";

type CapturedContinuation = {attemptId: string; secret: string; expiresAt: string};

function intake(companyId: string, submissionId: string): StartAssessmentInput {
  return {
    submissionId,
    companyId,
    name: "Jordan Homeowner",
    email: "jordan@example.com",
    phone: "609-555-0139",
    submittedAddress: "18 Harbor View Drive, Red Bank, NJ 07701",
    googlePlaceId: "ChIJ-task-nine-property",
    campaign: null,
    presentationKey: "all-season-main",
    entryPoint: "main-home",
    attribution: {
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_term: null,
      utm_content: null,
      fbclid: null,
      fbp: null,
      fbc: null,
    },
    referrer: null,
    consent: {
      disclosureVersion: "roof-estimate-v1",
      ipAddress: "127.0.0.1",
      userAgent: "canonical-assessment-integration",
      grantedAt: new Date().toISOString(),
    },
  };
}

describe.runIf(runIntegration)("canonical assessment journey", () => {
  test("intake, both resume paths, progressive completion, result states, and consultation stay canonical", async () => {
    const localStatus = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], {
      cwd: process.cwd(),
      encoding: "utf8",
    })) as {API_URL: string; SERVICE_ROLE_KEY: string};
    const service = createClient<Database>(localStatus.API_URL, localStatus.SERVICE_ROLE_KEY, {
      auth: {persistSession: false, autoRefreshToken: false},
    });
    const companyId = crypto.randomUUID();
    const intakeRepository = new SupabaseAssessmentIntakeRepository(service);
    const publicRepository = new SupabasePublicAssessmentRepository(service);
    const resultRepository = new SupabaseAssessmentResultRepository(service);
    const propertyPrefetchRepository = new SupabasePropertyPrefetchRepository(service);
    let placeDetailsCalls = 0;
    let captured: CapturedContinuation | null = null;
    const start = (submissionId: string) => startOrResumeRoofAssessment(
      intake(companyId, submissionId),
      {
        repository: intakeRepository,
        tokenIssuer: {
          issue: async (capability) => {
            captured = capability;
            return "integration_continuation";
          },
        },
        postConsentPrefetch: (prefetchInput) => runPostConsentPropertyPrefetch(
          prefetchInput,
          {
            enabled: true,
            repository: propertyPrefetchRepository,
            fetchGooglePlaceDetails: async ({submittedAddress, googlePlaceId, signal}) => {
              expect(signal).toBeInstanceOf(AbortSignal);
              expect(googlePlaceId).toBe("ChIJ-task-nine-property");
              placeDetailsCalls += 1;
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
          },
        ),
      },
    );
    const takeCaptured = () => {
      const value = captured as CapturedContinuation | null;
      if (!value) throw new Error("Continuation issuer was not called");
      return value;
    };

    const requireRpc = async <T,>(operation: PromiseLike<{data: T; error: {message: string} | null}>): Promise<NonNullable<T>> => {
      const result = await operation;
      if (result.error) throw new Error(result.error.message);
      return result.data as NonNullable<T>;
    };

    await requireRpc(service.from("companies").insert({id: companyId, name: "Canonical journey integration"}));

    const firstSubmissionId = crypto.randomUUID();
    await expect(start(firstSubmissionId)).resolves.toEqual({
      kind: "continue",
      continuationPath: "/roof-estimate/continue/integration_continuation",
    });
    const firstCapability = takeCaptured();

    await expect(start(firstSubmissionId)).resolves.toEqual({kind: "duplicate_requires_restart"});

    const firstAttempt = await requireRpc(
      service.from("roof_assessment_access_attempts")
        .select("assessment_id, estimate_id")
        .eq("id", firstCapability!.attemptId)
        .single(),
    );
    const firstEstimate = await requireRpc(
      service.from("roof_estimates")
        .select("public_token, lead_id, property_id")
        .eq("id", firstAttempt.estimate_id)
        .single(),
    );
    const originalPublicToken = firstEstimate.public_token;

    expect(placeDetailsCalls).toBe(1);
    const pipeline = await requireRpc(service.from("pipeline_runs")
      .select("id")
      .eq("lead_id", firstEstimate.lead_id)
      .eq("property_id", firstEstimate.property_id)
      .order("started_at", {ascending: false})
      .limit(1)
      .single());
    const imageCoordinates = await requireRpc(service.from("property_addresses")
      .select("canonical_address, latitude, longitude")
      .eq("company_id", companyId)
      .eq("property_id", firstEstimate.property_id)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("created_at", {ascending: false})
      .limit(1)
      .single());
    expect(imageCoordinates).toEqual({
      canonical_address: "18 HARBOR VIEW DR, RED BANK, NJ 07701",
      latitude: 40.3501,
      longitude: -74.0642,
    });

    const discoveryEvents = await requireRpc(service.from("domain_events")
      .select("id, pipeline_run_id, correlation_id, payload")
      .eq("company_id", companyId)
      .eq("pipeline_run_id", pipeline.id)
      .eq("event_name", "property/discovery_requested"));
    expect(discoveryEvents).toHaveLength(1);
    const discoveryEvent = discoveryEvents[0];
    const discoveryOutbox = await requireRpc(service.from("event_outbox")
      .select("event_id")
      .eq("event_id", discoveryEvent.id));
    expect(discoveryOutbox).toEqual([{event_id: discoveryEvent.id}]);

    const addressWorker = await runAddressValidation({
      id: crypto.randomUUID(),
      pipelineRunId: pipeline.id,
      correlationId: discoveryEvent.correlation_id,
      leadId: firstEstimate.lead_id,
      propertyId: firstEstimate.property_id,
      submittedAddress: intake(companyId, firstSubmissionId).submittedAddress,
      googlePlaceId: "ChIJ-task-nine-property",
      attempt: 1,
    }, new SupabaseAddressValidationWorkerRepository(service));
    expect(addressWorker.outcome).toBe("already_prefetched");
    const addressProviderRequests = await requireRpc(service.from("provider_requests")
      .select("id")
      .eq("company_id", companyId)
      .eq("pipeline_run_id", pipeline.id)
      .eq("capability", "address.validate"));
    expect(addressProviderRequests).toHaveLength(0);
    const addressObservations = await requireRpc(service.from("property_addresses")
      .select("id")
      .eq("company_id", companyId)
      .eq("property_id", firstEstimate.property_id));
    expect(addressObservations).toHaveLength(1);
    expect(await requireRpc(service.from("domain_events")
      .select("id")
      .eq("company_id", companyId)
      .eq("pipeline_run_id", pipeline.id)
      .eq("event_name", "property/discovery_requested"))).toHaveLength(1);

    const roofWorkerRepository = new SupabaseRoofEstimateWorkerRepository(service);
    const roofWorkerIdempotencyKey = `roof-estimate-worker:${pipeline.id}:1`;
    const firstRoofWorker = await roofWorkerRepository.upsertWorkerRunQueued({
      pipelineRunId: pipeline.id,
      idempotencyKey: roofWorkerIdempotencyKey,
    });
    const replayedRoofWorker = await roofWorkerRepository.upsertWorkerRunQueued({
      pipelineRunId: pipeline.id,
      idempotencyKey: roofWorkerIdempotencyKey,
    });
    expect(replayedRoofWorker.id).toBe(firstRoofWorker.id);
    const roofWorkers = await requireRpc(service.from("worker_runs")
      .select("id")
      .eq("pipeline_run_id", pipeline.id)
      .eq("worker_type", "roof_estimate")
      .eq("idempotency_key", roofWorkerIdempotencyKey));
    expect(roofWorkers).toEqual([{id: firstRoofWorker.id}]);

    captured = null;
    await expect(start(crypto.randomUUID())).resolves.toMatchObject({kind: "continue"});
    const browserResume = takeCaptured();
    const browserHash = createHash("sha256").update(browserResume!.secret).digest("hex");
    const sameBrowserRows = await requireRpc(service.rpc("authorize_same_browser_roof_assessment_resume", {
      p_company_id: companyId,
      p_attempt_id: browserResume!.attemptId,
      p_assessment_id: firstAttempt.assessment_id,
      p_continuation_secret_hash: `\\x${browserHash}`,
    }));
    expect(sameBrowserRows).toHaveLength(1);
    expect(sameBrowserRows[0].assessment_id).toBe(firstAttempt.assessment_id);
    expect(sameBrowserRows[0].public_token).not.toBe(originalPublicToken);

    captured = null;
    await start(crypto.randomUUID());
    const crossDeviceResume = takeCaptured();
    const providerAttemptId = `VE${"a".repeat(32)}`;
    const verificationDependencies: ResumeVerificationDependencies = {
      provider: {
        start: async ({to}) => {
          expect(to).toBe("+16095550139");
          return {providerAttemptId, status: "pending"};
        },
        check: async ({code, providerAttemptId: checkedId}) => ({
          approved: code === "424242" && checkedId === providerAttemptId,
          ...(code === "424242" ? {providerAttemptId: checkedId} : {}),
        } as {approved: false} | {approved: true; providerAttemptId: string}),
      },
      repository: {
        reserveStart: async ({attemptId, requestIp}) => {
          const rows = await requireRpc(service.rpc("reserve_roof_assessment_verification_start", {
            p_attempt_id: attemptId,
            p_request_ip: requestIp,
          }));
          const row = rows[0];
          return {reservationId: row.reservation_id, companyId: row.company_id, to: row.destination_phone_e164};
        },
        recordProviderStart: async (input) => {
          await requireRpc(service.rpc("record_roof_assessment_verification_start", {
            p_company_id: input.companyId,
            p_attempt_id: input.attemptId,
            p_reservation_id: input.reservationId,
            p_provider_attempt_id: input.providerAttemptId,
          }));
        },
        findCheckContext: async (attemptId) => {
          const row = await requireRpc(service.from("roof_assessment_access_attempts")
            .select("company_id, destination_phone_e164, provider_attempt_id")
            .eq("id", attemptId).single());
          return {companyId: row.company_id, to: row.destination_phone_e164, providerAttemptId: row.provider_attempt_id};
        },
        approve: async (input) => {
          const rows = await requireRpc(service.rpc("approve_verified_roof_assessment_resume", {
            p_company_id: input.companyId,
            p_attempt_id: input.attemptId,
            p_provider_attempt_id: input.providerAttemptId,
          }));
          return {assessmentId: rows[0].assessment_id, publicToken: rows[0].public_token};
        },
      },
    };
    await expect(startResumeVerification({
      attemptId: crossDeviceResume!.attemptId,
      requestIp: "198.51.100.29",
    }, verificationDependencies)).resolves.toEqual({sent: true});
    const verified = await checkResumeVerification({
      attemptId: crossDeviceResume!.attemptId,
      code: "424242",
    }, verificationDependencies);
    expect(verified).toMatchObject({approved: true, assessmentId: firstAttempt.assessment_id});
    if (!verified.approved) throw new Error("Expected approved fake-provider resume");

    let progress = await getPublicAssessment(verified.publicToken, publicRepository);
    progress = await savePublicAssessmentProgress(verified.publicToken, {
      expectedRevision: progress.revision,
      questionId: null,
      propertyRevealed: true,
      responsePatch: {},
    }, publicRepository);
    progress = await savePublicAssessmentProgress(verified.publicToken, {
      expectedRevision: progress.revision,
      questionId: "reason",
      responsePatch: {reason: "known_replacement"},
    }, publicRepository);
    progress = await savePublicAssessmentProgress(verified.publicToken, {
      expectedRevision: progress.revision,
      questionId: "roofAge",
      responsePatch: {roofAge: "20_plus"},
    }, publicRepository);
    expect(progress).toMatchObject({currentStep: 2, responses: {reason: "known_replacement", roofAge: "20_plus"}});

    const staleAt = new Date(Date.now() - 49 * 60 * 60 * 1_000).toISOString();
    await requireRpc(service.from("roof_assessments").update({
      last_answered_at: staleAt,
      updated_at: staleAt,
    }).eq("id", firstAttempt.assessment_id));
    await requireRpc(service.rpc("abandon_inactive_roof_assessments", {p_batch_size: 100}));
    expect((await getPublicAssessment(verified.publicToken, publicRepository)).status).toBe("abandoned");

    captured = null;
    await start(crypto.randomUUID());
    const abandonedResume = takeCaptured();
    const abandonedHash = createHash("sha256").update(abandonedResume!.secret).digest("hex");
    const resumedRows = await requireRpc(service.rpc("authorize_same_browser_roof_assessment_resume", {
      p_company_id: companyId,
      p_attempt_id: abandonedResume!.attemptId,
      p_assessment_id: firstAttempt.assessment_id,
      p_continuation_secret_hash: `\\x${abandonedHash}`,
    }));
    const resumedToken = resumedRows[0].public_token;
    progress = await getPublicAssessment(resumedToken, publicRepository);
    expect(progress).toMatchObject({status: "in_progress", currentStep: 2, responses: {roofAge: "20_plus"}});

    const remaining = [
      ["conditionSignals", {conditionSignals: ["curling_or_cracking", "missing_shingles"]}],
      ["roofVisibility", {roofVisible: "yes", visibleCondition: "heavy_wear"}],
      ["stories", {stories: "two"}],
      ["complexityFeatures", {complexityFeatures: ["multiple_levels"]}],
      ["priority", {priority: "long_warranty"}],
      ["timeline", {timeline: "this_season"}],
    ] as const;
    for (const [questionId, responsePatch] of remaining) {
      progress = await savePublicAssessmentProgress(resumedToken, {
        expectedRevision: progress.revision,
        questionId,
        responsePatch,
      }, publicRepository);
    }
    const completed = await completePublicAssessment(resumedToken, {
      expectedRevision: progress.revision,
      responsePatch: {ownership: "owner"},
    }, publicRepository);
    expect(completed).toMatchObject({status: "completed", recommendation: "replacement_may_make_sense"});

    const estimateContext = await requireRpc(service.from("roof_estimates")
      .select("id, property_id, lead_id")
      .eq("public_token", resumedToken).single());
    const resultPipeline = await requireRpc(service.from("pipeline_runs")
      .select("id").eq("lead_id", estimateContext.lead_id).order("started_at", {ascending: false}).limit(1).single());
    const insightId = crypto.randomUUID();
    await requireRpc(service.from("roof_insights").insert({
      id: insightId,
      company_id: companyId,
      property_id: estimateContext.property_id,
      provider: "google_solar",
      normalized_address: `task-nine-${insightId}`,
      lookup_status: "success",
      total_roof_sqft: 2300,
    }));
    await requireRpc(service.from("pipeline_runs").update({status: "complete"}).eq("id", resultPipeline.id));
    await requireRpc(service.from("roof_estimates").update({
      status: "ready",
      roof_insight_id: insightId,
      roof_squares: 23,
      range_low_cents: 1_800_000,
      range_high_cents: 2_600_000,
    }).eq("id", estimateContext.id));
    const insight = {id: insightId, companyId, propertyId: estimateContext.property_id, provider: "google_solar", lookupStatus: "success"};
    expect(getAssessmentCalculationState({
      estimateStatus: "ready", pipelineStatus: "complete", expectedCompanyId: companyId,
      expectedPropertyId: estimateContext.property_id, insight, lowCents: 1_800_000,
      highCents: 2_600_000, roofSquares: 23, generatedAt: new Date().toISOString(),
    }).status).toBe("ready");
    expect(getAssessmentCalculationState({
      estimateStatus: "pending", pipelineStatus: "processing", expectedCompanyId: companyId,
      expectedPropertyId: estimateContext.property_id, insight: null, lowCents: null,
      highCents: null, roofSquares: null, generatedAt: new Date().toISOString(),
    })).toEqual({status: "pending"});
    expect(getAssessmentCalculationState({
      estimateStatus: "review_required", pipelineStatus: "review_required", expectedCompanyId: companyId,
      expectedPropertyId: estimateContext.property_id, insight: null, lowCents: null,
      highCents: null, roofSquares: null, generatedAt: new Date().toISOString(),
    }).status).toBe("review_required");

    const preference = {contactMethod: "call", callWindow: "midday"} as const;
    const firstConsultation = await requestRoofConsultation(resumedToken, preference, "203.0.113.9", resultRepository);
    const retryConsultation = await requestRoofConsultation(resumedToken, preference, "203.0.113.9", resultRepository);
    expect(retryConsultation).toEqual(firstConsultation);
    const {count, error: countError} = await service.from("consultation_requests")
      .select("id", {count: "exact", head: true}).eq("assessment_id", firstAttempt.assessment_id);
    if (countError) throw new Error(countError.message);
    expect(count).toBe(1);
    expect(placeDetailsCalls).toBe(1);
  }, 30_000);
});
