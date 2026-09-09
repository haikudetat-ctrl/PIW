"""Verify opt-in release against localhost or a deployment, without sending leads or vendor events."""
import json
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get("CONSENT_TEST_BASE_URL", "http://localhost:3021")
SDK = "window.pixelCalls=[];window.fbq.callMethod=function(){window.pixelCalls.push(Array.from(arguments))};window.fbq.queue.forEach(x=>window.fbq.callMethod(...x));"

with sync_playwright() as runner:
    browser = runner.chromium.launch(headless=True)
    for path in ["/campaigns/for-every-season", "/"]:
        page = browser.new_page(viewport={"width": 390, "height": 844})
        state = {"consent": None}

        def consent(route):
            if route.request.method == "POST":
                choice = route.request.post_data_json
                state["consent"] = {"policyVersion": "piw-privacy-v1", "consentId": "11111111-1111-4111-8111-111111111111", "updatedAt": "2026-09-08T12:00:00Z", "gpcDetected": False,
                                    "preferences": {"necessary": True, "analytics": choice["analytics"], "advertising": choice["advertising"]}}
            route.fulfill(json=state)

        page.route("**/api/privacy/consent", consent)
        page.route("https://us-assets.i.posthog.com/**", lambda route: route.fulfill(content_type="application/javascript", headers={"access-control-allow-origin": "*"}, body=""))
        page.route("https://connect.facebook.net/**", lambda route: route.fulfill(content_type="application/javascript", body=SDK))
        page.route("**/_vercel/insights/**", lambda route: route.fulfill(content_type="application/javascript", body=""))
        page.route("**/api/google-reviews", lambda route: route.fulfill(json={"reviews": []}))
        page.route("**/api/address-autocomplete", lambda route: route.fulfill(json={"suggestions": [{"placeId": "test-place", "address": "1 Main St, Newark, NJ"}]}))
        page.route("**/api/campaign-estimate", lambda route: route.fulfill(json={"accepted": True, "estimateUrl": "#accepted", "metaEvent": None}))
        page.goto(BASE + path)
        page.get_by_role("button", name="Allow analytics & advertising", exact=True).wait_for()
        gate = page.locator(".privacy-consent-gate, .all-season-privacy-gate")
        assert gate.evaluate("e => getComputedStyle(e).position") == "relative"
        assert page.locator("body").evaluate("e => e.scrollWidth <= innerWidth")
        assert page.evaluate("!window.posthog && !window.fbq")
        # The form remains reachable and editable while the notice is still present.
        if path != "/":
            page.get_by_role("combobox").fill("1 Main")
            page.get_by_role("button", name="1 Main St, Newark, NJ", exact=True).click()
        page.get_by_role("button", name="Allow analytics & advertising", exact=True).click()
        page.wait_for_function("Boolean(window.posthog)")
        assert state["consent"]["preferences"]["advertising"] is True
        page.wait_for_function("Boolean(window.fbq && window.fbq.callMethod)")
        assert page.evaluate("window.pixelCalls.some(x=>x[0]==='track' && x[1]==='PageView')")
        page.locator("form.campaign-form, form#leadForm").first.scroll_into_view_if_needed()
        page.wait_for_function("window.posthog.some(x=>x[0]==='capture' && x[1]==='form_view')")
        if path != "/":
            page.get_by_role("combobox").fill("1 Main")
            page.get_by_role("button", name="1 Main St, Newark, NJ", exact=True).click()
            page.get_by_role("button", name="Continue to your details").click()
            page.get_by_label("Full name", exact=True).fill("Synthetic Test")
            page.get_by_label("Email", exact=True).fill("synthetic@example.com")
            page.get_by_label("Mobile phone", exact=True).fill("2015550100")
            page.locator('[name="consent_to_process_property"]').check()
            page.locator('[name="consent_to_contact"]').check()
            page.locator('form.campaign-form button[type="submit"]').click()
            page.wait_for_function("window.posthog.some(x=>x[0]==='capture' && x[1]==='lead_submitted')")
        page.locator('a[href^="tel:"]').first.evaluate("e=>{e.addEventListener('click',x=>x.preventDefault());e.click()}")
        assert page.evaluate("window.posthog.some(x=>x[0]==='capture' && x[1]==='phone_clicked')")
        page.get_by_role("button", name="Privacy choices", exact=False).click()
        page.get_by_role("checkbox", name="Analytics", exact=True).uncheck()
        page.get_by_role("checkbox", name="Advertising", exact=True).check()
        page.get_by_role("button", name="Save preferences", exact=True).click()
        page.wait_for_function("Boolean(window.fbq && window.fbq.callMethod)")
        assert page.evaluate("window.pixelCalls.some(x=>x[0]==='track' && x[1]==='PageView')")
        count = page.evaluate("window.posthog.filter(x=>x[0]==='capture').length")
        page.locator('a[href^="tel:"]').first.evaluate("e=>e.click()")
        assert page.evaluate("window.posthog.filter(x=>x[0]==='capture').length") == count
        events = page.evaluate("window.posthog.filter(x=>x[0]==='capture').map(x=>x[1])")
        print(json.dumps({"path": path, "mobile": "passed", "analytics": "explicit opt-in", "events": events, "pixel": "advertising opt-in only"}), flush=True)
        page.close()
    browser.close()
