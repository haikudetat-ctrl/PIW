import {readFile} from "node:fs/promises";
import path from "node:path";
// @ts-expect-error jsdom does not publish declarations with this workspace dependency.
import {JSDOM} from "jsdom";
import {describe, expect, test, vi} from "vitest";

async function renderReviews({
  reducedMotion = false,
  includeReview = true,
}: {reducedMotion?: boolean; includeReview?: boolean} = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <section data-google-reviews>
      <a data-google-reviews-link href="https://www.google.com/maps"></a>
      <span data-google-rating></span>
      <div data-google-reviews-viewport hidden>
        <div data-google-reviews-track></div>
      </div>
      <div data-google-attributions></div>
      <p data-google-reviews-fallback></p>
    </section>
  </body>`, {
    runScripts: "outside-only",
    url: "https://allseason.example/",
  });
  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: () => ({matches: reducedMotion}),
  });
  Object.defineProperty(dom.window, "fetch", {
    configurable: true,
    value: vi.fn(async () => Response.json({
      businessName: "All Season Solar",
      rating: 5,
      reviewCount: 1,
      googleMapsUri: "https://www.google.com/maps/place/all-season",
      attributions: [
        {provider: "Roof Data One", providerUri: "https://provider-one.example/"},
        {provider: "Roof Data Two", providerUri: "https://provider-two.example/"},
      ],
      reviews: includeReview ? [{
        author: "Jamie L.",
        authorUri: "https://www.google.com/maps/contrib/jamie",
        photoUri: "https://lh3.googleusercontent.com/jamie",
        rating: 5,
        text: "The crew protected our home and kept us informed.",
        relativeTime: "a month ago",
        reviewUri: "https://www.google.com/maps/reviews/data=jamie-review",
      }] : [],
    })),
  });
  const source = await readFile(path.join(process.cwd(), "public", "script.js"), "utf8");

  dom.window.eval(source);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  await vi.waitFor(() => {
    if (includeReview) {
      expect(dom.window.document.querySelector(".google-review-card")).not.toBeNull();
    } else {
      expect(dom.window.document.querySelectorAll("[data-google-attributions] a")).toHaveLength(2);
    }
  });

  return dom;
}

describe("Google review attribution", () => {
  test("links the author profile and source review separately", async () => {
    const dom = await renderReviews();
    const card = dom.window.document.querySelector(".google-review-card");

    expect(card?.querySelector('a[href="https://www.google.com/maps/contrib/jamie"]')?.textContent)
      .toContain("Jamie L.");
    expect(card?.querySelector('a[href="https://www.google.com/maps/reviews/data=jamie-review"]')?.textContent)
      .toMatch(/Google Maps/i);

    dom.window.close();
  });

  test("renders every provider attribution inside the Google review container", async () => {
    const dom = await renderReviews();
    const container = dom.window.document.querySelector("[data-google-reviews]");
    const links = Array.from(
      container?.querySelectorAll("[data-google-attributions] a") ?? [],
    ) as HTMLAnchorElement[];

    expect(links.map((link) => ({
      label: link.textContent,
      href: link.getAttribute("href"),
    }))).toEqual([
      {label: "Roof Data One", href: "https://provider-one.example/"},
      {label: "Roof Data Two", href: "https://provider-two.example/"},
    ]);

    dom.window.close();
  });

  test("renders provider attributions even when no eligible review is returned", async () => {
    const dom = await renderReviews({includeReview: false});

    expect(dom.window.document.querySelectorAll("[data-google-attributions] a")).toHaveLength(2);

    dom.window.close();
  });

  test("does not create a duplicate marquee copy when reduced motion is requested", async () => {
    const dom = await renderReviews({reducedMotion: true});

    expect(dom.window.document.querySelectorAll(".google-review-card")).toHaveLength(1);

    dom.window.close();
  });

  test("keeps the duplicate marquee copy out of the keyboard tab order", async () => {
    const dom = await renderReviews({reducedMotion: false});
    const cards = dom.window.document.querySelectorAll(".google-review-card");
    const duplicateLinks = Array.from(cards[1]?.querySelectorAll("a") ?? []) as HTMLAnchorElement[];

    expect(cards).toHaveLength(2);
    expect(duplicateLinks).toHaveLength(2);
    expect(duplicateLinks.every((link) => link.tabIndex === -1)).toBe(true);

    dom.window.close();
  });
});
