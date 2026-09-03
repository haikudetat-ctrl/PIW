import Link from "next/link";

type PrivacyConsentBannerProps = {
  error: string | null;
  saving: boolean;
  onAcceptAll(): void;
  onRejectNonessential(): void;
  onCustomize(): void;
};

export function PrivacyConsentBanner({
  error,
  saving,
  onAcceptAll,
  onRejectNonessential,
  onCustomize,
}: PrivacyConsentBannerProps) {
  return (
    <section className="privacy-consent-banner" aria-label="Privacy choices">
      <div className="privacy-consent-banner__copy">
        <h2>Your privacy choices</h2>
        <p>
          We use necessary technology to operate this site. With your permission,
          we may also use analytics and advertising technology. Your choice will
          not prevent you from requesting or reviewing a roof assessment.
        </p>
        <Link href="/privacy">Privacy policy</Link>
        {error ? <p className="privacy-consent-error" role="alert">{error}</p> : null}
      </div>
      <div className="privacy-consent-banner__actions">
        <button type="button" onClick={onAcceptAll} disabled={saving}>Accept all</button>
        <button type="button" onClick={onRejectNonessential} disabled={saving}>
          Reject nonessential
        </button>
        <button type="button" onClick={onCustomize} disabled={saving}>Customize</button>
      </div>
    </section>
  );
}
