import Image from "next/image";

type Brand = {
  name: string;
  phoneDisplay: string;
  phoneHref: string;
  websiteUrl: string;
  googleListingUrl: string;
  googleRating: string;
  googleReviewCount: number;
  googleSnapshotDate: string;
  testimonial: { quote: string; author: string; source: string };
};

export function QuoteLoadingView({
  brand,
  address,
}: {
  brand: Brand;
  address: string;
}) {
  return (
    <main className="campaign-sandbox campaign-every-season min-h-[100dvh]">
      <div className="campaign-page-frame">
        <header className="campaign-header">
          <div className="campaign-wordmark">
            <span className="campaign-mark" aria-hidden="true" />
            <span>ALL SEASON</span>
          </div>
          <a href={brand.phoneHref}>{brand.phoneDisplay}</a>
        </header>

        <section className="campaign-experience" data-stage="loading" aria-live="polite">
          <div className="campaign-media">
            <Image
              src="/campaigns/every-season.jpg"
              alt="A home shown across spring, summer, fall, and winter"
              fill
              priority
              sizes="(min-width: 900px) 52vw, 100vw"
              className="campaign-media-image"
            />
            <div className="campaign-media-scrim" />
          </div>

          <div className="campaign-panel campaign-loading-panel">
            <div className="campaign-loading-art" aria-hidden="true">
              <div className="campaign-loading-field" />
              <span className="campaign-loading-ring" />
              <Image
                src="/brand/as-sun-white.svg"
                alt=""
                width={220}
                height={220}
                priority
                className="campaign-loading-mark"
              />
            </div>
            <div className="campaign-loading-copy">
              <p className="campaign-kicker">Measurement in progress</p>
              <h1>Preparing for every season.</h1>
              <p className="campaign-intro">
                We are matching {address} and checking the roof surface.
              </p>
              <div className="campaign-status-list">
                <div data-status="complete"><span>Address secured</span><small>Your request is saved.</small></div>
                <div data-status="active"><span>Roof measurement</span><small>Property match in progress.</small></div>
                <div><span>Estimate range</span><small>Sent by text and email.</small></div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
