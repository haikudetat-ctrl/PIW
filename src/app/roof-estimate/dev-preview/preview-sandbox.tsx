"use client";

import {useState} from "react";
import {getRoofAssessmentContext} from "@/config/roof-assessment";
import type {PreviewView} from "@/modules/property-preview/preview-read-model";
import {createPreviewAerialLoader} from "../dev-assessment/assessment-sandbox";
import {PreviewExperience} from "../p/[token]/preview-experience";
import {QuietEstimateView} from "../[token]/quiet-estimate-view";
import {QuoteLoadingView} from "../[token]/quote-loading-view";
import {QuietAddressStep} from "../quiet-address-step";
import {QuoteChat} from "../chat/[token]/quote-chat";
import type {ChatApi} from "../chat/[token]/chat-api";
import type {DaySlots} from "@/modules/booking/slots";
import {roofAssessmentQuestionSteps} from "@/domain/roof-assessment";
import {FastQuote} from "../[token]/fast-quote";
import type {AssessmentSnapshot, FastQuoteApi} from "../[token]/fast-quote-api";

export type SandboxScreen = "preview" | "address" | "loading" | "price" | "review" | "chat" | "fast" | "fast-pending" | "contact";

const ESTIMATE_TOKEN = "dev-estimate";
const BRAND = {
  name: "All Season Solar",
  logoUrl: "/brand/all-season-mark.svg",
  logoOnDarkUrl: "/brand/all-season-logo-on-dark.svg",
  phoneDisplay: "(866) 835-6022",
  phoneHref: "tel:+18668356022",
};

