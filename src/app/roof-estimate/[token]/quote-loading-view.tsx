import { QuietHeader } from "../quiet/quiet-header";
import type { QuietBrand } from "../quiet/quiet-brand";
import "../quiet/quiet.css";

const STAGES = [
  {label: "Address secured", status: "Done"},
  {label: "Roof measurement", status: "…"},
  {label: "Estimate range", status: ""},
] as const;
const ACTIVE_STAGE = 1;

// Shown after contact details are submitted while the measurement and price
// finish. The page refreshes itself (EstimateStatusRefresh) when they land.
export function QuoteLoadingView({
  brand,
  address,
}: {
  brand: QuietBrand;
  address: string;
}) {
  return (
    <main className="quiet-flow">
      <div className="quiet-frame">
        <QuietHeader brandName={brand.name} logoUrl={brand.logoUrl} />
        <section className="quiet-body" aria-live="polite">
          <p className="quiet-step">Measurement in progress</p>
          <h1 className="quiet-question">Preparing your estimate.</h1>
          <p className="quiet-lede">
            We are matching {address} and checking the roof surface. Your range is also sent by text and email.
          </p>
          <ol className="quiet-stages">
            {STAGES.map((stage, index) => (
              <li
                key={stage.label}
                className="quiet-stage"
                data-active={index === ACTIVE_STAGE}
                data-complete={index < ACTIVE_STAGE}
              >
                <span>{stage.label}</span>
                <span>{stage.status}</span>
              </li>
            ))}
          </ol>
          <div className="quiet-progress quiet-progress-indeterminate" aria-hidden="true">
            <span />
          </div>
          <a href={brand.phoneHref} className="quiet-back quiet-inline-link">
            Questions? Call {brand.phoneDisplay}
          </a>
        </section>
      </div>
    </main>
  );
}
