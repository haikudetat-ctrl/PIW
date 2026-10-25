import Image from "next/image";
import Link from "next/link";
import {CampaignAddressEntry} from "../campaigns/campaign-address-entry";
import {CampaignEstimateForm} from "../campaigns/campaign-estimate-form";
import {previewFlowEnabled} from "../../lib/property-preview-notice";
import {companyFacts, njHicRegistration} from "../../lib/company-facts";
import {GoogleRatingBadge, GoogleReviewsList} from "./google-reviews-summary";
import {
  priceExample,
  priceFactors,
  processSteps,
  SEARCH_CTA_LABEL,
  type SearchPageDefinition,
} from "./search-pages";
import "./search-landing.css";

function EstimateEntry({page}: {page: SearchPageDefinition}) {
  const context = {
    slug: page.slug,
    entryPoint: page.entryPoint,
    presentationKey: page.presentationKey,
    formTitle: page.formTitle,
  };
  if (previewFlowEnabled()) {
    return (
      <CampaignAddressEntry
        campaign={{
          ...context,
          addressStepCopy: {
            label: "Free, no obligation",
            intro: page.formIntro,
            submitLabel: SEARCH_CTA_LABEL,
            pendingLabel: "Measuring your roof…",
          },
        }}
        turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!.trim()}
      />
    );
  }
  return (
    <CampaignEstimateForm
      campaign={{...context, formIntro: page.formIntro, submitLabel: SEARCH_CTA_LABEL}}
    />
  );
}

export function SearchLandingPage({page}: {page: SearchPageDefinition}) {
  const hicRegistration = njHicRegistration();
  const {phone, experience, certification, financing, serviceArea} = companyFacts;

  return (
    <main className="sl-page" data-search-page={page.slug}>
      <header className="sl-header">
        <div className="sl-wrap sl-header-inner">
          <Link className="sl-logo" href="/" aria-label="AllSeason home">
            <Image src="/assets/all-season-logo-color.svg" alt="AllSeason Roofing and Solar" width={168} height={44} priority />
          </Link>
          <a className="sl-header-phone" href={phone.href}>
            <small>Talk to a local specialist</small>
            <strong>{phone.display}</strong>
          </a>
        </div>
      </header>

      <section className="sl-hero">
        {/* Three grid areas so phones get headline, then form, then proof. */}
        <div className="sl-wrap sl-hero-grid">
          <div className="sl-hero-copy">
            <p className="sl-eyebrow">{page.eyebrow}</p>
            <h1>{page.headline}</h1>
            <p className="sl-lede">{page.intro}</p>
          </div>
          <div className="sl-form-shell" id="estimate">
            <EstimateEntry page={page} />
          </div>
          <div className="sl-hero-proof">
            <ul className="sl-proof" aria-label="About AllSeason">
              <li><strong>{experience.headline}</strong><span>{experience.detail}</span></li>
              <li><strong>{certification.shortName}</strong><span>{certification.detail}</span></li>
              <li><strong>Financing</strong><span>through {financing.partners.join(" and ")}</span></li>
            </ul>
            <GoogleRatingBadge />
          </div>
        </div>
      </section>

      <section className="sl-section sl-price" aria-labelledby="sl-price-heading">
        <div className="sl-wrap sl-split">
          <div>
            <p className="sl-eyebrow">Pricing</p>
            <h2 id="sl-price-heading">{page.priceHeadline}</h2>
            <p className="sl-lede">{page.priceIntro}</p>
            <div className="sl-example">
              <span>Example</span>
              <p>{priceExample.text}</p>
            </div>
          </div>
          <div>
            <h3>Where your roof lands in that range</h3>
            <ul className="sl-checks">
              {priceFactors.map((factor) => <li key={factor}>{factor}</li>)}
            </ul>
            <p className="sl-note">
              Your online estimate is a starting point, not a contract. A specialist confirms the details with you before anything is final.
            </p>
          </div>
        </div>
      </section>

      <section className="sl-section sl-steps" aria-labelledby="sl-steps-heading">
        <div className="sl-wrap">
          <p className="sl-eyebrow">How it works</p>
          <h2 id="sl-steps-heading">Three steps, and you stay in control.</h2>
          <ol>
            {processSteps.map((step, index) => (
              <li key={step.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="sl-section sl-virtual-wrap" aria-labelledby="sl-virtual-heading">
        <div className="sl-wrap">
          <div className="sl-virtual">
            <div>
              <p className="sl-eyebrow sl-eyebrow-light">No in-home sales visit required</p>
              <h2 id="sl-virtual-heading">Get your price without a salesperson in your living room.</h2>
            </div>
            <div>
              <p>
                Review your estimate with a specialist on a video call. You see your roof on screen, ask anything you want, and take your time deciding. If you would rather meet at the house, that is available too.
              </p>
              <a className="sl-button" href="#estimate">{SEARCH_CTA_LABEL}</a>
              <p className="sl-virtual-note">You can book a video time right after you see your price.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="sl-section sl-trust" aria-labelledby="sl-trust-heading">
        <div className="sl-wrap">
          <p className="sl-eyebrow">Why homeowners choose AllSeason</p>
          <h2 id="sl-trust-heading">A local team, with the details up front.</h2>
          <dl className="sl-facts">
            <div><dt>{experience.headline}</dt><dd>{experience.detail}</dd></div>
            <div><dt>{certification.name}</dt><dd>{certification.detail}</dd></div>
            <div><dt>Financing available</dt><dd>through {financing.partners.join(" and ")}, {financing.qualifier}</dd></div>
            <div><dt>{serviceArea}</dt><dd>homeowners across the state</dd></div>
          </dl>
          <GoogleReviewsList />
        </div>
      </section>

      <section className="sl-section sl-faq" aria-labelledby="sl-faq-heading">
        <div className="sl-wrap sl-faq-grid">
          <div>
            <p className="sl-eyebrow">Questions</p>
            <h2 id="sl-faq-heading">Common questions</h2>
          </div>
          <div>
            {page.faqs.map((faq) => (
              <details key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="sl-section sl-closing">
        <div className="sl-wrap">
          <h2>{page.closingHeadline}</h2>
          <p className="sl-lede">{page.closingCopy}</p>
          <div className="sl-closing-actions">
            <a className="sl-button" href="#estimate">{SEARCH_CTA_LABEL}</a>
            <a className="sl-text-link" href={phone.href}>or call {phone.display}</a>
          </div>
        </div>
      </section>

      <footer className="sl-footer">
        <div className="sl-wrap sl-footer-inner">
          <p><strong>AllSeason</strong> · Roof replacement for {serviceArea} homeowners.</p>
          {hicRegistration ? <p>NJ Home Improvement Contractor Reg. #{hicRegistration}</p> : null}
          <nav aria-label="Legal">
            <Link href="/privacy.html">Privacy</Link>
            <Link href="/terms.html">Terms</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
