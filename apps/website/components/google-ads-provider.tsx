"use client";

import {createContext, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef} from "react";
import {usePathname} from "next/navigation";
import type {GoogleAdsConfig} from "../lib/google-ads-tracking";
import {usePrivacyConsent} from "./privacy-consent-provider";

type GoogleAdsContextValue = {
  /**
   * Reports the estimate-started conversion; submissionId dedupes retries as
   * transaction_id. Resolves once the hit is sent or skipped, and never later
   * than CONVERSION_WAIT_MS, so callers can await it before navigating away.
   */
  trackEstimateConversion(submissionId: string): Promise<void>;
};

type Gtag = (...arguments_: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

const GOOGLE_SCRIPT_SELECTOR = 'script[data-google-ads-script="true"]';
const CONVERSION_WAIT_MS = 1_200;
const NOOP_GOOGLE_ADS: GoogleAdsContextValue = {trackEstimateConversion: async () => undefined};
const GoogleAdsContext = createContext<GoogleAdsContextValue>(NOOP_GOOGLE_ADS);

const GRANTED = {ad_storage: "granted", ad_user_data: "granted", ad_personalization: "denied"} as const;
const DENIED = {ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied"} as const;

function browserGpcIsEnabled() {
  return typeof navigator !== "undefined"
    && (navigator as Navigator & {globalPrivacyControl?: boolean}).globalPrivacyControl === true;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Installs gtag with consent defaulted to denied, then grants ad storage. The
 * script is only ever requested after advertising consent is authorized, so
 * the denied default matters for a later revocation, not for first load.
 */
function ensureGtag(tagId: string): Gtag {
  if (!window.gtag) {
    window.dataLayer = window.dataLayer ?? [];
    window.gtag = function gtag() {
      // gtag.js reads the arguments object itself, not an array copy.
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag("consent", "default", DENIED);
    window.gtag("js", new Date());
  }
  window.gtag("consent", "update", GRANTED);

  if (!document.querySelector(GOOGLE_SCRIPT_SELECTOR)) {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tagId)}`;
    script.dataset.googleAdsScript = "true";
    document.head.append(script);
  }
  return window.gtag;
}

export function useGoogleAds() {
  return useContext(GoogleAdsContext);
}

export function GoogleAdsProvider({children, config}: {children: ReactNode; config: GoogleAdsConfig | null}) {
  const {preferences, authorizeAdvertising} = usePrivacyConsent();
  const pathname = usePathname();
  const advertising = preferences.advertising === true && !browserGpcIsEnabled();
  const previousPageViewPath = useRef<string | null>(null);
  const conversions = useRef(new Set<string>());
  const advertisingRef = useRef(advertising);
  const configRef = useRef(config);
  const pathnameRef = useRef(pathname);
  const authorityEpoch = useRef(0);
  const tagId = config?.tagId ?? null;

  useLayoutEffect(() => {
    advertisingRef.current = advertising;
    configRef.current = config;
    pathnameRef.current = pathname;
    authorityEpoch.current += 1;
    if ((!advertising || !config) && window.gtag) window.gtag("consent", "update", DENIED);
  }, [advertising, config, pathname]);

  useEffect(() => {
    if (!tagId || !advertising) return;
    if (previousPageViewPath.current === pathname) return;
    const epoch = authorityEpoch.current;
    void authorizeAdvertising().then((allowed) => {
      if (!allowed || epoch !== authorityEpoch.current || pathnameRef.current !== pathname) return;
      // config records the page view and stores the landing gclid in the
      // first-party _gcl_aw cookie so a later conversion can be attributed.
      ensureGtag(tagId)("config", tagId);
      previousPageViewPath.current = pathname;
    });
  }, [advertising, authorizeAdvertising, pathname, tagId]);

  const trackEstimateConversion = useCallback(async (submissionId: string) => {
    const current = configRef.current;
    if (!current || !advertisingRef.current || browserGpcIsEnabled() || !isUuid(submissionId)) return;
    if (conversions.current.has(submissionId)) return;

    const epoch = authorityEpoch.current;
    const sent = authorizeAdvertising().then((allowed) => new Promise<void>((resolve) => {
      if (!allowed || epoch !== authorityEpoch.current || !advertisingRef.current || browserGpcIsEnabled()) {
        resolve();
        return;
      }
      if (conversions.current.has(submissionId)) {
        resolve();
        return;
      }
      conversions.current.add(submissionId);
      ensureGtag(current.tagId)("event", "conversion", {
        send_to: `${current.tagId}/${current.leadConversionLabel}`,
        transaction_id: submissionId,
        event_callback: () => resolve(),
      });
    }));
    await Promise.race([
      sent.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, CONVERSION_WAIT_MS)),
    ]);
  }, [authorizeAdvertising]);

  const value = useMemo(() => ({trackEstimateConversion}), [trackEstimateConversion]);

  return <GoogleAdsContext.Provider value={value}>{children}</GoogleAdsContext.Provider>;
}
