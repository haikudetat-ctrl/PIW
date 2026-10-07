"use client";

import {useState} from "react";
import {getRoofAssessmentContext} from "@/config/roof-assessment";
import type {PreviewView} from "@/modules/property-preview/preview-read-model";
import {createPreviewAerialLoader} from "../dev-assessment/assessment-sandbox";
import {PreviewExperience} from "../p/[token]/preview-experience";
import {QuietEstimateView} from "../[token]/quiet-estimate-view";
import {QuoteLoadingView} from "../[token]/quote-loading-view";
import {QuietAddressStep} from "../quiet-address-step";

export type SandboxScreen = "preview" | "address" | "loading" | "price" | "review";

const ESTIMATE_TOKEN = "dev-estimate";
const BRAND = {
  name: "All Season Solar",
  logoUrl: "/brand/all-season-mark.svg",
  phoneDisplay: "(856) 835-6022",
  phoneHref: "tel:+18568356022",
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
