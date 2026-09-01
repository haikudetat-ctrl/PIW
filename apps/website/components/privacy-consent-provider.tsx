"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import type {
  ConsentPreferences,
  VerifiedWebsiteConsent,
} from "../lib/privacy-consent";
import {PrivacyConsentBanner} from "./privacy-consent-banner";

export type PrivacyConsentContextValue = {
  preferences: ConsentPreferences;
  decided: boolean;
  acceptAll(): Promise<void>;
  rejectNonessential(): Promise<void>;
  savePreferences(value: {analytics: boolean; advertising: boolean}): Promise<void>;
};

type PrivacyConsentProviderProps = {
  children: ReactNode;
  initialConsent: VerifiedWebsiteConsent | null;
};

const DEFAULT_PREFERENCES: ConsentPreferences = {
  necessary: true,
  analytics: false,
  advertising: false,
};
const FAIL_MESSAGE = "We could not save your privacy choices. Please try again.";

const PrivacyConsentContext = createContext<PrivacyConsentContextValue | null>(null);

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function isConsentResponse(value: unknown): value is {consent: VerifiedWebsiteConsent} {
  if (!value || typeof value !== "object" || !("consent" in value)) return false;
  const consent = (value as {consent?: unknown}).consent;
  if (!consent || typeof consent !== "object") return false;
  const candidate = consent as Record<string, unknown>;
  const preferences = candidate.preferences as Record<string, unknown> | undefined;
  return candidate.policyVersion === "piw-privacy-v1"
    && isUuid(candidate.consentId)
    && isIsoTimestamp(candidate.updatedAt)
    && typeof candidate.gpcDetected === "boolean"
    && preferences?.necessary === true
    && typeof preferences.analytics === "boolean"
    && typeof preferences.advertising === "boolean"
    && !(candidate.gpcDetected && preferences.advertising);
}

export function usePrivacyConsent() {
  const value = useContext(PrivacyConsentContext);
  if (!value) throw new Error("usePrivacyConsent must be used inside PrivacyConsentProvider");
  return value;
}

export function PrivacyConsentProvider({children, initialConsent}: PrivacyConsentProviderProps) {
  const [preferences, setPreferences] = useState<ConsentPreferences>(
    initialConsent?.preferences ?? DEFAULT_PREFERENCES,
  );
  const [decided, setDecided] = useState(Boolean(initialConsent));
  const [saving, setSaving] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState(preferences);
  const [error, setError] = useState<string | null>(null);

  const savePreferences = useCallback(async (value: {
    analytics: boolean;
    advertising: boolean;
  }) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/privacy/consent", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(value),
      });
      if (!response.ok) throw new Error("Consent request failed");
      const payload: unknown = await response.json();
      if (!isConsentResponse(payload)) throw new Error("Invalid consent response");
      setPreferences(payload.consent.preferences);
      setDecided(true);
      setCustomizing(false);
    } catch {
      setError(FAIL_MESSAGE);
    } finally {
      setSaving(false);
    }
  }, []);

  const acceptAll = useCallback(
    () => savePreferences({analytics: true, advertising: true}),
    [savePreferences],
  );
  const rejectNonessential = useCallback(
    () => savePreferences({analytics: false, advertising: false}),
    [savePreferences],
  );
  const openPreferences = useCallback(() => {
    setDraft(preferences);
    setError(null);
    setCustomizing(true);
  }, [preferences]);

  const value: PrivacyConsentContextValue = {
    preferences,
    decided,
    acceptAll,
    rejectNonessential,
    savePreferences,
  };

  return (
    <PrivacyConsentContext.Provider value={value}>
      {!decided ? (
        <PrivacyConsentBanner
          saving={saving}
          error={error}
          onAcceptAll={() => void acceptAll()}
          onRejectNonessential={() => void rejectNonessential()}
          onCustomize={openPreferences}
        />
      ) : (
        <button type="button" className="privacy-consent-reopen" onClick={openPreferences}>
          Privacy choices
        </button>
      )}
      {children}
      {customizing ? (
        <div className="privacy-consent-backdrop">
          <section role="dialog" aria-modal="true" aria-labelledby="privacy-dialog-title">
            <h2 id="privacy-dialog-title">Privacy choices</h2>
            <p>Choose which nonessential technologies we may use.</p>
            <label>
              <input type="checkbox" aria-label="Necessary" checked disabled />
              Necessary
            </label>
            <label>
              <input
                type="checkbox"
                aria-label="Analytics"
                checked={draft.analytics}
                disabled={saving}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  analytics: event.target.checked,
                }))}
              />
              Analytics
            </label>
            <label>
              <input
                type="checkbox"
                aria-label="Advertising"
                checked={draft.advertising}
                disabled={saving}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  advertising: event.target.checked,
                }))}
              />
              Advertising
            </label>
            {error ? <p role="alert">{error}</p> : null}
            <button
              type="button"
              disabled={saving}
              onClick={() => void savePreferences(draft)}
            >
              Save preferences
            </button>
            <button type="button" disabled={saving} onClick={() => setCustomizing(false)}>
              Cancel
            </button>
          </section>
        </div>
      ) : null}
    </PrivacyConsentContext.Provider>
  );
}
