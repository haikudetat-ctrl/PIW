import json
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get("WEBSITE_BASE_URL", "http://127.0.0.1:3000")
ASSESSMENT_BASE = os.environ.get("ASSESSMENT_BASE_URL", "http://127.0.0.1:3001")
OUT = Path("/tmp/all-season-visual-test")
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context()
    context.route(
        "**/api/google-reviews",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({
                "rating": 5,
                "reviewCount": 0,
                "reviews": [],
                "attributions": [],
                "googleMapsUri": "https://maps.google.com/",
            }),
        ),
    )
    errors = []
    for name, width, height in [("desktop", 1440, 1000), ("mobile", 390, 844)]:
        page = context.new_page()
        page.set_viewport_size({"width": width, "height": height})
        page.emulate_media(color_scheme="light")
        page.on("console", lambda msg: errors.append(f"console: {msg.text}") if msg.type == "error" and not msg.text.startswith("Failed to load resource") else None)
        page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
        page.goto(BASE, wait_until="networkidle")
        page.locator("h1").wait_for(state="visible")
        assert (page.locator("h1").inner_text() or "").strip()
        assert page.locator("header .logo img").is_visible()
        horizontal = page.evaluate("""() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          offenders: Array.from(document.querySelectorAll('body *'))
            .filter(element => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
            .slice(0, 5)
            .map(element => ({tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right})),
        })""")
        assert horizontal["scrollWidth"] <= horizontal["clientWidth"], (name, horizontal)
        for element in page.locator(".reveal:visible").all():
            element.scroll_into_view_if_needed()
            page.wait_for_timeout(100)
        assert page.locator(".reveal:visible:not(.is-visible)").count() == 0
        assert page.evaluate("Array.from(document.images).filter(img => img.offsetParent).every(img => img.complete && img.naturalWidth > 0)")
        if page.locator(".as-quote-panel").is_visible():
            page.locator(".as-quote-close").click()
        page.evaluate("window.scrollTo(0, 0)")
        if name == "mobile":
            page.locator(".nav-toggle").click()
            assert page.locator(".main-nav").is_visible()
            page.locator(".nav-toggle").click()
        page.evaluate("document.activeElement && document.activeElement.blur()")
        page.add_style_tag(content="header.site{position:static!important}.skip-link{display:none!important}")
        page.screenshot(path=str(OUT / f"home-{name}.png"), full_page=True)
        page.close()

    page = context.new_page()
    page.set_viewport_size({"width": 1280, "height": 900})
    page.emulate_media(color_scheme="light")
    page.goto(BASE + "/resources/nj-roof-solar-readiness-checklist.html", wait_until="networkidle")
    assert page.locator(".readiness-item").count() == 7
    page.locator(".readiness-item input").first.check()
    assert "1 of 7" in page.locator("[data-checklist-result]").inner_text()
    page.evaluate("window.scrollTo(0, 0)")
    page.evaluate("document.activeElement && document.activeElement.blur()")
    page.add_style_tag(content="header.site{position:static!important}.skip-link{display:none!important}")
    page.screenshot(path=str(OUT / "checklist-desktop.png"), full_page=True)
    page.close()

    page = context.new_page()
    page.set_viewport_size({"width": 1280, "height": 900})
    page.emulate_media(color_scheme="light")
    page.goto(BASE + "/service-areas/atlantic-county.html", wait_until="networkidle")
    assert "Atlantic County" in (page.locator("h1").text_content() or "")
    assert page.locator(".town-list li").count() == 6
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path=str(OUT / "atlantic-county.png"), full_page=True)
    page.close()

    page = context.new_page()
    page.set_viewport_size({"width": 1280, "height": 900})
    page.emulate_media(color_scheme="dark")
    page.goto(BASE + "/#quote", wait_until="networkidle")
    form_card = page.locator(".form-card").first
    form_card.scroll_into_view_if_needed()
    page.wait_for_timeout(250)
    colors = form_card.evaluate("""card => {
      const input = card.querySelector('input');
      const heading = card.querySelector('h3');
      return {
        cardBackground: getComputedStyle(card).backgroundColor,
        inputBackground: getComputedStyle(input).backgroundColor,
        inputText: getComputedStyle(input).color,
        headingText: getComputedStyle(heading).color,
      };
    }""")
    assert colors["cardBackground"] == "rgb(16, 52, 76)", colors
    assert colors["inputBackground"] == "rgb(11, 41, 62)", colors
    assert colors["inputText"] == "rgb(237, 247, 252)", colors
    assert colors["headingText"] == "rgb(237, 247, 252)", colors
    quote_panel = page.locator(".as-quote-panel")
    if not quote_panel.is_visible():
        page.locator(".as-quote-launcher").click()
    assert quote_panel.is_visible()
    quote_colors = quote_panel.evaluate("""panel => {
      const input = panel.querySelector('.as-quote-input');
      return {
        panelBackground: getComputedStyle(panel).backgroundColor,
        inputBackground: getComputedStyle(input).backgroundColor,
        inputText: getComputedStyle(input).color,
      };
    }""")
    assert quote_colors["panelBackground"] == "rgb(16, 52, 76)", quote_colors
    assert quote_colors["inputBackground"] == "rgb(11, 41, 62)", quote_colors
    assert quote_colors["inputText"] == "rgb(237, 247, 252)", quote_colors
    page.screenshot(path=str(OUT / "home-dark-form.png"), full_page=False)
    page.close()

    page = context.new_page()
    page.set_viewport_size({"width": 390, "height": 844})
    page.emulate_media(color_scheme="light")
    submitted = []
    page.route("**/api/campaign-estimate", lambda route: (
        submitted.append(route.request.post_data_json),
        route.fulfill(
        status=202,
        content_type="application/json",
        body='{"accepted":true,"estimateUrl":"http://127.0.0.1:3000/roof-estimate/22222222-2222-4222-8222-222222222222"}',
    ))[-1])
    page.goto(BASE, wait_until="networkidle")
    launcher = page.locator(".as-quote-launcher")
    launcher.wait_for(state="visible")
    assert launcher.locator("img[src='/assets/all-season-sun.svg']").is_visible()
    assert launcher.inner_text() == ""
    launcher_size = launcher.evaluate("button => ({width: button.offsetWidth, height: button.offsetHeight})")
    assert launcher_size == {"width": 96, "height": 96}
    assert launcher.locator("img").evaluate("mark => getComputedStyle(mark).animationDuration") == "12s"
    assert launcher.get_attribute("aria-expanded") == "false"
    panel = page.locator(".as-quote-panel")
    assert panel.is_hidden()
    hero_midpoint = page.locator(".home-hero").evaluate("hero => hero.offsetTop + hero.offsetHeight / 2")
    page.evaluate("y => window.scrollTo(0, y - 10)", hero_midpoint)
    panel.wait_for(state="visible")
    assert panel.is_visible()
    assert page.locator(".as-quote-root").get_attribute("data-trigger") == "scroll_50"
    assert page.locator("#as-quote-name").evaluate("input => document.activeElement !== input")
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.locator(".as-quote-close").click()
    assert panel.is_hidden()
    launcher.click()
    assert page.locator(".as-quote-root").get_attribute("data-trigger") == "sun_click"
    page.wait_for_function("document.activeElement && document.activeElement.id === 'as-quote-name'")
    page.locator("#as-quote-name").fill("Alex Rivera")
    page.locator("#as-quote-email").fill("alex@example.com")
    page.locator("#as-quote-phone").fill("201-555-0100")
    page.locator("#as-quote-address_line_1").fill("1 Main St")
    page.locator("#as-quote-address_line_2").fill("Unit 2")
    page.locator("#as-quote-city").fill("Newark")
    page.locator("#as-quote-postal_code").fill("07102")
    panel.locator("input[name='consent_to_process_property']").check()
    panel.locator("input[name='consent_to_contact']").check()
    panel.locator("button[type='submit']").click()
    page.wait_for_url("**/roof-estimate/22222222-2222-4222-8222-222222222222")
    assert len(submitted) == 1
    assert submitted[0]["campaign"] is None
    assert submitted[0]["entry_point"] == "main-drawer"
    assert submitted[0]["presentation_key"] == "all-season-main"
    assert submitted[0]["address_line_1"] == "1 Main St"
    assert submitted[0]["address_line_2"] == "Unit 2"
    assert submitted[0]["city"] == "Newark"
    assert submitted[0]["state"] == "NJ"
    assert submitted[0]["postal_code"] == "07102"
    assert submitted[0]["consent_to_contact"] is True
    page.close()

    entry_points = [
        ("homepage", "/", "main-home", "all-season-main", None, "embedded"),
        ("contact", "/contact.html", "main-contact", "all-season-main", None, "embedded"),
        ("quote-drawer", "/", "main-drawer", "all-season-main", None, "drawer"),
        (
            "weather-report",
            "/campaigns/weather-report",
            "campaign:weather-report",
            "weather-report",
            "weather-report",
            "campaign",
        ),
        (
            "seasonal-shield",
            "/campaigns/seasonal-shield",
            "campaign:seasonal-shield",
            "seasonal-shield",
            "seasonal-shield",
            "campaign",
        ),
        (
            "for-every-season",
            "/campaigns/for-every-season",
            "campaign:for-every-season",
            "for-every-season",
            "for-every-season",
            "campaign",
        ),
    ]

    def assert_submission_contract(payload, expected_entry, presentation, campaign):
        assert payload["entry_point"] == expected_entry, payload
        assert payload["presentation_key"] == presentation, payload
        assert payload["campaign"] == campaign, payload
        assert payload["consent_to_process_property"] is True, payload
        assert payload["consent_to_contact"] is True, payload
        forbidden = {
            "latitude",
            "longitude",
            "lat",
            "lng",
            "coordinates",
            "public_token",
            "continuation",
            "capability",
        }
        assert forbidden.isdisjoint(payload), (forbidden.intersection(payload), payload)

    def intercept_canonical_submission(page, presentation, captured):
        continuation = (
            ASSESSMENT_BASE
            + "/roof-estimate/dev-assessment?imagery=ready&presentation="
            + presentation
        )

        def fulfill_submission(route):
            captured.append(route.request.post_data_json)
            route.fulfill(
                status=202,
                content_type="application/json",
                body=json.dumps({"accepted": True, "estimateUrl": continuation}),
            )

        page.route("**/api/campaign-estimate", fulfill_submission)
        return continuation

    def fill_embedded_form(page):
        form = page.locator("#leadForm")
        form.locator("[name=name]").fill("Entry Matrix Homeowner")
        form.locator("[name=email]").fill("entry-matrix@example.com")
        form.locator("[name=phone]").fill("201-555-0110")
        form.locator("[name=address_line_1]").fill("18 Harbor View Drive")
        form.locator("[name=city]").fill("Red Bank")
        form.locator("[name=postal_code]").fill("07701")
        form.locator("[name=consent_to_process_property]").check()
        form.locator("[name=consent_to_contact]").check()
        form.locator("button[type=submit]").click()

    def fill_drawer_form(page):
        page.locator(".as-quote-launcher").click()
        panel = page.locator(".as-quote-panel")
        panel.wait_for(state="visible")
        values = {
            "#as-quote-name": "Entry Matrix Homeowner",
            "#as-quote-email": "entry-matrix@example.com",
            "#as-quote-phone": "201-555-0110",
            "#as-quote-address_line_1": "18 Harbor View Drive",
            "#as-quote-city": "Red Bank",
            "#as-quote-postal_code": "07701",
        }
        for selector, value in values.items():
            page.locator(selector).fill(value)
        panel.locator("[name=consent_to_process_property]").check()
        panel.locator("[name=consent_to_contact]").check()
        panel.locator("button[type=submit]").click()

    def fill_campaign_form(page):
        page.route(
            "**/api/address-autocomplete",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=(
                    '{"suggestions":[{"placeId":"ChIJ-task-six-fake-place",'
                    '"address":"18 Harbor View Drive, Red Bank, NJ 07701"}]}'
                ),
            ),
        )
        form = page.locator(".campaign-form")
        address = form.get_by_role("combobox")
        address.fill("18 Harbor View")
        form.get_by_role(
            "option", name="18 Harbor View Drive, Red Bank, NJ 07701"
        ).wait_for(state="visible")
        form.get_by_role(
            "option", name="18 Harbor View Drive, Red Bank, NJ 07701"
        ).click()
        form.get_by_role("button", name=re.compile("Continue to your details")).click()
        form.locator("[name=name]").fill("Entry Matrix Homeowner")
        form.locator("[name=email]").fill("entry-matrix@example.com")
        form.locator("[name=phone]").fill("201-555-0110")
        form.locator("[name=consent_to_process_property]").check()
        form.locator("[name=consent_to_contact]").check()
        form.locator("button[type=submit]").click()

    for label, path, expected_entry, presentation, campaign, form_kind in entry_points:
        page = context.new_page()
        page.set_viewport_size({"width": 390, "height": 844})
        page.emulate_media(color_scheme="light", reduced_motion="reduce")
        captured = []
        continuation = intercept_canonical_submission(page, presentation, captured)
        page.goto(BASE + path, wait_until="networkidle")
        if form_kind == "embedded":
            fill_embedded_form(page)
        elif form_kind == "drawer":
            fill_drawer_form(page)
        else:
            fill_campaign_form(page)
        page.wait_for_url(continuation, timeout=10_000)
        page.get_by_role("heading", name="Analyzing your property.").wait_for(
            state="visible"
        )
        assert len(captured) == 1, (label, captured)
        assert_submission_contract(captured[0], expected_entry, presentation, campaign)
        if form_kind == "campaign":
            assert captured[0]["google_place_id"] == "ChIJ-task-six-fake-place"
            assert "address_line_1" not in captured[0]
        else:
            assert captured[0]["google_place_id"] is None
        page.close()

    page = context.new_page()
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(ASSESSMENT_BASE + "/roof-estimate", wait_until="networkidle")
    piw_form = page.get_by_role("form", name="Roof estimate request")
    assert piw_form.is_visible()
    assert piw_form.locator(
        "[name=latitude], [name=longitude], [name=lat], [name=lng], [name=coordinates]"
    ).count() == 0
    assert piw_form.locator("[name=addressMode]").count() == 1
    page.close()

    def assessment_page(width, height, path="/roof-estimate/dev-assessment"):
        page = context.new_page()
        page.set_viewport_size({"width": width, "height": height})
        page.emulate_media(color_scheme="light", reduced_motion="reduce")
        page.on("console", lambda msg: errors.append(f"console: {msg.text}") if msg.type == "error" and not msg.text.startswith("Failed to load resource") else None)
        page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
        page.goto(ASSESSMENT_BASE + path, wait_until="networkidle")
        return page

    def assert_question_action_fits(page, viewport_name, step):
        metrics = page.evaluate("""() => {
          const action = document.querySelector('.assessment-question-actions');
          return {
            scrollHeight: document.documentElement.scrollHeight,
            innerHeight: window.innerHeight,
            actionBottom: action ? action.getBoundingClientRect().bottom : null,
            actionTop: action ? action.getBoundingClientRect().top : null,
          };
        }""")
        assert metrics["scrollHeight"] <= metrics["innerHeight"], (viewport_name, step, metrics)
        assert metrics["actionBottom"] is not None, (viewport_name, step, metrics)
        assert metrics["actionTop"] >= 0, (viewport_name, step, metrics)
        assert metrics["actionBottom"] <= metrics["innerHeight"], (viewport_name, step, metrics)

    viewports = [
        ("320x568", 320, 568),
        ("375x667", 375, 667),
        ("390x844", 390, 844),
        ("768x1024", 768, 1024),
        ("1440x900", 1440, 900),
    ]
    requested_viewport = os.environ.get("ONLY_ASSESSMENT_VIEWPORT")
    if requested_viewport:
        viewports = [item for item in viewports if item[0] == requested_viewport]
    for viewport_name, width, height in viewports:
        page = assessment_page(width, height)
        page.get_by_role("heading", name="Analyzing your property.").wait_for(state="visible")
        if viewport_name == "390x844":
            page.screenshot(path=str(OUT / "assessment-loader.png"), full_page=False)
        start_button = page.get_by_role("button", name="Start my assessment")
        start_button.wait_for(state="visible", timeout=15_000)
        if viewport_name == "390x844":
            page.screenshot(path=str(OUT / "assessment-property-confirmation.png"), full_page=False)
        start_button.click()
        page.locator(".assessment-question-actions").wait_for(state="visible")

        for step in range(9):
            assert_question_action_fits(page, viewport_name, step)
            if viewport_name == "390x844" and step == 0:
                page.screenshot(path=str(OUT / "assessment-single-question.png"), full_page=False)
            if viewport_name == "390x844" and step == 2:
                page.screenshot(path=str(OUT / "assessment-multi-question.png"), full_page=False)

            options = page.locator(".assessment-answer-scroll .assessment-option")
            options.first.click()
            action = page.locator(".assessment-question-actions .assessment-primary-action")
            if action.is_disabled():
                options = page.locator(".assessment-answer-scroll .assessment-option")
                for option_index in range(1, options.count()):
                    options.nth(option_index).click()
                    if not action.is_disabled():
                        break
            assert not action.is_disabled(), (viewport_name, step)
            assert_question_action_fits(page, viewport_name, step)
            action.click()
            if step < 8:
                page.get_by_role("progressbar").wait_for(state="visible")
                page.wait_for_function(
                    "expected => Number(document.querySelector('[role=progressbar]').getAttribute('aria-valuenow')) === expected",
                    arg=step + 2,
                )
        page.get_by_role("heading", name="Your property-specific project outlook").wait_for(state="visible")
        page.close()

    for state, heading in [
        ("ready", "Preliminary project range"),
        ("pending", "Finalizing your property calculation"),
        ("review_required", "A professional is reviewing the property"),
    ]:
        page = assessment_page(
            390,
            844,
            f"/roof-estimate/dev-assessment?result={state}&presentation=weather-report",
        )
        page.get_by_text(heading, exact=True).wait_for(state="visible")
        if state != "ready":
            assert page.get_by_text("$18,000", exact=True).count() == 0
        page.screenshot(path=str(OUT / f"assessment-result-{state}.png"), full_page=True)
        page.close()

    page = assessment_page(
        390,
        844,
        "/roof-estimate/dev-assessment?result=pending&consultation=success",
    )
    page.get_by_role("button", name="Review my roof with a specialist").click()
    page.get_by_role("group", name="How should we follow up?").wait_for(state="visible")
    page.screenshot(path=str(OUT / "assessment-consultation-choices.png"), full_page=True)
    page.get_by_role("radio", name="Text me").check()
    page.get_by_role("button", name="Request my consultation").click()
    page.get_by_text("Preference saved", exact=True).wait_for(state="visible")
    page.screenshot(path=str(OUT / "assessment-consultation-success.png"), full_page=True)
    page.close()

    page = assessment_page(
        390,
        844,
        "/roof-estimate/dev-assessment?result=review_required&consultation=error",
    )
    page.get_by_role("button", name="Review my roof with a specialist").click()
    email = page.get_by_role("radio", name="Email me")
    email.check()
    page.get_by_role("button", name="Request my consultation").click()
    page.get_by_text("We could not save your preference. Please try again.", exact=True).wait_for(state="visible")
    assert email.is_checked()
    page.screenshot(path=str(OUT / "assessment-consultation-error.png"), full_page=True)
    page.close()
    browser.close()

if errors:
    raise AssertionError("Browser errors: " + " | ".join(errors))
print(f"Visual checks passed. Screenshots: {OUT}")
