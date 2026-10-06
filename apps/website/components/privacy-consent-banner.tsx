type PrivacyConsentBannerProps = {
  saving: boolean;
  error: string | null;
  onAcceptAll(): void;
  onRejectNonessential(): void;
  onCustomize(): void;
};

export function PrivacyConsentBanner({
  saving,
  error,
  onAcceptAll,
  onRejectNonessential,
  onCustomize,
}: PrivacyConsentBannerProps) {
  return (
    <div className="privacy-consent-gate">
      <section className="privacy-consent-banner" aria-label="Privacy choices" role="region">
        <div className="privacy-consent-copy">
          <p>
            We use analytics and advertising cookies only with your permission.{" "}
            <a href="/privacy.html">Privacy policy</a>
          </p>
          {error ? <p role="alert">{error}</p> : null}
        </div>
        <div className="privacy-consent-actions">
          <button type="button" className="privacy-consent-secondary" disabled={saving} onClick={onAcceptAll}>Allow analytics &amp; advertising</button>
          <button type="button" className="privacy-consent-secondary" disabled={saving} onClick={onRejectNonessential}>
            Reject all
          </button>
          <button type="button" className="privacy-consent-quiet" disabled={saving} onClick={onCustomize}>Customize</button>
        </div>
      </section>
    </div>
  );
}
