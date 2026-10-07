"use client";

import {useCallback, useState, type FormEvent} from "react";
import {TurnstileWidget} from "../../components/turnstile";
import {PREVIEW_ADDRESS_SUBMIT_LABEL, propertyProcessingNotice} from "../../lib/property-preview-notice";
import {AddressAutocomplete} from "./address-autocomplete";
import type {CampaignDefinition} from "./campaigns";

const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid"] as const;

function track(event: string, campaign: string) {
  window.dispatchEvent(new CustomEvent(`allseason:${event}`, {
    detail: {event, campaign, page_path: window.location.pathname},
  }));
}

// Value-first address step for campaign landing pages. Contact details are
// collected on the estimate host after the homeowner sees their roof.
export function CampaignAddressEntry({campaign, turnstileSiteKey}: {campaign: CampaignDefinition; turnstileSiteKey: string}) {
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<{placeId: string; address: string} | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const useManual = useCallback(() => setManual(true), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    let address = selected?.address ?? "";
    let googlePlaceId: string | null = selected?.placeId || null;
    if (manual) {
      const fields = Array.from(form.querySelectorAll<HTMLInputElement>("[data-manual-address]"));
      const invalid = fields.find((field) => !field.checkValidity());
      if (invalid) {
        invalid.reportValidity();
        return;
      }
      const data = new FormData(form);
      address = [data.get("address_line_1"), data.get("city"), `NJ ${data.get("postal_code")}`]
        .map((part) => String(part ?? "").trim())
        .filter(Boolean)
        .join(", ");
      googlePlaceId = null;
    } else if (!googlePlaceId) {
      setError("Choose your home from the list, or enter the address manually.");
      return;
    }
    if (!turnstileToken) {
      setError("Please complete the quick security check, then try again.");
      return;
    }

    setPending(true);
    setError("");
    track("address_submitted", campaign.slug);
    const params = new URLSearchParams(window.location.search);
    const response = await fetch("/api/property-preview", {
      method: "POST",
      headers: {"content-type": "application/json"},
      credentials: "same-origin",
      body: JSON.stringify({
        address,
        google_place_id: googlePlaceId,
        campaign: campaign.slug,
        entry_point: campaign.entryPoint,
        presentation_key: campaign.presentationKey,
        turnstile_token: turnstileToken,
        ...Object.fromEntries(ATTRIBUTION_KEYS.map((key) => [key, params.get(key)])),
      }),
    }).catch(() => null);
    const payload = response?.status === 201 ? await response.json().catch(() => null) as {previewUrl?: string} | null : null;
    if (payload?.previewUrl) {
      window.location.assign(payload.previewUrl);
      return;
    }
    setPending(false);
    setResetKey((key) => key + 1);
    setError("We couldn’t look up that address just now. Please try again or call (856) 835-6022.");
    track("address_submit_error", campaign.slug);
  }

  return (
    <form className="campaign-form" onSubmit={submit} noValidate>
      <header>
        <span className="campaign-form-label">A clear first step</span>
        <h2>{campaign.formTitle}</h2>
        <p>See your roof from above in seconds. No contact details needed to look.</p>
      </header>
      <fieldset disabled={pending}>
        <legend className="campaign-sr-only">Property address</legend>
        {!manual ? (
          <AddressAutocomplete
            onUnavailable={useManual}
            onSelect={({placeId, address}) => {
              setSelected(placeId ? {placeId, address} : null);
              if (placeId) setError("");
            }}
          />
        ) : (
          <div className="campaign-manual-grid">
            <label className="campaign-field campaign-field-wide"><span>Street address</span><input data-manual-address name="address_line_1" autoComplete="address-line1" required minLength={3} /></label>
            <label className="campaign-field campaign-field-city"><span>City</span><input data-manual-address name="city" autoComplete="address-level2" required minLength={2} /></label>
            <label className="campaign-field"><span>State</span><input value="NJ" readOnly aria-label="State" /></label>
            <label className="campaign-field"><span>ZIP code</span><input data-manual-address name="postal_code" autoComplete="postal-code" inputMode="numeric" pattern="[0-9]{5}(-[0-9]{4})?" required /></label>
          </div>
        )}
        <button className="campaign-text-action" type="button" onClick={() => { setManual((value) => !value); setSelected(null); setError(""); }}>
          {manual ? "Use Google address search" : "Can’t find it? Enter the address manually"}
        </button>
        <TurnstileWidget siteKey={turnstileSiteKey} action="property_preview" onToken={setTurnstileToken} resetKey={resetKey} />
        <p className="campaign-consent-notice" data-preview-notice>{propertyProcessingNotice()}</p>
        {error ? <p className="campaign-error" role="alert">{error}</p> : null}
        <button className="campaign-primary-action" type="submit">
          {pending ? "Finding your roof…" : PREVIEW_ADDRESS_SUBMIT_LABEL} <span aria-hidden="true">→</span>
        </button>
      </fieldset>
      <p className="campaign-fine-print">A preliminary estimate, not a contract or final quote. Your information stays with All Season and is not sold.</p>
    </form>
  );
}
