import os
import time
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
IMAGERY_STATES = (
    ("ready", 7.5, 9.5, True),
    ("slow", 8.5, 11.5, True),
    ("pending", 11.5, 13.5, False),
    ("retry", 7.5, 9.5, True),
)


def viewport_metrics(page: Page, selector: str) -> dict[str, float | bool]:
    return page.eval_on_selector(
        selector,
        """element => {
          const bounds = element.getBoundingClientRect();
          const root = document.documentElement;
          return {
            innerHeight: window.innerHeight,
            scrollHeight: root.scrollHeight,
            scrollY: window.scrollY,
            top: bounds.top,
            bottom: bounds.bottom,
            height: bounds.height,
            visible: bounds.top >= 0 && bounds.bottom <= window.innerHeight,
          };
        }""",
    )


def assert_action_fits(
    test: unittest.TestCase,
    page: Page,
    selector: str,
    label: str,
) -> None:
    metrics = viewport_metrics(page, selector)
    test.assertEqual(metrics["scrollY"], 0, f"{label}: {metrics}")
    test.assertLessEqual(
        metrics["scrollHeight"],
        metrics["innerHeight"],
        f"{label}: document scrolling is required",
    )
    test.assertTrue(metrics["visible"], f"{label}: action is outside the viewport: {metrics}")
    test.assertGreaterEqual(metrics["height"], 44, f"{label}: action is below 44px: {metrics}")


def assert_question_fits(test: unittest.TestCase, page: Page, label: str) -> None:
    assert_action_fits(test, page, ".assessment-question-actions", label)


def open_questions(page: Page) -> None:
    page.goto(
        f"{BASE_URL}/roof-estimate/dev-assessment?imagery=ready",
        wait_until="networkidle",
    )
    start = page.get_by_role("button", name="Start my assessment")
    start.wait_for(state="visible", timeout=15_000)
    start.click()
    page.locator(".assessment-question-actions").wait_for(state="visible")


class AssessmentViewportTest(unittest.TestCase):
    def test_analysis_timing_and_next_action_for_every_state_and_viewport(self) -> None:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                for viewport_name, width, height in VIEWPORTS:
                    for imagery, earliest, latest, expects_image in IMAGERY_STATES:
                        with self.subTest(viewport=viewport_name, imagery=imagery):
                            page = browser.new_page(
                                viewport={"width": width, "height": height},
                                color_scheme="light",
                                reduced_motion="reduce",
                            )
                            try:
                                page.goto(
                                    f"{BASE_URL}/roof-estimate/dev-assessment?imagery={imagery}",
                                    wait_until="networkidle",
                                )
                                page.get_by_role(
                                    "heading", name="Analyzing your property."
                                ).wait_for(state="visible")
                                started_at = time.monotonic()
                                start = page.get_by_role(
                                    "button", name="Start my assessment"
                                )
                                start.wait_for(state="visible", timeout=15_000)
                                elapsed = time.monotonic() - started_at
                                self.assertGreaterEqual(
                                    elapsed,
                                    earliest,
                                    f"{viewport_name} {imagery} revealed too early: {elapsed:.3f}s",
                                )
                                self.assertLess(
                                    elapsed,
                                    latest,
                                    f"{viewport_name} {imagery} revealed too late: {elapsed:.3f}s",
                                )
                                self.assertEqual(
                                    page.locator("[data-testid=assessment-aerial-image]").count(),
                                    1 if expects_image else 0,
                                )
                                self.assertEqual(
                                    page.get_by_role("status").filter(
                                        has_text="Finalizing your property imagery"
                                    ).count(),
                                    0 if expects_image else 1,
                                )
                                assert_action_fits(
                                    self,
                                    page,
                                    ".assessment-primary-action",
                                    f"{viewport_name} {imagery} confirmation",
                                )
                                start.focus()
                                self.assertTrue(
                                    start.evaluate("button => document.activeElement === button")
                                )
                                assert_action_fits(
                                    self,
                                    page,
                                    ".assessment-primary-action",
                                    f"{viewport_name} {imagery} focused confirmation",
                                )
                            finally:
                                page.close()
            finally:
                browser.close()

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
                        try:
                            open_questions(page)
                            for step in range(9):
                                assert_question_fits(self, page, f"{name} step {step} unselected")
                                options = page.locator(
                                    ".assessment-answer-scroll .assessment-option"
                                )
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
                        finally:
                            page.close()
            finally:
                browser.close()


if __name__ == "__main__":
    unittest.main()
