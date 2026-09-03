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
  authorizeAdvertising(): Promise<boolean>;
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
  const initialConsentId = initialConsent?.consentId ?? null;
  const initialPolicyVersion = initialConsent?.policyVersion ?? null;
  const [status, setStatus] = useState<ConsentStatus>(initialConsent ? "saved" : "unset");
  const [storedPreferences, setStoredPreferences] = useState<ConsentPreferences>(
    initialConsent?.preferences ?? DEFAULT_PREFERENCES,
  );
  // A PIW-origin cookie proves its identity but not that its Advertising
  // decision is still current after a website-side update. Do not expose a
  // stored grant until the same-origin status endpoint resolves it.
  const [canonicalReady, setCanonicalReady] = useState(initialConsentId === null);
  const browserGpcDetected = useSyncExternalStore(
    subscribeToBrowserGpc,
    browserGpcIsEnabled,
    serverGpcIsDisabled,
  );
  // Historical GPC evidence keeps its recorded denial, but only the live
  // browser signal disables a later explicit choice.
  const gpcDefaultActive = browserGpcDetected;
  const preferences: ConsentPreferences = browserGpcDetected || !canonicalReady
    ? {...storedPreferences, advertising: false}
    : storedPreferences;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState(preferences);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const gpcSyncAttemptedRef = useRef(false);
  const canonicalResolutionRef = useRef(0);
  const authorizationResolutionRef = useRef(0);
  const consentIdentityRef = useRef(initialConsentId && initialPolicyVersion
    ? {consentId: initialConsentId, policyVersion: initialPolicyVersion}
    : null);

  const authorizeAdvertising = useCallback(async () => {
    const authorization = ++authorizationResolutionRef.current;
    const choiceResolution = canonicalResolutionRef.current;
    const identity = consentIdentityRef.current;
    if (!identity || browserGpcIsEnabled()) return false;
    try {
      const response = await fetch("/api/privacy/consent", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Consent status request failed");
      const payload: unknown = await response.json();
      if (!isConsentResponse(payload)
        || payload.consent.consentId !== identity.consentId
        || payload.consent.policyVersion !== identity.policyVersion) {
        throw new Error("Divergent consent status response");
      }
      if (authorization !== authorizationResolutionRef.current
        || choiceResolution !== canonicalResolutionRef.current) return false;
      setStoredPreferences(payload.consent.preferences);
      setCanonicalReady(true);
      return payload.consent.preferences.advertising && !payload.consent.gpcDetected;
    } catch {
      if (authorization === authorizationResolutionRef.current
        && choiceResolution === canonicalResolutionRef.current) setCanonicalReady(false);
      return false;
    }
  }, []);

  const closePreferences = useCallback(() => {
    setDialogOpen(false);
    returnFocusRef.current?.focus();
  }, []);

  function openPreferences() {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
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
    const resolution = ++canonicalResolutionRef.current;
    authorizationResolutionRef.current += 1;
    const previousStatus = status;
    const backgroundGpcSync = input.source === "gpc" && previousStatus === "saved";
    const requestGpcDetected = gpcDefaultActive;
    const advertising = requestGpcDetected ? false : input.advertising;
    if (!backgroundGpcSync) setStatus("saving");
    setError(null);
    // A consent update starts a new authority epoch. This immediately
    // suppresses browser tracking, including a revocation in flight.
    if (!advertising) {
      setStoredPreferences({necessary: true, analytics: input.analytics, advertising: false});
    }
    setCanonicalReady(false);
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
      if (resolution !== canonicalResolutionRef.current) return;
      setStoredPreferences(payload.consent.preferences);
      consentIdentityRef.current = {
        consentId: payload.consent.consentId,
        policyVersion: payload.consent.policyVersion,
      };
      setStatus("saved");
      setCanonicalReady(true);
      if (dialogOpen) closePreferences();
    } catch {
      if (resolution === canonicalResolutionRef.current) {
        setStatus(previousStatus);
        setError(FAIL_MESSAGE);
      }
    }
  }, [closePreferences, dialogOpen, gpcDefaultActive, status]);

  useEffect(() => {
    if (!initialConsentId || !initialPolicyVersion) return;
    const resolution = ++canonicalResolutionRef.current;
    const authorization = ++authorizationResolutionRef.current;
    let active = true;

    void (async () => {
      try {
        const response = await fetch("/api/privacy/consent", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: browserGpcDetected ? {"x-all-season-gpc": "1"} : undefined,
        });
        if (!response.ok) throw new Error("Consent status request failed");
        const payload: unknown = await response.json();
        if (!isConsentResponse(payload)) throw new Error("Consent status response was invalid");
        if (
          payload.consent.consentId !== initialConsentId
          || payload.consent.policyVersion !== initialPolicyVersion
        ) throw new Error("Divergent consent status response");
        if (!active
          || resolution !== canonicalResolutionRef.current
          || authorization !== authorizationResolutionRef.current) return;
        setStoredPreferences(payload.consent.preferences);
        setStatus("saved");
        setCanonicalReady(true);
      } catch {
        if (active
          && resolution === canonicalResolutionRef.current
          && authorization === authorizationResolutionRef.current) {
          setCanonicalReady(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [browserGpcDetected, initialConsentId, initialPolicyVersion]);

  // A browser-level GPC signal is immediately effective in memory and is also
  // persisted once when it supersedes an existing Advertising grant. If the
  // write fails, the request-time/server gates still fail closed.
  useEffect(() => {
    if (
      !browserGpcDetected
      || !storedPreferences.advertising
      || gpcSyncAttemptedRef.current
    ) return;
    gpcSyncAttemptedRef.current = true;
    void updatePreferences({
      analytics: storedPreferences.analytics,
      advertising: false,
      source: "gpc",
    });
  }, [browserGpcDetected, storedPreferences.advertising, storedPreferences.analytics, updatePreferences]);

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
    authorizeAdvertising,
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
      {gpcDefaultActive && !dialogOpen ? (
        <p className="privacy-consent-gpc-notice" role="status">
          Global Privacy Control was detected, so Advertising remains off while it is active.
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
                Global Privacy Control is active, so Advertising remains off while it is active.
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
                  disabled={saving || gpcDefaultActive}
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
