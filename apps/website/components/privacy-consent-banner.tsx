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
          <p className="privacy-consent-kicker">Privacy choices</p>
          <h2>Analytics is your choice.</h2>
          <p>
            With your permission, we use analytics to understand how our service is used
            and improve its performance. You can reject analytics now or change your
            choice anytime in Privacy Choices. Advertising has a separate control.
          </p>
          <a href="/privacy.html">Privacy policy</a>
          {error ? <p role="alert">{error}</p> : null}
        </div>
        <div className="privacy-consent-actions">
          <button type="button" className="privacy-consent-secondary" disabled={saving} onClick={onAcceptAll}>Allow analytics</button>
          <button type="button" className="privacy-consent-secondary" disabled={saving} onClick={onRejectNonessential}>
            Reject analytics
          </button>
          <button type="button" className="privacy-consent-quiet" disabled={saving} onClick={onCustomize}>Customize</button>
        </div>
      </section>
    </div>
  );
}
