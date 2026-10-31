"""Страница дневника: открывается, закрыта от поиска, на телефоне ничего не уезжает вбок."""

import pytest
from conftest import DIST
from playwright.sync_api import expect

HIDDEN_PAGES = ["/dnevnik/", "/trenirovka/"]


def test_opens_without_errors(page, page_problems):
    page.goto("dnevnik/")
    expect(page.get_by_test_id("diary-title")).to_have_text("Дневник")
    assert page_problems == []


def test_no_horizontal_scroll(page):
    page.goto("dnevnik/")
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def test_closed_from_search(page):
    page.goto("dnevnik/")
    expect(page.locator('meta[name="robots"]')).to_have_attribute("content", "noindex")


@pytest.mark.parametrize("path", HIDDEN_PAGES)
def test_not_in_sitemap(path):
    sitemaps = list(DIST.glob("sitemap-*.xml"))
    assert sitemaps
    assert not any(path in f.read_text(encoding="utf-8") for f in sitemaps)
