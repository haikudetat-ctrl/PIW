"use client";

import {useLayoutEffect, useRef} from "react";

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
  const gateRef = useRef<HTMLDivElement>(null);

  // The bar is fixed to the bottom of the screen, so the page reserves its
  // height while it shows and the bar never covers the last form button.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      if (gateRef.current) root.style.setProperty("--privacy-consent-bar-height", `${gateRef.current.offsetHeight}px`);
    };
    root.classList.add("privacy-consent-pending");
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      root.classList.remove("privacy-consent-pending");
      root.style.removeProperty("--privacy-consent-bar-height");
    };
  }, [error]);

  return (
    <div ref={gateRef} className="privacy-consent-gate">
      <section className="privacy-consent-banner" aria-label="Privacy choices" role="region">
        <div className="privacy-consent-copy">
          <p>
            With your OK, we use cookies for analytics and advertising. Saying no won’t
            affect your quote. <a href="/privacy.html">Privacy policy</a>
          </p>
          {error ? <p role="alert">{error}</p> : null}
        </div>
        <div className="privacy-consent-actions">
          <button type="button" className="privacy-consent-decision" disabled={saving} onClick={onAcceptAll}>Accept</button>
          <button type="button" className="privacy-consent-decision" disabled={saving} onClick={onRejectNonessential}>Decline</button>
          <button type="button" className="privacy-consent-quiet" disabled={saving} onClick={onCustomize}>Choices</button>
        </div>
      </section>
    </div>
  );
}