const TOKEN = "dev-preview";
// Neutral stand-in for the Google aerial; real imagery needs the preview API.
const AERIAL_FIXTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">'
  + '<rect width="800" height="600" fill="#e6e6e6"/>'
  + '<text x="400" y="306" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" '
  + 'font-size="22" fill="#8c8c8c">Aerial imagery placeholder</text></svg>',
)}`;

const VIEW: PreviewView = {
  status: "active",
  address: {display: "18 Harbor View Drive, Red Bank, NJ 07701", googleConfirmed: true},
  image: {state: "ready"},
  roof: {state: "ready", squares: 28, complexity: "moderate"},
  answered: [],
  savedEmail: false,
  campaign: null,
  presentationKey: "all-season-main",
  // Fixed placeholder for the local sandbox.
  metaEventId: "00000000-0000-4000-8000-000000000000",
};

// Development-only walkthrough of the value-first preview: simulated preview
// data, a local aerial fixture, and stubbed /api/property-preview calls.
function installSandboxFetch() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (target.includes(`/api/roof-estimate/${ESTIMATE_TOKEN}/house-image`)) {
      return new Response(decodeURIComponent(AERIAL_FIXTURE.slice(AERIAL_FIXTURE.indexOf(",") + 1)), {
        headers: {"content-type": "image/svg+xml"},
      });
    }
    if (target.includes("/api/property-preview/address-suggestions")) {
      const query = new URL(target, window.location.origin).searchParams.get("q") ?? "";
      return Response.json({suggestions: [
        {placeId: "dev-place-1", address: `${query} Harbor View Drive, Red Bank, NJ 07701, USA`},
        {placeId: "dev-place-2", address: `${query} Harbor Road, Rumson, NJ 07760, USA`},
      ]});
    }
    if (!target.includes(`/api/property-preview/${TOKEN}`)) return originalFetch(input, init);
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    if (target.endsWith("/convert")) return new Response(null, {status: 503});
    if (target.endsWith(`/${TOKEN}`)) return Response.json(VIEW);
    return new Response(null, {status: 204});
  };
}

const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function sandboxDays(): DaySlots[] {
  const days: DaySlots[] = [];
  const start = new Date();
  for (let offset = 1; days.length < 8; offset += 1) {
    const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + offset));
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const date = day.toISOString().slice(0, 10) as DaySlots["date"];
    days.push({
      date,
      weekday,
      // 10:00, 11:30, 2:00 and 3:30 Eastern (EDT).
      slots: [600, 690, 840, 930].map((minuteOfDay) => ({
        minuteOfDay,
        startsAt: new Date(`${date}T00:00:00.000Z`).getTime() + (minuteOfDay + 240) * 60_000,
      })).map(({minuteOfDay, startsAt}) => ({minuteOfDay, startsAt: new Date(startsAt).toISOString()})),
    });
  }
  return days;
}

// Development-only stand-in for every endpoint the quote chat calls.
const SANDBOX_CHAT_API: ChatApi = {
  loadPreview: async () => VIEW,
  answer: () => undefined,
  beacon: () => undefined,
  convert: async () => {
    await pause(700);
    return {kind: "accepted", continuationPath: "/roof-estimate/continue/dev", metaEvent: null};
  },
  continueToEstimate: async () => ({kind: "estimate", estimateToken: ESTIMATE_TOKEN}),
  loadEstimate: async () => {
    await pause(1200);
    return {pending: false, state: {kind: "ready", lowCents: 1_400_000, highCents: 2_100_000, roofSquares: 28}, address: VIEW.address.display};
  },
  bookingLink: async () => "dev-link.signature",
  bookingOverview: async () => ({
    kind: "open",
    firstName: "Jordan",
    inviteEmail: "j•••@example.com",
    supportPhone: BRAND.phoneDisplay,
    meetingTitle: "Roof consultation",
    durationMinutes: 30,
    timezone: "America/New_York",
    days: sandboxDays(),
    booking: null,
  }),
  book: async (_token, {startsAt}) => {
    await pause(800);
    return {
      kind: "booked",
      booking: {
        appointmentId: "00000000-0000-4000-8000-000000000001",
        startsAt,
        endsAt: new Date(new Date(startsAt).getTime() + 30 * 60_000).toISOString(),
        durationMinutes: 30,
        meetingUrl: null,
        calendarReady: false,
        inviteEmail: "j•••@example.com",
        canChange: true,
      },
    };
  },
  requestCallback: async () => {
    await pause(500);
    return true;
  },
};

// AllSeason's live tier names and per-square rates, on a 28-square roof.
const SANDBOX_TIERS = [
  {tierKey: "good", customerName: "Complete System", warrantySummary: "Enhanced manufacturer protection.", rangeLowCents: 2_240_000, rangeHighCents: 2_730_000, recommended: false},
  {tierKey: "better", customerName: "Recommended", warrantySummary: "Extended non-prorated material and workmanship coverage.", rangeLowCents: 2_660_000, rangeHighCents: 3_360_000, recommended: true},
  {tierKey: "best", customerName: "Signature System", warrantySummary: "Extended workmanship coverage with premium detailing.", rangeLowCents: 3_500_000, rangeHighCents: 4_620_000, recommended: false},
];
const SANDBOX_READY = {
  pending: false,
  state: {kind: "ready" as const, lowCents: 2_660_000, highCents: 3_360_000, roofSquares: 28, packages: SANDBOX_TIERS},
};

// Development-only assessment with the server's ordering rules, seeded the way
// a value-first conversion leaves it.
function sandboxFastApi(pricingDelayMs: number): FastQuoteApi {
  const assessment: AssessmentSnapshot = {
    revision: 1,
    status: "in_progress",
    currentStep: 2,
    responses: {reason: "roof_age", roofAge: "15_20", timeline: "this_season"},
  };
  const startedAt = Date.now();
  const copy = () => ({...assessment, responses: {...assessment.responses}});
  return {
    loadEstimate: async () => ({
      ...(Date.now() - startedAt < pricingDelayMs ? {pending: true, state: {kind: "received" as const}} : SANDBOX_READY),
      address: VIEW.address.display,
    }),
    bookingLink: SANDBOX_CHAT_API.bookingLink,
    bookingOverview: SANDBOX_CHAT_API.bookingOverview,
    book: SANDBOX_CHAT_API.book,
    requestCallback: SANDBOX_CHAT_API.requestCallback,
    saveOwnership: async (_token, ownership) => {
      assessment.responses = {...assessment.responses, ownership};
      assessment.revision += 1;
      return true;
    },
    loadAssessment: async () => copy(),
    saveAnswer: async (_token, {questionId, responsePatch, complete}) => {
      await pause(250);
      const index = roofAssessmentQuestionSteps.findIndex((step) => step.id === questionId);
      assessment.responses = {...assessment.responses, ...responsePatch};
      assessment.currentStep = Math.max(assessment.currentStep, index + 1);
      assessment.revision += 1;
      if (complete) assessment.status = "completed";
      return {kind: "saved", assessment: copy()};
    },
  };
}

export function PreviewSandbox({screen = "preview"}: {screen?: SandboxScreen}) {
  // Install the stub once, before the flow's first request.
  useState(() => {
    if (typeof window !== "undefined") installSandboxFetch();
  });

  const [fastApi] = useState(() => sandboxFastApi(screen === "fast-pending" ? 6_000 : 0));
  const address = VIEW.address.display;
  if (screen === "fast" || screen === "fast-pending") {
    return (
      <FastQuote
        token={ESTIMATE_TOKEN}
        address={address}
        brand={BRAND}
        initial={screen === "fast" ? SANDBOX_READY : {pending: true, state: {kind: "received"}}}
        animate
        bookingAvailable
        api={fastApi}
      />
    );
  }
  if (screen === "address") {
    return <QuietAddressStep brandName={BRAND.name} logoUrl={BRAND.logoUrl} logoOnDarkUrl={BRAND.logoOnDarkUrl} turnstileSiteKey="1x00000000000000000000AA" />;
  }
  if (screen === "loading") return <QuoteLoadingView brand={BRAND} address={address} />;
  if (screen === "chat") {
    return (
      <QuoteChat
        token={TOKEN}
        initialView={VIEW}
        brand={BRAND}
        privacyUrl="#privacy"
        bookingAvailable
        api={SANDBOX_CHAT_API}
        aerialLoader={async ({signal}) => createPreviewAerialLoader("ready")({imageSrc: AERIAL_FIXTURE, signal})}
      />
    );
  }
  if (screen === "price" || screen === "review") {
    return (
      <QuietEstimateView
        token={ESTIMATE_TOKEN}
        address={address}
        brand={BRAND}
        state={screen === "price" ? {kind: "ready", lowCents: 1_400_000, highCents: 2_100_000, roofSquares: 28} : {kind: "review"}}
      />
    );
  }
  return (
    <PreviewExperience
      straightToContact={screen === "contact"}
      token={TOKEN}
      initialView={VIEW}
      context={getRoofAssessmentContext(VIEW.presentationKey)}
      brandName={BRAND.name}
      logoUrl={BRAND.logoUrl}
      logoOnDarkUrl={BRAND.logoOnDarkUrl}
      privacyUrl="#privacy"
      aerialLoader={async ({signal}) =>
        createPreviewAerialLoader("ready")({imageSrc: AERIAL_FIXTURE, signal})}
    />
  );
}
