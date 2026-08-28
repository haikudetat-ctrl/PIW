import base64
import json
import os
import re
import time
import unittest
import uuid
from pathlib import Path

from playwright.sync_api import BrowserContext, Page, Route, sync_playwright


BASE_URL = os.environ.get("ASSESSMENT_BASE_URL", "http://localhost:3000")
TOKEN_PATH = re.compile(r"/roof-estimate/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
RESUME_PATH = re.compile(r"/roof-estimate/resume/[0-9a-f-]{36}$")
REPO_ROOT = Path(__file__).resolve().parents[1]
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
          ensure('campaign', 'for-every-season');
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
        progressive_responses: list[int] = []

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                context = browser.new_context(
                    viewport={"width": 390, "height": 844},
                    reduced_motion="reduce",
                )
                page = context.new_page()

                def fake_static_map(route: Route) -> None:
                    requested_at = time.monotonic()
                    image_requests.append(requested_at)
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
                    13.5,
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
            finally:
                browser.close()

    def test_fake_provider_persistence_and_privacy_contracts_are_release_gated(self) -> None:
        integration = (REPO_ROOT / "src/integration/canonical-assessment-journey.test.ts").read_text()
        canonical_sql = (
            REPO_ROOT / "supabase/tests/canonical_roof_assessment_journey.test.sql"
        ).read_text()
        migration = next(
            (REPO_ROOT / "supabase/migrations").glob(
                "*_roof_assessment_property_prefetch.sql"
            )
        ).read_text()
        route_test = (
            REPO_ROOT
            / "src/app/api/integrations/all-season/campaign-estimate/route.test.ts"
        ).read_text()
        crm_test = (REPO_ROOT / "src/inngest/functions/crm-writer.test.ts").read_text()
        delivery_test = (
            REPO_ROOT / "src/inngest/functions/estimate-delivery-sender.test.ts"
        ).read_text()
        slack_test = (
            REPO_ROOT
            / "src/inngest/functions/context-dialer-slack-sender.test.ts"
        ).read_text()

        required_integration_contracts = (
            "fetchGooglePlaceDetails: async",
            "expect(placeDetailsCalls).toBe(1)",
            '.eq("id", firstCapability!.attemptId)',
            '.from("property_addresses")',
            "expect(addressObservations).toHaveLength(1)",
            "expect(addressProviderRequests).toHaveLength(0)",
            'expect(addressWorker.outcome).toBe("already_prefetched")',
            "expect(discoveryOutbox).toEqual([{event_id: discoveryEvent.id}])",
            "expect(replayedRoofWorker.id).toBe(firstRoofWorker.id)",
            "savePublicAssessmentProgress",
            "completePublicAssessment",
            "requestRoofConsultation",
            "expect(retryConsultation).toEqual(firstConsultation)",
            'provider: "google_solar"',
            "range_low_cents: 1_800_000",
            "expect(count).toBe(1)",
        )
        for contract in required_integration_contracts:
            self.assertIn(contract, integration)

        for contract in (
            "property_addresses_company_access_attempt_key",
            "assessment_access_attempt_id",
            "property/discovery_requested:assessment-prefetch:",
            "grant execute on function public.apply_roof_assessment_property_prefetch",
            "to service_role",
        ):
            self.assertIn(contract, migration)

        self.assertIn(
            "new intake appends all consent evidence",
            canonical_sql,
        )

        self.assertIn("roof_assessment_property_prefetch", route_test)
        self.assertIn(
            'expect(info).toHaveBeenCalledWith("roof_assessment_property_prefetch", completion)',
            route_test,
        )
        self.assertIn("expect(serialized).not.toMatch(", route_test)
        for field in (
            "outcome",
            "reason",
            "providerDurationMs",
            "persistenceDurationMs",
            "totalDurationMs",
        ):
            self.assertIn(field, route_test)
        for prohibited in (
            "Alex Rivera",
            r"alex@example\.com",
            "201-555-0100",
            "1 Main St",
            "latitude",
            "longitude",
            "signed_token",
            "maps-server-key",
        ):
            self.assertIn(prohibited, route_test)
        self.assertIn("expect(repository.stageHistoryCount).toBe(1)", crm_test)
        self.assertIn("expect(repository.completions).toBe(1)", crm_test)
        self.assertIn("posts only the consented delivery payload", delivery_test)
        self.assertIn("expect(sent).toEqual([\"delivery-1\"])", delivery_test)
        self.assertIn("builds a concise lead card", slack_test)
        self.assertIn("expect(fetcher).toHaveBeenCalledOnce()", slack_test)
        self.assertIn("expect(repo.markSent).toHaveBeenCalledWith(delivery)", slack_test)


if __name__ == "__main__":
    unittest.main()
