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

export type SandboxScreen = "preview" | "address" | "loading" | "price" | "review" | "chat";

const ESTIMATE_TOKEN = "dev-estimate";
const BRAND = {
  name: "All Season Solar",
  logoUrl: "/brand/all-season-mark.svg",
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

export function PreviewSandbox({screen = "preview"}: {screen?: SandboxScreen}) {
  // Install the stub once, before the flow's first request.
  useState(() => {
    if (typeof window !== "undefined") installSandboxFetch();
  });

  const address = VIEW.address.display;
  if (screen === "address") {
    return <QuietAddressStep brandName={BRAND.name} logoUrl={BRAND.logoUrl} turnstileSiteKey="1x00000000000000000000AA" />;
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
      token={TOKEN}
      initialView={VIEW}
      context={getRoofAssessmentContext(VIEW.presentationKey)}
      brandName={BRAND.name}
      logoUrl="/brand/all-season-mark.svg"
      privacyUrl="#privacy"
      aerialLoader={async ({signal}) =>
        createPreviewAerialLoader("ready")({imageSrc: AERIAL_FIXTURE, signal})}
    />
  );
}
