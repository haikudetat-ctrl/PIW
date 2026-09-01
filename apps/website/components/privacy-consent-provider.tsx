"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const reopenButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusAfterDialogCloseRef = useRef(true);
  const focusPrivacyControlAfterSaveRef = useRef(false);

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
      restoreFocusAfterDialogCloseRef.current = false;
      focusPrivacyControlAfterSaveRef.current = true;
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
    restoreFocusAfterDialogCloseRef.current = true;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setDraft(preferences);
    setError(null);
    setCustomizing(true);
  }, [preferences]);

  useEffect(() => {
    if (!customizing) return;

    const dialog = dialogRef.current;
    document.documentElement.classList.add("privacy-consent-modal-open");
    const focusDialog = window.requestAnimationFrame(() => {
      const firstControl = dialog?.querySelector<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), a[href]',
      );
      (firstControl ?? dialog)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setCustomizing(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(focusDialog);
      document.removeEventListener("keydown", onKeyDown);
      document.documentElement.classList.remove("privacy-consent-modal-open");
      const previousFocus = previousFocusRef.current;
      if (restoreFocusAfterDialogCloseRef.current && previousFocus?.isConnected) {
        previousFocus.focus();
      }
      previousFocusRef.current = null;
      restoreFocusAfterDialogCloseRef.current = true;
    };
  }, [customizing]);

  useEffect(() => {
    if (!focusPrivacyControlAfterSaveRef.current || !decided || customizing) return;
    focusPrivacyControlAfterSaveRef.current = false;
    const privacyChoices = reopenButtonRef.current;
    if (privacyChoices?.isConnected) privacyChoices.focus();
  }, [customizing, decided]);

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
        <button
          ref={reopenButtonRef}
          type="button"
          className="privacy-consent-reopen"
          onClick={openPreferences}
        >
          Privacy choices
        </button>
      )}
      {children}
      {customizing ? (
        <div
          className="privacy-consent-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCustomizing(false);
          }}
        >
          <section
            ref={dialogRef}
            className="privacy-consent-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="privacy-dialog-title"
            aria-describedby="privacy-dialog-description"
            tabIndex={-1}
          >
            <p className="privacy-consent-dialog-kicker">Privacy controls</p>
            <h2 id="privacy-dialog-title">Privacy choices</h2>
            <p id="privacy-dialog-description">Choose which nonessential technologies we may use.</p>
            <label className="privacy-consent-choice">
              <input type="checkbox" aria-label="Necessary" checked disabled />
              <span>Necessary</span>
            </label>
            <label className="privacy-consent-choice">
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
              <span>Analytics</span>
            </label>
            <label className="privacy-consent-choice">
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
              <span>Advertising</span>
            </label>
            {error ? <p role="alert">{error}</p> : null}
            <div className="privacy-consent-dialog-actions">
              <button
                type="button"
                className="privacy-consent-primary"
                disabled={saving}
                onClick={() => void savePreferences(draft)}
              >
                Save preferences
              </button>
              <button type="button" className="privacy-consent-secondary" disabled={saving} onClick={() => setCustomizing(false)}>
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </PrivacyConsentContext.Provider>
  );
}
