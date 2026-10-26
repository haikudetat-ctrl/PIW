"use client";

import {useEffect, useRef} from "react";
import {usePathname} from "next/navigation";
import {usePrivacyConsent} from "./privacy-consent-provider";
import {
  advertisingStorageAllowed,
  googleConsentState,
  type GoogleTagConfiguration,
} from "../lib/google-tag";

type Gtag = (...arguments_: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

const GOOGLE_TAG_SELECTOR = 'script[data-google-tag-script="true"]';

function browserGpcIsEnabled() {
  return typeof navigator !== "undefined"
    && (navigator as Navigator & {globalPrivacyControl?: boolean}).globalPrivacyControl === true;
}

function ensureGtag(): Gtag {
  window.dataLayer ??= [];
  if (!window.gtag) {
    // gtag.js reads the arguments object itself, so this must stay a classic function.
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
  }
  return window.gtag;
}

function loadGoogleTag(tagId: string) {
  if (document.querySelector(GOOGLE_TAG_SELECTOR)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tagId)}`;
  script.dataset.googleTagScript = "true";
  document.head.append(script);
}

/**
 * Consent-gated Google tag with Consent Mode v2.
 *
 * Basic mode under opt-in: nothing from Google loads until Advertising is
 * granted (and confirmed with the canonical consent record). Under opt-out the
 * tag loads unless the visitor declines or sends Global Privacy Control.
 * Lead conversions are never sent from here; PIW uploads them server side.
 */
export function GoogleTagProvider({configuration}: {configuration: GoogleTagConfiguration | null}) {
  const {preferences, decided, authorizeAdvertising} = usePrivacyConsent();
  const pathname = usePathname();
  const initialized = useRef(false);
  const lastPageView = useRef<string | null>(null);
  const allowed = configuration
    ? advertisingStorageAllowed({
      model: configuration.consentModel,
      decided,
      advertising: preferences.advertising === true,
      gpc: browserGpcIsEnabled(),
    })
    : false;

  // Revocation always wins, immediately and without waiting on the network.
  useEffect(() => {
    if (!configuration || allowed || !initialized.current || !window.gtag) return;
    window.gtag("consent", "update", googleConsentState({advertising: false, analytics: false}));
  }, [allowed, configuration]);

  useEffect(() => {
    if (!configuration || !allowed) return;
    let cancelled = false;
    const confirm = configuration.consentModel === "opt_in" ? authorizeAdvertising() : Promise.resolve(true);
    void confirm.then((confirmed) => {
      if (cancelled || !confirmed || browserGpcIsEnabled()) return;
      const gtag = ensureGtag();
      const consent = googleConsentState({advertising: true, analytics: preferences.analytics === true});
      if (!initialized.current) {
        gtag("consent", "default", {...googleConsentState({advertising: false, analytics: false}), wait_for_update: 500});
        gtag("consent", "update", consent);
        gtag("js", new Date());
        gtag("config", configuration.tagId, {
          allow_ad_personalization_signals: false,
          send_page_view: false,
        });
        if (configuration.callConversion) {
          // Google's website call conversions: swaps the displayed number for a
          // Google forwarding number for visitors who arrived from an ad.
          gtag("config", `${configuration.tagId}/${configuration.callConversion.label}`, {
            phone_conversion_number: configuration.callConversion.phoneNumber,
          });
        }
        loadGoogleTag(configuration.tagId);
        initialized.current = true;
      } else {
        gtag("consent", "update", consent);
      }
      if (lastPageView.current !== pathname) {
        gtag("event", "page_view", {page_path: pathname});
        lastPageView.current = pathname;
      }
    });
    return () => { cancelled = true; };
  }, [allowed, authorizeAdvertising, configuration, pathname, preferences.analytics]);

  return null;
}
