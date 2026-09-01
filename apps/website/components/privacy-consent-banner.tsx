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
    <section className="privacy-consent-banner" aria-label="Privacy choices" role="region">
      <div className="privacy-consent-copy">
        <p className="privacy-consent-kicker">Privacy choices</p>
        <h2>You control optional advertising technology.</h2>
        <p>
          Necessary technology keeps this site working. With your permission, we may
          also use analytics and advertising technology. Your choice will not prevent
          you from requesting a roof assessment.
        </p>
        <a href="/privacy.html">Privacy policy</a>
        {error ? <p role="alert">{error}</p> : null}
      </div>
      <div className="privacy-consent-actions">
        <button type="button" className="privacy-consent-primary" disabled={saving} onClick={onAcceptAll}>Accept all</button>
        <button type="button" className="privacy-consent-secondary" disabled={saving} onClick={onRejectNonessential}>
          Reject nonessential
        </button>
        <button type="button" className="privacy-consent-quiet" disabled={saving} onClick={onCustomize}>Customize</button>
      </div>
    </section>
  );
}
