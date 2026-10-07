"use client";

import {useState} from "react";
import {getRoofAssessmentContext} from "@/config/roof-assessment";
import type {PreviewView} from "@/modules/property-preview/preview-read-model";
import {createPreviewAerialLoader} from "../dev-assessment/assessment-sandbox";
import {PreviewExperience} from "../p/[token]/preview-experience";

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
    if (!target.includes(`/api/property-preview/${TOKEN}`)) return originalFetch(input, init);
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    if (target.endsWith("/convert")) return new Response(null, {status: 503});
    if (target.endsWith(`/${TOKEN}`)) return Response.json(VIEW);
    return new Response(null, {status: 204});
  };
}

export function PreviewSandbox() {
  // Install the stub once, before the flow's first request.
  useState(() => {
    if (typeof window !== "undefined") installSandboxFetch();
  });

  return (
    <PreviewExperience
      token={TOKEN}
      initialView={VIEW}
      context={getRoofAssessmentContext(VIEW.presentationKey)}
      brandName="AllSeason Solar & Roofing"
      logoUrl="/brand/all-season-mark.svg"
      privacyUrl="#privacy"
      aerialLoader={async ({signal}) =>
        createPreviewAerialLoader("ready")({imageSrc: AERIAL_FIXTURE, signal})}
    />
  );
}
