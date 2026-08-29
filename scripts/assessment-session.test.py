import base64
import json
import os
import re
import time
import unittest
import uuid

from playwright.sync_api import BrowserContext, Page, Route, sync_playwright


BASE_URL = os.environ.get("ASSESSMENT_BASE_URL", "http://localhost:3000")
TOKEN_PATH = re.compile(r"/roof-estimate/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
RESUME_PATH = re.compile(r"/roof-estimate/resume/[0-9a-f-]{36}$")
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def submit_estimate(
    page: Page,
    identity: dict[str, str],
    *,
    google_selected: bool = False,
) -> None:
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
    page.evaluate(
        """({googleSelected}) => {
          const form = document.querySelector('form[aria-label="Roof estimate request"]');
          const ensure = (name, value) => {
            let input = form.querySelector(`[name="${name}"]`);
            if (!input) {
              input = document.createElement('input');
              input.type = 'hidden';
              input.name = name;
              form.appendChild(input);
            }
            input.value = value;
          };
          if (googleSelected) {
            ensure('addressMode', 'google');
            ensure('googlePlaceId', 'ChIJ-task-six-fake-place');
            ensure('selectedAddress', '18 Harbor View Drive, Red Bank, NJ 07701');
          }
        }""",
        {"googleSelected": google_selected},
    )
    page.locator("button[type=submit]").click()


def answer_all_questions(page: Page) -> None:
    for step in range(9):
        options = page.locator(".assessment-answer-scroll .assessment-option")
        options.first.click()
        action = page.locator(".assessment-primary-action")
        if action.is_disabled():
            for option_index in range(1, options.count()):
                options.nth(option_index).click()
                if not action.is_disabled():
                    break
        if action.is_disabled():
            raise AssertionError(f"Question {step} never enabled its next action")
        action.click()
        if step < 8:
            page.wait_for_function(
                """expected => Number(
                  document.querySelector('[role=progressbar]').getAttribute('aria-valuenow')
                ) === expected""",
                arg=step + 2,
            )


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

    def test_consent_to_late_aerial_and_completed_result_are_one_browser_journey(self) -> None:
        suffix = uuid.uuid4().hex[:10]
        identity = {
            "address": f"{int(suffix[:6], 16) % 9000 + 1000} Timing Test Ave",
            "email": f"timing-{suffix}@example.com",
            "phone": f"201555{int(suffix[-4:], 16) % 10000:04d}",
        }
        timing: dict[str, float] = {}
        image_requests: list[float] = []
        direct_request_bodies: list[str] = []
        progressive_responses: list[int] = []

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                context = browser.new_context(
                    viewport={"width": 390, "height": 844},
                    reduced_motion="reduce",
                )
                page = context.new_page()
                diagnostics = page.request.delete(
                    f"{BASE_URL}/api/test/roof-assessment-prefetch"
                )
                self.assertEqual(diagnostics.status, 204)

                def fake_static_map(route: Route) -> None:
                    requested_at = time.monotonic()
                    image_requests.append(requested_at)
                    timing.setdefault("first_image_request_epoch_ms", time.time() * 1000)
                    accepted_at = timing.get("consent_accepted", requested_at)
                    if requested_at - accepted_at < 13.5:
                        route.fulfill(
                            status=404,
                            content_type="application/json",
                            headers={"retry-after": "1", "cache-control": "no-store"},
                            body='{"error":"Property image unavailable"}',
                        )
                        return
                    route.fulfill(
                        status=200,
                        content_type="image/png",
                        headers={"cache-control": "private, max-age=3600"},
                        body=TINY_PNG,
                    )
                    timing.setdefault("first_image_success", time.monotonic())

                page.route("**/api/roof-estimate/*/house-image*", fake_static_map)

                def capture_response(response) -> None:
                    if response.request.method == "POST" and response.headers.get(
                        "x-action-redirect"
                    ):
                        timing.setdefault("consent_accepted", time.monotonic())
                    if (
                        response.request.method == "PATCH"
                        and "/api/roof-estimate/" in response.url
                        and "/assessment" in response.url
                    ):
                        progressive_responses.append(response.status)

                page.on("response", capture_response)
                page.on(
                    "request",
                    lambda request: direct_request_bodies.append(request.post_data or "")
                    if request.method == "POST" and "/roof-estimate" in request.url
                    else None,
                )
                submit_estimate(page, identity, google_selected=True)
                page.wait_for_url(TOKEN_PATH, timeout=20_000)
                page.get_by_role("heading", name="Analyzing your property.").wait_for(
                    state="visible"
                )
                timing.setdefault("first_image_request", image_requests[0])

                start = page.get_by_role("button", name="Start my assessment")
                start.wait_for(state="visible", timeout=15_000)
                timing["reveal"] = time.monotonic()
                self.assertEqual(
                    page.get_by_role("status").filter(
                        has_text="Finalizing your property imagery"
                    ).count(),
                    1,
                )
                self.assertLess(
                    timing["reveal"] - timing["consent_accepted"],
                    12.75,
                )
                self.assertGreaterEqual(
                    timing["reveal"] - timing["consent_accepted"],
                    11.5,
                )
                page.locator("[data-testid=assessment-aerial-image]").wait_for(
                    state="visible", timeout=6_000
                )
                self.assertGreaterEqual(
                    timing["first_image_success"] - timing["consent_accepted"],
                    13.5,
                )

                start.click()
                page.locator(".assessment-question-actions").wait_for(state="visible")
                timing["question_start"] = time.monotonic()
                answer_all_questions(page)
                page.get_by_role(
                    "heading", name="Your property-specific project outlook"
                ).wait_for(state="visible")
                timing["completed_result"] = time.monotonic()

                self.assertEqual(len(progressive_responses), 9)
                self.assertTrue(all(status == 200 for status in progressive_responses))
                self.assertGreaterEqual(
                    timing["first_image_request"], timing["consent_accepted"]
                )
                self.assertLessEqual(
                    timing["first_image_request"] - timing["consent_accepted"], 2.5
                )
                self.assertLess(timing["first_image_success"], timing["question_start"])
                self.assertLess(timing["question_start"], timing["completed_result"])
                self.assertGreaterEqual(len(image_requests), 2)
                diagnostic_response = page.request.get(
                    f"{BASE_URL}/api/test/roof-assessment-prefetch"
                )
                self.assertEqual(diagnostic_response.status, 200)
                diagnostic_events = diagnostic_response.json()["events"]
                place_events = [
                    event for event in diagnostic_events
                    if event["event"] == "place_details_called"
                ]
                context_events = [
                    event for event in diagnostic_events
                    if event["event"] == "assessment_context"
                ]
                self.assertEqual(len(place_events), 1, diagnostic_events)
                self.assertEqual(len(context_events), 1, diagnostic_events)
                self.assertEqual(context_events[0]["sequence"], 1)
                self.assertEqual(context_events[0]["entryPoint"], "roof-estimate")
                self.assertEqual(context_events[0]["presentationKey"], "all-season-main")
                self.assertLess(place_events[0]["sequence"], 3)
                self.assertLessEqual(
                    place_events[0]["recordedAtMs"],
                    timing["first_image_request_epoch_ms"],
                )
                boundary = "\n".join(direct_request_bodies)
                self.assertRegex(boundary, r'name="(?:_1_)?campaign"')
                self.assertIn("for-every-season", boundary)
                self.assertNotRegex(
                    boundary,
                    r'name="(?:_1_)?(?:latitude|longitude|lat|lng|coordinates|capability|continuation|public_token)"',
                )
            finally:
                browser.close()

if __name__ == "__main__":
    unittest.main()
