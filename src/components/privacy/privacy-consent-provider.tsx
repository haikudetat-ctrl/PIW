"use client";

import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {ConsentPreferences, VerifiedConsent} from "@/modules/privacy/consent";
import {PrivacyConsentBanner} from "./privacy-consent-banner";
import "./privacy-consent.css";

type ConsentStatus = "unset" | "saving" | "saved";
type ConsentSource = "banner" | "preferences" | "gpc";

export type PrivacyConsentUpdate = {
  analytics: boolean;
  advertising: boolean;
  source?: ConsentSource;
};

export type PrivacyConsentContextValue = {
  status: ConsentStatus;
  preferences: ConsentPreferences;
  openPreferences(): void;
  updatePreferences(input: PrivacyConsentUpdate): Promise<void>;
};

type PrivacyConsentProviderProps = {
  children: ReactNode;
  initialConsent: VerifiedConsent | null;
};

type ConsentResponse = {
  consent: VerifiedConsent;
};

const FAIL_MESSAGE = "We could not save your privacy choices. Please try again.";
const POLICY_VERSION = "piw-privacy-v1";
const DEFAULT_PREFERENCES: ConsentPreferences = {
  necessary: true,
  analytics: false,
  advertising: false,
};

const PrivacyConsentContext = createContext<PrivacyConsentContextValue | null>(null);

function browserGpcIsEnabled() {
  if (typeof navigator === "undefined") return false;
  return (navigator as Navigator & {globalPrivacyControl?: boolean})
    .globalPrivacyControl === true;
}

function subscribeToBrowserGpc() {
  return () => undefined;
}

function serverGpcIsDisabled() {
  return false;
}

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

function isConsentResponse(value: unknown): value is ConsentResponse {
  if (!value || typeof value !== "object" || !("consent" in value)) return false;
  const consent = (value as {consent?: unknown}).consent;
  if (
    !consent
    || typeof consent !== "object"
    || !("preferences" in consent)
  ) return false;
  const consentRecord = consent as Record<string, unknown>;
  const preferences = consentRecord.preferences;
  const gpcDetected = consentRecord.gpcDetected;
  return Boolean(
    consentRecord.policyVersion === POLICY_VERSION
    && isUuid(consentRecord.consentId)
    && isIsoTimestamp(consentRecord.updatedAt)
    && typeof gpcDetected === "boolean"
    && preferences
    && typeof preferences === "object"
    && (preferences as ConsentPreferences).necessary === true
    && typeof (preferences as ConsentPreferences).analytics === "boolean"
    && typeof (preferences as ConsentPreferences).advertising === "boolean"
    && !(gpcDetected && (preferences as ConsentPreferences).advertising),
  );
}

export function usePrivacyConsent() {
  const value = useContext(PrivacyConsentContext);
  if (!value) throw new Error("usePrivacyConsent must be used inside PrivacyConsentProvider");
  return value;
}

