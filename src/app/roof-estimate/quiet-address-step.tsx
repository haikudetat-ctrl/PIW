import { PreviewAddressForm } from "./preview-address-form";
import { QuietHeader } from "./quiet/quiet-header";
import "./quiet/quiet.css";

// Value-first address step in the quiet style shared with the preview flow.
export function QuietAddressStep({
  brandName,
  logoUrl,
  browserApiKey,
  turnstileSiteKey,
}: {
  brandName: string;
  logoUrl?: string;
  browserApiKey?: string;
  turnstileSiteKey: string;
}) {
  return (
    <main className="quiet-flow">
      <div className="quiet-frame">
        <QuietHeader brandName={brandName} logoUrl={logoUrl} />
        <section className="quiet-body">
          <p className="quiet-step">Free roof preview</p>
          <h1 className="quiet-question">Where is the roof?</h1>
          <p className="quiet-lede">Enter the New Jersey address. You’ll see the roof from above in seconds.</p>
          <PreviewAddressForm browserApiKey={browserApiKey} turnstileSiteKey={turnstileSiteKey} brandName={brandName} />
        </section>
      </div>
    </main>
  );
}
