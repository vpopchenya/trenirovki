"""Страница «Как пользоваться»: открывается отовсюду, все снимки загружаются, вёрстка не шире экрана."""
import re

import pytest
from playwright.sync_api import expect


@pytest.mark.parametrize("width", [375, 768, 1280, 1920])
def test_guide_fits_and_images_load(page, page_problems, width):
    page.set_viewport_size({"width": width, "height": 812})
    page.goto("kak-polzovatsya/")
    expect(page.get_by_test_id("guide-title")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    shots = page.get_by_test_id("guide-shot")
    expect(shots).to_have_count(12)
    for shot in shots.all():
        shot.scroll_into_view_if_needed()
        expect(shot).to_have_js_property("complete", True)
        assert shot.evaluate("img => img.naturalWidth") == int(shot.get_attribute("width"))
        assert shot.evaluate("img => img.naturalHeight") == int(shot.get_attribute("height"))
    assert page_problems == []


def test_contents_lead_to_sections(page):
    page.goto("kak-polzovatsya/")
    for link in page.get_by_test_id("guide-toc").get_by_role("link").all():
        expect(page.locator(link.get_attribute("href"))).to_have_count(1)


def test_guide_linked_from_footer(page):
    page.goto("")
    page.get_by_test_id("guide-link").click()
    expect(page.get_by_test_id("guide-title")).to_be_visible()


def test_guide_linked_from_workout_day(page):
    page.add_init_script("localStorage.setItem('my-program', 'sila-novichok-2-raza')")
    page.goto("trenirovka/")
    page.get_by_test_id("workout-guide").click()
    expect(page).to_have_url(re.compile("kak-polzovatsya/#trenirovka$"))
