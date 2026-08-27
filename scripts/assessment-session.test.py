import base64
import json
import os
import re
import unittest
import uuid

from playwright.sync_api import BrowserContext, Page, sync_playwright


BASE_URL = os.environ.get("ASSESSMENT_BASE_URL", "http://localhost:3000")
TOKEN_PATH = re.compile(r"/roof-estimate/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
RESUME_PATH = re.compile(r"/roof-estimate/resume/[0-9a-f-]{36}$")


def submit_estimate(page: Page, identity: dict[str, str]) -> None:
    page.goto(f"{BASE_URL}/roof-estimate", wait_until="networkidle")
    page.locator("input[name=addressLine1]").fill(identity["address"])
    page.locator("input[name=city]").fill("Newark")
    page.locator("input[name=postalCode]").fill("07102")
    page.get_by_role("button", name="Continue", exact=True).click()
    page.locator("input[name=name]").fill("Session Browser Test")
    page.locator("input[name=email]").fill(identity["email"])
    page.locator("input[name=phone]").fill(identity["phone"])
    for consent in ("consentEstimate", "consentEmail", "consentSms"):
        page.locator(f"input[name={consent}]").check()
    page.locator("button[type=submit]").click()


def session_cookie(context: BrowserContext):
    return next(
        (
            cookie
            for cookie in context.cookies(f"{BASE_URL}/roof-estimate")
            if cookie["name"] == "as_roof_assessment"
        ),
        None,
    )


def session_assessment_id(cookie: dict[str, object]) -> str:
    encoded = str(cookie["value"]).split(".", 1)[0]
    payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    return str(payload["assessmentId"])


class AssessmentSessionBrowserTest(unittest.TestCase):
    def test_first_submit_binds_browser_and_repeat_skips_cross_device_resume(self) -> None:
        suffix = uuid.uuid4().hex[:10]
        identity = {
            "address": f"{int(suffix[:6], 16) % 9000 + 1000} Session Test Ave",
            "email": f"session-{suffix}@example.com",
            "phone": f"201555{int(suffix[-4:], 16) % 10000:04d}",
        }

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                same_browser = browser.new_context()
                page = same_browser.new_page()
                action_responses = []
                page.on(
                    "response",
                    lambda response: action_responses.append(
                        {
                            "url": response.url,
                            "status": response.status,
                            "headers": response.all_headers(),
                        }
                    )
                    if response.request.method == "POST"
                    else None,
                )
                submit_estimate(page, identity)
                page.wait_for_url(TOKEN_PATH, timeout=20_000)
                canonical_url = page.url

                cookie = session_cookie(same_browser)
                self.assertIsNotNone(cookie, action_responses)
                self.assertTrue(cookie["httpOnly"])
                self.assertEqual(cookie["sameSite"], "Lax")
                self.assertEqual(cookie["path"], "/roof-estimate")
                self.assertNotRegex(canonical_url, r"/(?:continue|resume)/")
                assessment_id = session_assessment_id(cookie)
                self.assertEqual(
                    action_responses[-1]["headers"]["x-action-redirect"],
                    f"{canonical_url.removeprefix(BASE_URL)};push",
                )
                self.assertNotIn("/continue/", action_responses[-1]["headers"]["x-action-redirect"])

                submit_estimate(page, identity)
                page.wait_for_url(TOKEN_PATH, timeout=20_000)
                self.assertNotEqual(page.url, canonical_url)
                repeated_cookie = session_cookie(same_browser)
                self.assertIsNotNone(repeated_cookie)
                self.assertEqual(session_assessment_id(repeated_cookie), assessment_id)

                cross_device = browser.new_context()
                cross_device_page = cross_device.new_page()
                submit_estimate(cross_device_page, identity)
                cross_device_page.wait_for_url(RESUME_PATH, timeout=20_000)
                self.assertIsNone(session_cookie(cross_device))
            finally:
                browser.close()


if __name__ == "__main__":
    unittest.main()
