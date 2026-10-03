"""Browser journey for the value-first address step on every website entry point.

Run against a website server started with NEXT_PUBLIC_PROPERTY_PREVIEW_ENABLED=true
and NEXT_PUBLIC_TURNSTILE_SITE_KEY set. Turnstile, address suggestions, and the
PIW preview API are intercepted, so no real lead or provider call is made.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get("WEBSITE_BASE_URL", "http://127.0.0.1:3000")
OUT = Path(os.environ.get("VALUE_FIRST_OUT", "/tmp/all-season-value-first"))
OUT.mkdir(parents=True, exist_ok=True)
PREVIEW_URL = "https://estimate.allseasonroofingquote.com/roof-estimate/p/" + "t" * 43
NOTICE = "By clicking “See my roof,” you authorize All Season Solar to review this address using property records, maps, and imagery."
TURNSTILE_STUB = """
window.turnstile = {
  render: function (el, options) { setTimeout(function () { options.callback('turnstile-token'); }, 0); return 'w1'; },
  reset: function () {},
  remove: function () {}
};
"""

ENTRY_POINTS = [
    ("homepage", "/", "main-home", None),
    ("contact", "/contact.html", "main-contact", None),
    ("campaign", "/campaigns/weather-report", "campaign:weather-report", "weather-report"),
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get("CHROMIUM_PATH") or None)
    failures = []
    for width, height, label in [(1440, 1000, "desktop"), (390, 844, "mobile")]:
        context = browser.new_context(viewport={"width": width, "height": height})
        context.route("**/challenges.cloudflare.com/**", lambda route: route.fulfill(status=200, content_type="application/javascript", body=TURNSTILE_STUB))
        context.route("**/api/google-reviews", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"reviews": [], "attributions": []})))
        context.route("**/api/address-autocomplete", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"suggestions": [{"placeId": "ChIJ-one", "address": "1 Main St, Newark, NJ 07102, USA"}]})))
        context.route("https://estimate.allseasonroofingquote.com/**", lambda route: route.fulfill(status=200, content_type="text/html", body="<h1>Preview</h1>"))

        for name, path, entry_point, campaign in ENTRY_POINTS:
            page = context.new_page()
            submitted = []

            def make_fulfill(sink):
                def fulfill(route):
                    sink.append(json.loads(route.request.post_data or "{}"))
                    route.fulfill(status=201, content_type="application/json", body=json.dumps({"previewUrl": PREVIEW_URL}))
                return fulfill

            page.route("**/api/property-preview", make_fulfill(submitted))
            page.goto(BASE + path + "?utm_source=facebook&fbclid=abc", wait_until="networkidle")
            form = page.locator("form.campaign-form, form[data-preview-address-form]").first
            form.wait_for(state="visible")
            notice = form.locator("[data-preview-notice]").inner_text().strip()
            if notice != NOTICE:
                failures.append(f"{label}/{name}: notice was {notice!r}")
            if form.locator("input[type=email], input[type=tel], input[type=checkbox]").count():
                failures.append(f"{label}/{name}: contact fields or checkboxes still present")
            horizontal = page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            if not horizontal:
                failures.append(f"{label}/{name}: horizontal scroll")
            form.scroll_into_view_if_needed()
            page.screenshot(path=str(OUT / f"{label}-{name}.png"), full_page=False)

            search = form.locator("[data-address-search], .campaign-address-search input").first
            search.fill("1 Main")
            page.locator("[data-suggestion], .campaign-suggestion, [role=option]").first.click()
            page.wait_for_timeout(100)
            form.locator("button[type=submit]").click()
            try:
                page.wait_for_url(PREVIEW_URL, timeout=5000)
            except Exception:
                failures.append(f"{label}/{name}: did not continue to the preview URL ({page.url})")
            if not submitted:
                failures.append(f"{label}/{name}: no preview request")
            else:
                body = submitted[0]
                expected = {
                    "address": "1 Main St, Newark, NJ 07102, USA",
                    "google_place_id": "ChIJ-one",
                    "campaign": campaign,
                    "entry_point": entry_point,
                    "turnstile_token": "turnstile-token",
                    "utm_source": "facebook",
                    "fbclid": "abc",
                }
                for key, value in expected.items():
                    if body.get(key) != value:
                        failures.append(f"{label}/{name}: {key} was {body.get(key)!r}, expected {value!r}")
            page.close()

        # The quote drawer on a static page mounts the same step.
        page = context.new_page()
        page.goto(BASE + "/services/roofing.html", wait_until="networkidle")
        launcher = page.locator(".as-quote-launcher")
        if launcher.count():
            launcher.click()
            drawer_form = page.locator(".as-quote-panel [data-preview-address-form]")
            if not drawer_form.is_visible():
                failures.append(f"{label}/drawer: address step not visible")
            page.wait_for_timeout(600)
            page.screenshot(path=str(OUT / f"{label}-drawer.png"))
        else:
            failures.append(f"{label}/drawer: launcher missing")
        page.close()
        context.close()
    browser.close()

    if failures:
        raise SystemExit("\n".join(failures))
    print("value-first journey passed; screenshots in", OUT)
