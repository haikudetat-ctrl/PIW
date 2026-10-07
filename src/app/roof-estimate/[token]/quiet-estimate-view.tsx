import { QuietHeader } from "../quiet/quiet-header";
import type { QuietBrand } from "../quiet/quiet-brand";
import { PropertySatelliteImage } from "./property-satellite-image";
import "../quiet/quiet.css";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export type QuietEstimateState =
  | {kind: "ready"; lowCents: number; highCents: number; roofSquares: number}
  | {kind: "review"}
  | {kind: "received"};

// Price-first result for homeowners who came through the value-first preview,
// in the same white, thin-type, hairline style as the preview itself.
export function QuietEstimateView({
  token,
  address,
  brand,
  state,
}: {
  token: string;
  address: string;
  brand: QuietBrand;
  state: QuietEstimateState;
}) {
  const refine = (
    <a href={`/roof-estimate/${token}?refine=1`} className="quiet-secondary quiet-cta quiet-link-button">
      Refine your estimate with 6 quick questions
    </a>
  );

  return (
    <main className="quiet-flow">
      <div className="quiet-frame quiet-frame-wide">
        <QuietHeader brandName={brand.name} logoUrl={brand.logoUrl} />
        <section className="quiet-body quiet-reveal">
          <figure className="quiet-aerial-figure">
            <div className="quiet-aerial">
              <PropertySatelliteImage src={`/api/roof-estimate/${token}/house-image`} address={address} />
            </div>
            <figcaption className="quiet-caption">
              <span>{address}</span>
              <span translate="no">Satellite imagery from Google Maps</span>
            </figcaption>
          </figure>

          <div className="quiet-reveal-copy">
            {state.kind === "ready" ? (
              <>
                <p className="quiet-step">Preliminary roof estimate</p>
                <h1 className="quiet-question">Your range is ready.</h1>
                <p className="quiet-price">
                  {money.format(state.lowCents / 100)} <span>to</span> {money.format(state.highCents / 100)}
                </p>
                <p className="quiet-lede">
                  Based on approximately {state.roofSquares.toFixed(1)} roofing squares and current New Jersey architectural-shingle averages.
                </p>
                <dl className="quiet-facts">
                  <div className="quiet-fact">
                    <dt>Measured roof</dt>
                    <dd>{state.roofSquares.toFixed(1)} squares</dd>
                  </div>
                  <div className="quiet-fact">
                    <dt>Pricing market</dt>
                    <dd>New Jersey</dd>
                  </div>
                </dl>
                <a href={brand.phoneHref} className="quiet-submit quiet-cta quiet-link-button">
                  Talk with a roofing specialist
                </a>
                {refine}
                <p className="quiet-notice quiet-fine">
                  Preliminary sales estimate only. Decking, tear-off layers, access, permits, and field conditions can change the final proposal.
                </p>
              </>
            ) : state.kind === "review" ? (
              <>
                <p className="quiet-step">Professional review</p>
                <h1 className="quiet-question">We are checking the property match.</h1>
                <p className="quiet-lede">
                  Google did not return a measurement we trust enough to price automatically. Your request is saved for a roofing professional.
                </p>
                <ol className="quiet-stages">
                  <li className="quiet-stage" data-active="true"><span>Confirming the property</span><span>…</span></li>
                  <li className="quiet-stage"><span>Preparing your estimate</span><span /></li>
                  <li className="quiet-stage"><span>Sent by text and email</span><span /></li>
                </ol>
                <a href={brand.phoneHref} className="quiet-submit quiet-cta quiet-link-button">
                  Call {brand.phoneDisplay}
                </a>
              </>
            ) : (
              <>
                <p className="quiet-step">Request received</p>
                <h1 className="quiet-question">Your request is with our team.</h1>
                <p className="quiet-lede">
                  We could not create a reliable instant range. A roofing professional can review the property and follow up.
                </p>
                {refine}
                <a href={brand.phoneHref} className="quiet-back quiet-inline-link">
                  Questions? Call {brand.phoneDisplay}
                </a>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
