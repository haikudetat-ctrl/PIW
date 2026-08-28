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
