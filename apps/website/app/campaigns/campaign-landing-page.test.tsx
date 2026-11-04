import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, test} from "vitest";
import {CampaignLandingPage} from "./campaign-landing-page";
import {campaigns} from "./campaigns";

describe("campaign landing page footer", () => {
  test("keeps privacy and terms available from every campaign", () => {
    const html = renderToStaticMarkup(
      <CampaignLandingPage campaign={campaigns["for-every-season"]} />,
    );

    expect(html).toContain('href="/privacy.html"');
    expect(html).toContain('href="/terms.html"');
  });

  test("shows the NJ home improvement registration number once it is configured", () => {
    const previous = process.env.NEXT_PUBLIC_NJ_HIC_REGISTRATION;
    try {
      delete process.env.NEXT_PUBLIC_NJ_HIC_REGISTRATION;
      expect(renderToStaticMarkup(<CampaignLandingPage campaign={campaigns["weather-report"]} />))
        .not.toContain("Home Improvement Contractor");
      process.env.NEXT_PUBLIC_NJ_HIC_REGISTRATION = "13VH07213500";
      expect(renderToStaticMarkup(<CampaignLandingPage campaign={campaigns["weather-report"]} />))
        .toContain("NJ Home Improvement Contractor Reg. #13VH07213500");
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_NJ_HIC_REGISTRATION;
      else process.env.NEXT_PUBLIC_NJ_HIC_REGISTRATION = previous;
    }
  });
});

describe("campaign claims", () => {
  test("state 15+ years in business, never 20+", () => {
    const html = renderToStaticMarkup(<CampaignLandingPage campaign={campaigns["for-every-season"]} />);
    expect(html).toContain("15+");
    expect(html).not.toContain("20+");
  });
});

describe("campaign landing page hero", () => {
  test.each([
    "weather-report",
    "seasonal-shield",
    "for-every-season",
  ] as const)("uses one campaign-specific background behind the conversion flow for %s", (slug) => {
    const html = renderToStaticMarkup(
      <CampaignLandingPage campaign={campaigns[slug]} />,
    );

    expect(html).toContain(`data-campaign="${slug}"`);
    expect(html).toContain('class="campaign-hero-media"');
    expect(html).toContain(`srcSet="/_next/image?url=%2Fcampaigns%2F${slug}%2Fhero.webp`);
    expect(html).toContain('class="campaign-conversion"');
    expect(html).not.toContain("campaign-ad-ambient");
    expect(html).not.toContain("campaign-ad-foreground");
  });
});
