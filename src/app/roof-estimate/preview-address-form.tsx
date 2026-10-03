"use client";

import { useState, type FormEvent } from "react";
import { inputClasses, labelClasses, primaryButtonClasses } from "@/components/ui/form";
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
    <form onSubmit={submit} className="grid gap-5" aria-label="Roof preview request" noValidate>
      <div className="grid gap-2">
        <h2 className="text-lg font-semibold text-ink">Where is the roof?</h2>
        <p className="text-sm leading-6 text-ink-muted">Enter the New Jersey address. You’ll see the roof from above in seconds.</p>
      </div>
      {!manual && browserApiKey ? (
        <GoogleAddressAutocomplete
          apiKey={browserApiKey}
          onLoadError={() => setManual(true)}
          onSelect={(value) => {
            setSelected(value.placeId ? value : null);
            setError(null);
          }}
        />
      ) : (
        <div className="grid gap-4">
          <label className={labelClasses}>Street address<input name="addressLine1" autoComplete="address-line1" required minLength={3} className={inputClasses} /></label>
          <label className={labelClasses}>City<input name="city" autoComplete="address-level2" required minLength={2} className={inputClasses} /></label>
          <label className={labelClasses}>ZIP code<input name="postalCode" autoComplete="postal-code" inputMode="numeric" pattern="[0-9]{5}(-[0-9]{4})?" required className={inputClasses} /></label>
        </div>
      )}
      {browserApiKey ? (
        <button type="button" className="w-fit text-sm font-semibold text-accent underline underline-offset-4" onClick={() => { setManual((value) => !value); setError(null); }}>
          {manual ? "Use Google address search" : "Can’t find it? Enter the address manually"}
        </button>
      ) : null}
      <TurnstileWidget siteKey={turnstileSiteKey} action="property_preview" onToken={setTurnstileToken} resetKey={resetKey} />
      <p data-testid="preview-address-notice" className="text-xs leading-5 text-ink-muted">{propertyProcessingNotice(brandName)}</p>
      {error ? <p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">{error}</p> : null}
      <button type="submit" disabled={pending} className={`${primaryButtonClasses} min-h-11`}>
        {pending ? "Finding your roof…" : PREVIEW_ADDRESS_SUBMIT_LABEL}
      </button>
    </form>
  );
}
