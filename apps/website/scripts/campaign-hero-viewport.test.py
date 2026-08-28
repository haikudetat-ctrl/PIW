import os
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("WEBSITE_BASE_URL", "http://127.0.0.1:3012")
OUT = Path(os.environ.get("CAMPAIGN_HERO_SCREENSHOTS", "/tmp/all-season-campaign-hero"))
CAMPAIGNS = ("weather-report", "seasonal-shield", "for-every-season")
VIEWPORTS = ((320, 568), (390, 844), (768, 1024), (1440, 900))


class CampaignHeroViewportTest(unittest.TestCase):
    def test_background_and_first_form_action_stay_in_the_first_screen(self):
        OUT.mkdir(parents=True, exist_ok=True)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                for campaign in CAMPAIGNS:
                    for width, height in VIEWPORTS:
                        with self.subTest(campaign=campaign, viewport=(width, height)):
                            page = browser.new_page(
                                viewport={"width": width, "height": height},
                                color_scheme="light",
                                reduced_motion="reduce",
                            )
                            page.goto(
                                f"{BASE_URL}/campaigns/{campaign}",
                                wait_until="networkidle",
                            )
                            metrics = page.evaluate(
                                """() => {
                                  const root = document.documentElement;
                                  const hero = document.querySelector('.campaign-hero');
                                  const media = document.querySelector('.campaign-hero-media');
                                  const image = media.querySelector('img');
                                  const conversion = document.querySelector('.campaign-conversion');
                                  const action = document.querySelector('.campaign-primary-action');
                                  const heroRect = hero.getBoundingClientRect();
                                  const mediaRect = media.getBoundingClientRect();
                                  const conversionRect = conversion.getBoundingClientRect();
                                  const actionRect = action.getBoundingClientRect();
                                  return {
                                    clientWidth: root.clientWidth,
                                    scrollWidth: root.scrollWidth,
                                    heroTop: heroRect.top,
                                    heroHeight: heroRect.height,
                                    mediaTop: mediaRect.top,
                                    mediaLeft: mediaRect.left,
                                    mediaRight: mediaRect.right,
                                    mediaBottom: mediaRect.bottom,
                                    conversionTop: conversionRect.top,
                                    actionBottom: actionRect.bottom,
                                    imageComplete: image.complete,
                                    imageNaturalWidth: image.naturalWidth,
                                    imageObjectFit: getComputedStyle(image).objectFit,
                                  };
                                }"""
                            )
                            self.assertLessEqual(metrics["scrollWidth"], metrics["clientWidth"])
                            self.assertGreaterEqual(
                                metrics["heroHeight"],
                                height - metrics["heroTop"] - 1,
                            )
                            self.assertAlmostEqual(metrics["mediaTop"], metrics["heroTop"], delta=1)
                            self.assertLessEqual(metrics["mediaLeft"], 0)
                            self.assertGreaterEqual(metrics["mediaRight"], width)
                            self.assertGreaterEqual(
                                metrics["mediaBottom"],
                                metrics["heroTop"] + metrics["heroHeight"] - 1,
                            )
                            self.assertLessEqual(metrics["conversionTop"], metrics["heroTop"] + 50)
                            self.assertLessEqual(metrics["actionBottom"], height)
                            self.assertTrue(metrics["imageComplete"])
                            self.assertGreater(metrics["imageNaturalWidth"], 0)
                            self.assertEqual(metrics["imageObjectFit"], "cover")
                            if width in (390, 1440):
                                page.screenshot(
                                    path=str(OUT / f"{campaign}-{width}x{height}.png"),
                                    full_page=False,
                                )
                            page.close()
            finally:
                browser.close()


if __name__ == "__main__":
    unittest.main()
