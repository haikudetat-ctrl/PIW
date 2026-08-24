from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
OUT = Path("/tmp/all-season-visual-test")
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    errors = []
    for name, width, height in [("desktop", 1440, 1000), ("mobile", 390, 844)]:
        page = browser.new_page(viewport={"width": width, "height": height}, color_scheme="light")
        page.on("console", lambda msg: errors.append(f"console: {msg.text}") if msg.type == "error" else None)
        page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
        page.goto(BASE, wait_until="networkidle")
        page.locator("h1").wait_for(state="visible")
        assert "Roof and solar" in (page.locator("h1").text_content() or "")
        assert page.locator("header .logo img").is_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        assert page.evaluate("Array.from(document.images).every(img => img.complete && img.naturalWidth > 0)")
        for element in page.locator(".reveal").all():
            element.scroll_into_view_if_needed()
            page.wait_for_timeout(100)
        assert page.locator(".reveal:not(.is-visible)").count() == 0
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

    page = browser.new_page(viewport={"width": 1280, "height": 900}, color_scheme="light")
    page.goto(BASE + "/resources/nj-roof-solar-readiness-checklist.html", wait_until="networkidle")
    assert page.locator(".readiness-item").count() == 7
    page.locator(".readiness-item input").first.check()
    assert "1 of 7" in page.locator("[data-checklist-result]").inner_text()
    page.evaluate("window.scrollTo(0, 0)")
    page.evaluate("document.activeElement && document.activeElement.blur()")
    page.add_style_tag(content="header.site{position:static!important}.skip-link{display:none!important}")
    page.screenshot(path=str(OUT / "checklist-desktop.png"), full_page=True)
    page.close()

    page = browser.new_page(viewport={"width": 1280, "height": 900}, color_scheme="light")
    page.goto(BASE + "/service-areas/atlantic-county.html", wait_until="networkidle")
    assert "Atlantic County" in (page.locator("h1").text_content() or "")
    assert page.locator(".town-list li").count() == 6
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path=str(OUT / "atlantic-county.png"), full_page=True)
    page.close()

    page = browser.new_page(viewport={"width": 1280, "height": 900}, color_scheme="dark")
    page.goto(BASE + "/#quote", wait_until="networkidle")
    form_card = page.locator(".form-card").first
    form_card.scroll_into_view_if_needed()
    page.wait_for_timeout(250)
    colors = form_card.evaluate("""card => {
      const input = card.querySelector('input');
      const select = card.querySelector('select');
      const heading = card.querySelector('h3');
      return {
        cardBackground: getComputedStyle(card).backgroundColor,
        inputBackground: getComputedStyle(input).backgroundColor,
        inputText: getComputedStyle(input).color,
        selectBackground: getComputedStyle(select).backgroundColor,
        headingText: getComputedStyle(heading).color,
      };
    }""")
    assert colors["cardBackground"] == "rgb(16, 52, 76)", colors
    assert colors["inputBackground"] == "rgb(11, 41, 62)", colors
    assert colors["selectBackground"] == "rgb(11, 41, 62)", colors
    assert colors["inputText"] == "rgb(237, 247, 252)", colors
    assert colors["headingText"] == "rgb(237, 247, 252)", colors
    page.locator(".as-quote-launcher").click()
    quote_panel = page.locator(".as-quote-panel")
    assert quote_panel.is_visible()
    quote_colors = quote_panel.evaluate("""panel => {
      const input = panel.querySelector('.as-quote-input');
      const choice = panel.querySelector('.as-quote-choice span');
      return {
        panelBackground: getComputedStyle(panel).backgroundColor,
        inputBackground: getComputedStyle(input).backgroundColor,
        inputText: getComputedStyle(input).color,
        choiceBackground: getComputedStyle(choice).backgroundColor,
        choiceText: getComputedStyle(choice).color,
      };
    }""")
    assert quote_colors["panelBackground"] == "rgb(16, 52, 76)", quote_colors
    assert quote_colors["inputBackground"] == "rgb(11, 41, 62)", quote_colors
    assert quote_colors["inputText"] == "rgb(237, 247, 252)", quote_colors
    assert quote_colors["choiceText"] == "rgb(237, 247, 252)", quote_colors
    page.screenshot(path=str(OUT / "home-dark-form.png"), full_page=False)
    page.close()

    page = browser.new_page(viewport={"width": 390, "height": 844}, color_scheme="light")
    submitted = []
    page.route("**/api/intake", lambda route: (
        submitted.append(route.request.post_data_json),
        route.fulfill(
        status=200,
        content_type="application/json",
        body='{"accepted":true}',
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
    page.locator("#as-quote-address").fill("1 Main St, Newark, NJ")
    page.locator(".as-quote-choice", has_text="Both").click()
    panel.locator("input[name='consent_to_contact']").check()
    panel.locator("button[type='submit']").click()
    page.locator(".as-quote-success").wait_for(state="visible")
    assert page.locator(".as-quote-form").is_hidden()
    assert len(submitted) == 1
    assert submitted[0]["project_interest"] == "both"
    assert submitted[0]["consent_to_contact"] is True
    assert "your request is with our team" in page.locator(".as-quote-success").inner_text().lower()
    page.screenshot(path=str(OUT / "quote-mobile-light.png"), full_page=False)
    page.close()
    browser.close()

if errors:
    raise AssertionError("Browser errors: " + " | ".join(errors))
print(f"Visual checks passed. Screenshots: {OUT}")
