"use client";

import {useEffect} from "react";
import {usePrivacyConsent} from "./privacy-consent-provider";

export function ConsentAwarePostHog() {
  const {preferences} = usePrivacyConsent();

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("allseason:privacy-consent", {
      detail: {analytics: preferences.analytics},
    }));
  }, [preferences.analytics]);

  return null;
}
