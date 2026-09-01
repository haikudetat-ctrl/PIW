"use client";

import {FormEvent, useCallback, useState} from "react";
import {AddressAutocomplete} from "./address-autocomplete";
import {buildCampaignSubmission, type CampaignDefinition} from "./campaigns";
import {useMetaPixel, type MetaBrowserEventEnvelope} from "../../components/meta-pixel-provider";

function track(event: string, campaign: string) {
  const detail = {event, campaign, page_path: window.location.pathname};
  window.dispatchEvent(new CustomEvent(`allseason:${event}`, {detail}));
  const dataLayer = (window as Window & {dataLayer?: unknown[]}).dataLayer;
  if (Array.isArray(dataLayer)) dataLayer.push(detail);
}

export function CampaignEstimateForm({campaign}: {campaign: CampaignDefinition}) {
  const {trackConversion} = useMetaPixel();
  const [step, setStep] = useState<1 | 2>(1);
  const [manual, setManual] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [googlePlaceId, setGooglePlaceId] = useState("");
  const [addressError, setAddressError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [submissionId] = useState(() => globalThis.crypto.randomUUID());
  const useManual = useCallback(() => {
    setManual(true);
    setAddressError("");
  }, []);

  function continueToContact(form: HTMLFormElement) {
    if (!manual && !googlePlaceId) {
      setAddressError("Choose your home from the list, or enter the address manually.");
      return;
    }
    if (manual) {
      const required = Array.from(form.querySelectorAll<HTMLInputElement>("[data-manual-address]"));
      const invalid = required.find((field) => !field.checkValidity());
      if (invalid) {
        invalid.reportValidity();
        return;
      }
    }
    setAddressError("");
    setStep(2);
    track("campaign_form_contact_step", campaign.slug);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !event.currentTarget.reportValidity()) return;
    setPending(true);
    setStatus("Securely starting your roof estimate…");
    track("campaign_form_submit", campaign.slug);
    try {
      const response = await fetch("/api/campaign-estimate", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(buildCampaignSubmission({
          campaign: campaign.slug,
          submissionId,
          form: new FormData(event.currentTarget),
          selectedAddress,
          googlePlaceId,
          search: window.location.search,
        })),
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => ({})) as {
        estimateUrl?: string;
        error?: string;
        metaEvent?: MetaBrowserEventEnvelope | null;
      };
      if (!response.ok || !payload.estimateUrl) throw new Error(payload.error ?? "Submission failed");
      if (payload.metaEvent) trackConversion(payload.metaEvent);
      track("campaign_form_success", campaign.slug);
      window.location.assign(payload.estimateUrl);
    } catch {
      setStatus("We could not start the estimate. Try again or call (888) 832-5050.");
      track("campaign_form_error", campaign.slug);
      setPending(false);
    }
  }

  return (
    <form className="campaign-form" onSubmit={submit} noValidate>
      <header>
        <span className="campaign-form-label">A clear first step</span>
        <h2>{campaign.formTitle}</h2>
        <p>{campaign.formIntro}</p>
      </header>

      <div className="campaign-step-meter" aria-label={`Step ${step} of 2`}>
        <span data-active={step === 1}>Your home</span>
        <span data-active={step === 2}>Your details</span>
      </div>

      <fieldset hidden={step !== 1} disabled={pending}>
        <legend className="campaign-sr-only">Property address</legend>
        {!manual ? (
          <AddressAutocomplete
            onUnavailable={useManual}
            onSelect={({placeId, address}) => {
              setGooglePlaceId(placeId);
              setSelectedAddress(address);
              if (placeId) setAddressError("");
            }}
          />
        ) : (
          <div className="campaign-manual-grid">
            <label className="campaign-field campaign-field-wide"><span>Street address</span><input data-manual-address name="address_line_1" autoComplete="address-line1" required /></label>
            <label className="campaign-field campaign-field-wide"><span>Apartment, suite, or unit <i>optional</i></span><input name="address_line_2" autoComplete="address-line2" /></label>
            <label className="campaign-field campaign-field-city"><span>City</span><input data-manual-address name="city" autoComplete="address-level2" required /></label>
            <label className="campaign-field"><span>State</span><input value="NJ" readOnly aria-label="State" /></label>
            <label className="campaign-field"><span>ZIP code</span><input data-manual-address name="postal_code" autoComplete="postal-code" inputMode="numeric" pattern="[0-9]{5}(-[0-9]{4})?" required /></label>
          </div>
        )}
        {addressError ? <p className="campaign-error" role="alert">{addressError}</p> : null}
        <button className="campaign-text-action" type="button" onClick={() => {
          setManual((value) => !value);
          setAddressError("");
          setGooglePlaceId("");
          setSelectedAddress("");
        }}>
          {manual ? "Use Google address search" : "Can’t find it? Enter the address manually"}
        </button>
        <button className="campaign-primary-action" type="button" onClick={(event) => continueToContact(event.currentTarget.form!)}>
          Continue to your details <span aria-hidden="true">→</span>
        </button>
      </fieldset>

      <fieldset hidden={step !== 2} disabled={pending}>
        <legend className="campaign-sr-only">Contact details</legend>
        <label className="campaign-field"><span>Full name</span><input name="name" autoComplete="name" required /></label>
        <label className="campaign-field"><span>Email</span><input name="email" type="email" inputMode="email" autoComplete="email" required /></label>
        <label className="campaign-field"><span>Mobile phone</span><input name="phone" type="tel" inputMode="tel" autoComplete="tel" required /></label>
        <div className="campaign-consents">
          <label><input name="consent_to_process_property" type="checkbox" required /><span>I authorize All Season to review this address using property records, maps, and imagery to prepare my estimate.</span></label>
          <label><input name="consent_to_contact" type="checkbox" required /><span>I agree to be contacted by All Season by call, text, or email about this request, including by automated means. Consent is not required to purchase.</span></label>
        </div>
        <div className="campaign-form-actions">
          <button className="campaign-text-action" type="button" onClick={() => setStep(1)}>← Back</button>
          <button className="campaign-primary-action" type="submit" disabled={pending}>
            {pending ? "Starting your estimate…" : campaign.submitLabel}
          </button>
        </div>
      </fieldset>
      <p className="campaign-status" role="status" aria-live="polite">{status}</p>
      <p className="campaign-fine-print">This is a preliminary estimate, not a contract or final quote. Your information stays with All Season and is not sold.</p>
    </form>
  );
}
