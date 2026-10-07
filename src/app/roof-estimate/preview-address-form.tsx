"use client";

import { useState, type FormEvent } from "react";
import { TurnstileWidget } from "@/components/turnstile/turnstile";
import { PREVIEW_ADDRESS_SUBMIT_LABEL, propertyProcessingNotice } from "@/modules/property-preview/notices";
import { GoogleAddressAutocomplete } from "./google-address-autocomplete";

// Value-first address step: only the address, under a property-processing
// notice. Contact details come later, after the homeowner has seen their roof.
export function PreviewAddressForm({
  browserApiKey,
  turnstileSiteKey,
  brandName,
}: {
  browserApiKey?: string;
  turnstileSiteKey: string;
  brandName: string;
}) {
  const [manual, setManual] = useState(!browserApiKey);
  const [selected, setSelected] = useState<{placeId: string; address: string} | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    let address: string;
    let googlePlaceId: string | null = null;
    if (manual) {
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      const line1 = String(data.get("addressLine1") ?? "").trim();
      const city = String(data.get("city") ?? "").trim();
      const postalCode = String(data.get("postalCode") ?? "").trim();
      address = `${line1}, ${city}, NJ ${postalCode}`;
    } else {
      if (!selected?.placeId) {
        setError("Choose your property from Google’s suggestions, or enter it manually.");
        return;
      }
      address = selected.address;
      googlePlaceId = selected.placeId;
    }
    if (!turnstileToken) {
      setError("Please complete the quick security check, then try again.");
      return;
    }

    setPending(true);
    setError(null);
    const response = await fetch("/api/property-preview", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({address, google_place_id: googlePlaceId, turnstile_token: turnstileToken}),
    }).catch(() => null);
    const payload = response?.status === 201 ? await response.json().catch(() => null) as {previewUrl?: string} | null : null;
    if (payload?.previewUrl) {
      window.location.assign(payload.previewUrl);
      return;
    }
    setPending(false);
    setResetKey((key) => key + 1);
    setError("We couldn’t look up that address just now. Please try again.");
  }

  return (
    <form onSubmit={submit} className="quiet-form" aria-label="Roof preview request" noValidate>
      {!manual && browserApiKey ? (
        <GoogleAddressAutocomplete
          apiKey={browserApiKey}
          quiet
          onLoadError={() => setManual(true)}
          onSelect={(value) => {
            setSelected(value.placeId ? value : null);
            setError(null);
          }}
        />
      ) : (
        <>
          <label className="quiet-field">Street address<input name="addressLine1" autoComplete="address-line1" required minLength={3} className="quiet-input" /></label>
          <label className="quiet-field">City<input name="city" autoComplete="address-level2" required minLength={2} className="quiet-input" /></label>
          <label className="quiet-field">ZIP code<input name="postalCode" autoComplete="postal-code" inputMode="numeric" pattern="[0-9]{5}(-[0-9]{4})?" required className="quiet-input" /></label>
        </>
      )}
      {browserApiKey ? (
        <button type="button" className="quiet-back quiet-toggle" onClick={() => { setManual((value) => !value); setError(null); }}>
          {manual ? "Use Google address search" : "Can’t find it? Enter the address manually"}
        </button>
      ) : null}
      <TurnstileWidget siteKey={turnstileSiteKey} action="property_preview" onToken={setTurnstileToken} resetKey={resetKey} />
      <p data-testid="preview-address-notice" className="quiet-notice">{propertyProcessingNotice(brandName)}</p>
      {error ? <p role="alert" className="quiet-alert">{error}</p> : null}
      <button type="submit" disabled={pending} className="quiet-submit">
        {pending ? "Finding your roof…" : PREVIEW_ADDRESS_SUBMIT_LABEL}
      </button>
    </form>
  );
}