export function PrivacyConsentProvider({children, initialConsent}: PrivacyConsentProviderProps) {
  const [status, setStatus] = useState<ConsentStatus>(initialConsent ? "saved" : "unset");
  const [storedPreferences, setStoredPreferences] = useState<ConsentPreferences>(
    initialConsent?.preferences ?? DEFAULT_PREFERENCES,
  );
  const [storedGpcDetected, setStoredGpcDetected] = useState(
    initialConsent?.gpcDetected === true,
  );
  const [gpcOverridden, setGpcOverridden] = useState(false);
  const [gpcExplained, setGpcExplained] = useState(false);
  const browserGpcDetected = useSyncExternalStore(
    subscribeToBrowserGpc,
    browserGpcIsEnabled,
    serverGpcIsDisabled,
  );
  const gpcDefaultActive = !gpcOverridden && (storedGpcDetected || browserGpcDetected);
  const preferences: ConsentPreferences = gpcDefaultActive
    ? {...storedPreferences, advertising: false}
    : storedPreferences;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState(preferences);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const closePreferences = useCallback(() => {
    setDialogOpen(false);
    returnFocusRef.current?.focus();
  }, []);

  function openPreferences() {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (gpcDefaultActive) setGpcExplained(true);
    setDraft({
      necessary: true,
      analytics: preferences.analytics,
      advertising: preferences.advertising,
    });
    setError(null);
    setDialogOpen(true);
  }

  useEffect(() => {
    if (!dialogOpen) return;
    dialogRef.current
      ?.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")
      ?.focus();
  }, [dialogOpen]);

  const updatePreferences = useCallback(async (input: PrivacyConsentUpdate) => {
    const previousStatus = status;
    const explicitAdvertisingGrant = gpcDefaultActive
      && gpcExplained
      && input.source === "preferences"
      && input.advertising;
    const requestGpcDetected = gpcDefaultActive && !explicitAdvertisingGrant;
    const advertising = requestGpcDetected ? false : input.advertising;
    setStatus("saving");
    setError(null);
    try {
      const response = await fetch("/api/privacy/consent", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          analytics: input.analytics,
          advertising,
          gpcDetected: requestGpcDetected,
          source: input.source ?? "preferences",
        }),
      });
      if (!response.ok) throw new Error("Consent request failed");
      const payload: unknown = await response.json();
      if (!isConsentResponse(payload)) throw new Error("Consent response was invalid");
      setStoredPreferences(payload.consent.preferences);
      setStoredGpcDetected(payload.consent.gpcDetected);
      setGpcOverridden(Boolean(
        explicitAdvertisingGrant
        && payload.consent.preferences.advertising
        && !payload.consent.gpcDetected,
      ));
      setGpcExplained(false);
      setStatus("saved");
      if (dialogOpen) closePreferences();
    } catch {
      setStatus(previousStatus);
      setError(FAIL_MESSAGE);
    }
  }, [closePreferences, dialogOpen, gpcDefaultActive, gpcExplained, status]);

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!saving) closePreferences();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      "input:not(:disabled), button:not(:disabled)",
    ) ?? []);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const value: PrivacyConsentContextValue = {
    status,
    preferences,
    openPreferences,
    updatePreferences,
  };
  const saving = status === "saving";

  return (
    <PrivacyConsentContext.Provider value={value}>
      {status !== "saved" ? (
        <PrivacyConsentBanner
          error={error}
          saving={saving}
          onAcceptAll={() => void updatePreferences({
            analytics: true,
            advertising: !gpcDefaultActive,
            source: gpcDefaultActive ? "gpc" : "banner",
          })}
          onRejectNonessential={() => void updatePreferences({
            analytics: false,
            advertising: false,
            source: gpcDefaultActive ? "gpc" : "banner",
          })}
          onCustomize={openPreferences}
        />
      ) : null}
      {gpcDefaultActive && storedPreferences.advertising && !dialogOpen ? (
        <p className="privacy-consent-gpc-notice" role="status">
          Global Privacy Control was detected, so Advertising is off. Open Privacy choices
          if you want to make an explicit selection.
        </p>
      ) : null}
      <button
        type="button"
        className="privacy-consent-reopen"
        aria-haspopup="dialog"
        onClick={openPreferences}
      >
        Privacy choices
      </button>
      {children}
      {dialogOpen ? (
        <div className="privacy-consent-dialog-backdrop">
          <div
            ref={dialogRef}
            className="privacy-consent-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="privacy-consent-dialog-title"
            onKeyDown={handleDialogKeyDown}
          >
            <h2 id="privacy-consent-dialog-title">Privacy choices</h2>
            <p>Choose which nonessential technologies we may use.</p>
            {gpcDefaultActive ? (
              <p className="privacy-consent-gpc" role="status">
                Global Privacy Control was detected, so Advertising started off.
                You may explicitly turn it on here.
              </p>
            ) : null}
            <div className="privacy-consent-options">
              <label>
                <input type="checkbox" aria-label="Necessary" checked disabled />
                <span><strong>Necessary</strong> — required for security, consent, and site operation.</span>
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
                <span><strong>Analytics</strong> — helps us understand site use and performance.</span>
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
                <span><strong>Advertising</strong> — helps measure and improve relevant advertising.</span>
              </label>
            </div>
            {error ? <p className="privacy-consent-error" role="alert">{error}</p> : null}
            <div className="privacy-consent-dialog__actions">
              <button
                type="button"
                disabled={saving}
                onClick={() => void updatePreferences({...draft, source: "preferences"})}
              >
                {saving ? "Saving…" : "Save preferences"}
              </button>
              <button type="button" disabled={saving} onClick={closePreferences}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </PrivacyConsentContext.Provider>
  );
}
