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
    browser.close()

if errors:
    raise AssertionError("Browser errors: " + " | ".join(errors))
print(f"Visual checks passed. Screenshots: {OUT}")
