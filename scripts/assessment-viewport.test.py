import os
import unittest

from playwright.sync_api import Page, sync_playwright


BASE_URL = os.environ.get("ASSESSMENT_BASE_URL", "http://localhost:3000")
VIEWPORTS = (
    ("320x568", 320, 568),
    ("375x667", 375, 667),
    ("390x844", 390, 844),
    ("768x1024", 768, 1024),
    ("1440x900", 1440, 900),
)


def assert_question_fits(test: unittest.TestCase, page: Page, label: str) -> None:
    metrics = page.evaluate(
        """() => {
          const action = document.querySelector('.assessment-question-actions');
          const bounds = action.getBoundingClientRect();
          return {
            innerHeight: window.innerHeight,
            scrollHeight: document.documentElement.scrollHeight,
            actionTop: bounds.top,
            actionBottom: bounds.bottom,
          };
        }"""
    )
    test.assertLessEqual(
        metrics["scrollHeight"],
        metrics["innerHeight"],
        f"{label}: {metrics}",
    )
    test.assertGreaterEqual(metrics["actionTop"], 0, f"{label}: {metrics}")
    test.assertLessEqual(
        metrics["actionBottom"],
        metrics["innerHeight"],
        f"{label}: {metrics}",
    )


def open_questions(page: Page) -> None:
    page.goto(f"{BASE_URL}/roof-estimate/dev-assessment", wait_until="networkidle")
    start = page.get_by_role("button", name="Start my assessment")
    start.wait_for(state="visible", timeout=20_000)
    start.click()
    page.locator(".assessment-question-actions").wait_for(state="visible")


class AssessmentViewportTest(unittest.TestCase):
    def test_all_question_stages_fit_mobile_tablet_and_desktop(self) -> None:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                for name, width, height in VIEWPORTS:
                    with self.subTest(viewport=name):
                        page = browser.new_page(
                            viewport={"width": width, "height": height},
                            color_scheme="light",
                            reduced_motion="reduce",
                        )
                        open_questions(page)
                        for step in range(9):
                            assert_question_fits(self, page, f"{name} step {step} unselected")
                            options = page.locator(".assessment-answer-scroll .assessment-option")
                            options.first.click()
                            action = page.locator(".assessment-primary-action")
                            if action.is_disabled():
                                for option_index in range(1, options.count()):
                                    options.nth(option_index).click()
                                    if not action.is_disabled():
                                        break
                            self.assertFalse(action.is_disabled(), f"{name} step {step}")
                            assert_question_fits(self, page, f"{name} step {step} selected")
                            action.click()
                            if step < 8:
                                page.wait_for_function(
                                    """expected => Number(
                                      document.querySelector('[role=progressbar]').getAttribute('aria-valuenow')
                                    ) === expected""",
                                    arg=step + 2,
                                )
                        page.get_by_role(
                            "heading", name="Your property-specific project outlook"
                        ).wait_for(state="visible")
                        page.close()
            finally:
                browser.close()


if __name__ == "__main__":
    unittest.main()
