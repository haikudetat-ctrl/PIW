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
