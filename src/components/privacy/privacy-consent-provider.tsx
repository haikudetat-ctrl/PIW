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
  consent: {
    preferences: ConsentPreferences;
    gpcDetected: boolean;
  };
};

const FAIL_MESSAGE = "We could not save your privacy choices. Please try again.";
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

function isConsentResponse(value: unknown): value is ConsentResponse {
  if (!value || typeof value !== "object" || !("consent" in value)) return false;
  const consent = (value as {consent?: unknown}).consent;
  if (
    !consent
    || typeof consent !== "object"
    || !("preferences" in consent)
    || typeof (consent as {gpcDetected?: unknown}).gpcDetected !== "boolean"
  ) return false;
  const consentRecord = consent as Record<string, unknown>;
  const preferences = consentRecord.preferences;
  const gpcDetected = consentRecord.gpcDetected as boolean;
  return Boolean(
    preferences
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
  const [preferences, setPreferences] = useState<ConsentPreferences>(
    initialConsent?.preferences ?? DEFAULT_PREFERENCES,
  );
  const [gpcDetected, setGpcDetected] = useState(
    initialConsent?.gpcDetected === true || browserGpcIsEnabled(),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState(preferences);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const closePreferences = useCallback(() => {
    setDialogOpen(false);
    returnFocusRef.current?.focus();
  }, []);

  const openPreferences = useCallback(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const detected = gpcDetected || browserGpcIsEnabled();
    setGpcDetected(detected);
    setDraft({
      necessary: true,
      analytics: preferences.analytics,
      advertising: detected ? false : preferences.advertising,
    });
    setError(null);
    setDialogOpen(true);
  }, [gpcDetected, preferences]);

  useEffect(() => {
    if (!dialogOpen) return;
    dialogRef.current
      ?.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")
      ?.focus();
  }, [dialogOpen]);

  const updatePreferences = useCallback(async (input: PrivacyConsentUpdate) => {
    const previousStatus = status;
    const advertising = gpcDetected ? false : input.advertising;
    setStatus("saving");
    setError(null);
    try {
      const response = await fetch("/api/privacy/consent", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          analytics: input.analytics,
          advertising,
          gpcDetected,
          source: input.source ?? "preferences",
        }),
      });
      if (!response.ok) throw new Error("Consent request failed");
      const payload: unknown = await response.json();
      if (!isConsentResponse(payload)) throw new Error("Consent response was invalid");
      setPreferences(payload.consent.preferences);
      setGpcDetected(payload.consent.gpcDetected === true || gpcDetected);
      setStatus("saved");
      if (dialogOpen) closePreferences();
    } catch {
      setStatus(previousStatus);
      setError(FAIL_MESSAGE);
    }
  }, [closePreferences, dialogOpen, gpcDetected, status]);

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
      {children}
      {status !== "saved" ? (
        <PrivacyConsentBanner
          error={error}
          saving={saving}
          onAcceptAll={() => void updatePreferences({
            analytics: true,
            advertising: !gpcDetected,
            source: gpcDetected ? "gpc" : "banner",
          })}
          onRejectNonessential={() => void updatePreferences({
            analytics: false,
            advertising: false,
            source: gpcDetected ? "gpc" : "banner",
          })}
          onCustomize={openPreferences}
        />
      ) : null}
      <button
        type="button"
        className="privacy-consent-reopen"
        aria-haspopup="dialog"
        onClick={openPreferences}
      >
        Privacy choices
      </button>
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
            {gpcDetected ? (
              <p className="privacy-consent-gpc" role="status">
                Global Privacy Control is enabled, so Advertising remains off.
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
                  disabled={saving || gpcDetected}
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
