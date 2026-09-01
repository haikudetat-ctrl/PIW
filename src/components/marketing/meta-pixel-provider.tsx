"use client";

import {createContext, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef} from "react";
import {usePathname} from "next/navigation";
import {usePrivacyConsent} from "@/components/privacy/privacy-consent-provider";
import type {MetaBrowserEventEnvelope} from "@/modules/marketing/meta-events";

type MetaPixelContextValue = {
  trackConversion(envelope: MetaBrowserEventEnvelope | null | undefined): void;
};

type BrowserFbq = ((...arguments_: unknown[]) => void) & {
  callMethod?: (...arguments_: unknown[]) => void;
  push?: BrowserFbq;
  queue?: unknown[][];
  loaded?: boolean;
  version?: string;
};

declare global {
  interface Window {
    fbq?: BrowserFbq;
    _fbq?: BrowserFbq;
  }
}

const META_SCRIPT_SELECTOR = 'script[data-meta-pixel-script="true"]';
const MAX_EVENT_AGE_MS = 10 * 60 * 1000;
const NOOP_META_PIXEL: MetaPixelContextValue = {trackConversion: () => undefined};
const MetaPixelContext = createContext<MetaPixelContextValue>(NOOP_META_PIXEL);

function getPixelId() {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();
  return pixelId || null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isCurrentEnvelope(
  envelope: MetaBrowserEventEnvelope | null | undefined,
): envelope is MetaBrowserEventEnvelope {
  if (!envelope || !isUuid(envelope.eventId)) return false;
  if (envelope.name !== "Lead" && envelope.name !== "AssessmentCompleted") return false;
  const issuedAt = Date.parse(envelope.issuedAt);
  return !Number.isNaN(issuedAt) && Date.now() - issuedAt <= MAX_EVENT_AGE_MS;
}

function ensurePixel(): BrowserFbq {
  const existing = window.fbq;
  const fbq: BrowserFbq = existing ?? ((...arguments_: unknown[]) => {
    if (fbq.callMethod) {
      fbq.callMethod(...arguments_);
      return;
    }
    fbq.queue ??= [];
    fbq.queue.push(arguments_);
  });
  if (!existing) {
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.queue = [];
    window._fbq = fbq;
  }
  window.fbq = fbq;

  if (!document.querySelector(META_SCRIPT_SELECTOR)) {
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    script.dataset.metaPixelScript = "true";
    document.head.append(script);
  }

  return fbq;
}

function trackPageView(pixelId: string) {
  const fbq = ensurePixel();
  fbq("init", pixelId);
  fbq("track", "PageView");
}

export function useMetaPixel() {
  return useContext(MetaPixelContext);
}

export function MetaPixelProvider({children}: {children: ReactNode}) {
  const {preferences} = usePrivacyConsent();
  const pathname = usePathname();
  const previousPageViewPath = useRef<string | null>(null);
  const conversions = useRef(new Set<string>());
  const advertising = preferences.advertising === true;
  const pixelId = getPixelId();
  const advertisingRef = useRef(advertising);
  const pathnameRef = useRef(pathname);
  const pixelIdRef = useRef(pixelId);

  useLayoutEffect(() => {
    advertisingRef.current = advertising;
    pathnameRef.current = pathname;
    pixelIdRef.current = pixelId;
  }, [advertising, pathname, pixelId]);

  useEffect(() => {
    if (!advertising || !pixelId || !pathname.startsWith("/roof-estimate")) return;
    if (previousPageViewPath.current === pathname) return;
    trackPageView(pixelId);
    previousPageViewPath.current = pathname;
  }, [advertising, pathname, pixelId]);

  const trackConversion = useCallback((envelope: MetaBrowserEventEnvelope | null | undefined) => {
    const currentPixelId = pixelIdRef.current;
    if (
      !advertisingRef.current
      || !currentPixelId
      || !pathnameRef.current.startsWith("/roof-estimate")
      || !isCurrentEnvelope(envelope)
    ) return;
    if (conversions.current.has(envelope.eventId)) return;

    const fbq = ensurePixel();
    if (envelope.name === "Lead") {
      fbq("track", "Lead", {}, {eventID: envelope.eventId});
    } else {
      fbq("trackCustom", "AssessmentCompleted", {}, {eventID: envelope.eventId});
    }
    conversions.current.add(envelope.eventId);
  }, []);

  const value = useMemo(() => ({trackConversion}), [trackConversion]);

  return <MetaPixelContext.Provider value={value}>{children}</MetaPixelContext.Provider>;
}
