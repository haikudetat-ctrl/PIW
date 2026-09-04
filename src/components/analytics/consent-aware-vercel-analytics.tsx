"use client";

import {useEffect} from "react";
import {Analytics, type BeforeSend} from "@vercel/analytics/next";
import {usePrivacyConsent} from "@/components/privacy/privacy-consent-provider";

const allowEvent: BeforeSend = (event) => event;
const blockEvent: BeforeSend = () => null;

function ActivatedVercelAnalytics() {
  useEffect(() => {
    return () => window.va?.("beforeSend", blockEvent);
  }, []);

  return <Analytics beforeSend={allowEvent} />;
}

export function ConsentAwareVercelAnalytics() {
  const {preferences} = usePrivacyConsent();
  return preferences.analytics ? <ActivatedVercelAnalytics /> : null;
}
