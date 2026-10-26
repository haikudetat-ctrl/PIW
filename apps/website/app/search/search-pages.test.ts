import {describe, expect, test} from "vitest";
import {searchPageSlugs} from "../../lib/landing-slugs";
import {companyFacts} from "../../lib/company-facts";
import {priceExample, priceFactors, processSteps, SEARCH_CTA_LABEL, searchPageMetadata, searchPages} from "./search-pages";

// The voice brief bans these outright; the pages must never drift into them.
const BANNED = [/unbeatable/i, /premier(?! )/i, /best-in-class/i, /ultimate protection/i, /dream roof/i, /—/, /act now/i, /limited time/i, /hurry/i, /guarantee/i, /lowest price/i, /#1/];

function allCopy() {
  return [
    ...Object.values(searchPages).flatMap((page) => [
      page.metaTitle, page.metaDescription, page.eyebrow, page.headline, page.intro,
      page.formTitle, page.formIntro, page.priceHeadline, page.priceIntro,
      page.closingHeadline, page.closingCopy,
      ...page.faqs.flatMap((faq) => [faq.question, faq.answer]),
    ]),
    ...priceFactors,
    priceExample.text,
    ...processSteps.flatMap((step) => [step.title, step.copy]),
  ];
}

describe("Google search landing pages", () => {
  test("define one page per search slug with matching routing context", () => {
    expect(Object.keys(searchPages).sort()).toEqual([...searchPageSlugs].sort());
    for (const [slug, page] of Object.entries(searchPages)) {
      expect(page.slug).toBe(slug);
      expect(page.entryPoint).toBe(`campaign:${slug}`);
      expect(page.presentationKey).toBe(slug);
    }
  });

  test("use the preferred call to action", () => {
    expect(SEARCH_CTA_LABEL).toBe("Get My Free Roof Estimate");
  });

  test("avoid banned phrases, em dashes and urgency", () => {
    for (const text of allCopy()) {
      for (const pattern of BANNED) {
        // "ShingleMaster PREMIER" is a credential name, not a superlative.
        expect(text.replace(/ShingleMaster PREMIER/g, ""), `${pattern} in: ${text}`).not.toMatch(pattern);
      }
    }
  });

  test("state the configured price range and an arithmetic-correct example", () => {
    expect(searchPages["roof-replacement-cost"].priceIntro).toContain("$500 to $750 per square");
    expect(priceExample.text).toBe("A roof that measures 25 squares would come to $12,500 to $18,750 at that range.");
    expect(companyFacts.pricePerSquare).toEqual({low: 500, high: 750});
  });

  test("name only the confirmed service area", () => {
    for (const text of allCopy()) expect(text).not.toMatch(/South Jersey|Philadelphia|county/i);
  });

  test("keep ad landing pages out of organic search", () => {
    expect(searchPageMetadata(searchPages["roof-replacement"]).robots).toEqual({index: false, follow: false});
  });

  test("keep titles inside a search result's display width", () => {
    for (const page of Object.values(searchPages)) expect(page.metaTitle.length).toBeLessThanOrEqual(60);
  });
});
