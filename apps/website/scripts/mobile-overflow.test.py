import os
import unittest

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("WEBSITE_BASE_URL", "http://127.0.0.1:3012")


class HomepageOverflowTest(unittest.TestCase):
    def test_process_heading_stays_inside_mobile_viewports(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                for width, height in ((320, 568), (375, 667), (390, 844), (1440, 900)):
                    with self.subTest(viewport=width):
                        page = browser.new_page(
                            viewport={"width": width, "height": height},
                            color_scheme="light",
                        )
                        page.goto(BASE_URL, wait_until="networkidle")
                        metrics = page.evaluate(
                            """() => {
                              const root = document.documentElement;
                              const heading = document.querySelector('.process-heading');
                              const lines = [...heading.querySelectorAll(':scope > span')];
                              const headingRect = heading.getBoundingClientRect();
                              return {
                                clientWidth: root.clientWidth,
                                scrollWidth: root.scrollWidth,
                                headingLeft: headingRect.left,
                                headingRight: headingRect.right,
                                lines: lines.map((line) => {
                                  const rect = line.getBoundingClientRect();
                                  return {
                                    left: rect.left,
                                    right: rect.right,
                                    display: getComputedStyle(line).display,
                                    whiteSpace: getComputedStyle(line).whiteSpace,
                                    fontSize: Number.parseFloat(getComputedStyle(line).fontSize),
                                  };
                                }),
                              };
                            }"""
                        )
                        self.assertLessEqual(metrics["scrollWidth"], metrics["clientWidth"])
                        self.assertEqual(len(metrics["lines"]), 2)
                        for line in metrics["lines"]:
                            self.assertGreaterEqual(line["left"], metrics["headingLeft"] - 1)
                            self.assertLessEqual(line["right"], metrics["headingRight"] + 1)
                            self.assertEqual(line["display"], "block")
                            self.assertEqual(line["whiteSpace"], "nowrap")
                        self.assertGreater(
                            metrics["lines"][1]["fontSize"],
                            metrics["lines"][0]["fontSize"],
                        )
                        page.close()
            finally:
                browser.close()


if __name__ == "__main__":
    unittest.main()
