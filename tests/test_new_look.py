"""Новый мобильный вид: плитки групп, фильтры программ, вкладки дней, значки без интернета."""
import pytest
from playwright.sync_api import expect

PROGRAM = "massa-novichok-3-raza"
WIDTHS = [375, 768, 1280, 1920]
PAGES = ["", "programmy/", f"programmy/{PROGRAM}/", "myshcy/grud/", "uprazhneniya/zhim-shtangi-lezha/", "osnovy/", "trenirovka/"]


@pytest.mark.parametrize("width", WIDTHS)
@pytest.mark.parametrize("path", PAGES)
def test_no_side_scroll(page, path, width):
    page.set_viewport_size({"width": width, "height": 812})
    page.goto(path)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


@pytest.mark.parametrize("width", [*WIDTHS, 1024, 1100])
def test_group_numbers_in_order_and_inside_tile(page, width):
    page.set_viewport_size({"width": width, "height": 812})
    page.goto("")
    numbers = page.get_by_test_id("group-number")
    expect(numbers).to_have_text([str(n) for n in range(1, 8)])
    inside = page.evaluate("""[...document.querySelectorAll('.gcard')].every(card => {
      const c = card.getBoundingClientRect(), n = card.querySelector('.num').getBoundingClientRect();
      return n.left >= c.left && n.right <= c.right && n.top >= c.top && n.bottom <= c.bottom;
    })""")
    assert inside
    fits = page.evaluate("""[...document.querySelectorAll('.gcard .text > *')].every(x => x.scrollWidth <= x.clientWidth)""")
    assert fits


def test_picking_muscle_shows_exercise_count(page):
    page.goto("")
    page.evaluate("document.querySelector('.bodymap').dispatchEvent(new CustomEvent('pick', { detail: 'arms', bubbles: true }))")
    expect(page.get_by_test_id("picked-group")).to_contain_text("Руки")
    expect(page.get_by_test_id("picked-group")).to_contain_text("упражнений")


def test_program_filters(page):
    page.goto("programmy/")
    cards = page.get_by_test_id("program-card").locator("visible=true")
    count = page.get_by_test_id("program-count")
    expect(cards).to_have_count(16)
    expect(count).to_have_text("Программ: 16")

    page.get_by_test_id("filter-kind-nabor").click()
    expect(count).to_have_text("Программ: 6")
    page.get_by_test_id("filter-level").select_option("опытный")
    expect(count).to_have_text("Программ: 2")
    page.get_by_test_id("filter-days").select_option("2")
    expect(cards).to_have_count(1)

    page.get_by_test_id("filter-kind-home").click()
    expect(cards).to_have_count(0)
    expect(page.get_by_test_id("filter-empty")).to_be_visible()

    page.get_by_test_id("filter-kind-all").click()
    page.get_by_test_id("filter-level").select_option("")
    page.get_by_test_id("filter-days").select_option("")
    expect(cards).to_have_count(16)
    expect(page.get_by_test_id("filter-empty")).to_be_hidden()


def test_program_filter_survives_back(page):
    page.goto("programmy/")
    page.get_by_test_id("filter-kind-nabor").click()
    page.get_by_test_id("filter-level").select_option("опытный")
    expect(page.get_by_test_id("program-count")).to_have_text("Программ: 2")
    page.get_by_test_id("program-card").locator("visible=true").first.click()
    page.go_back()
    expect(page.get_by_test_id("program-count")).to_have_text("Программ: 2")
    expect(page.get_by_test_id("filter-kind-nabor")).to_have_attribute("aria-pressed", "true")


def test_program_day_tabs_remember_day(page):
    page.goto(f"programmy/{PROGRAM}/")
    days = page.get_by_test_id("program-day")
    expect(days.nth(0)).to_be_visible()
    expect(days.nth(1)).to_be_hidden()
    page.get_by_test_id("day-tab").nth(1).click()
    expect(days.nth(1)).to_be_visible()
    expect(days.nth(0)).to_be_hidden()
    days.nth(1).get_by_test_id("program-exercise").first.click()
    page.go_back()
    expect(page.get_by_test_id("program-day").nth(1)).to_be_visible()


def test_wide_screen_shows_all_days(page):
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(f"programmy/{PROGRAM}/")
    expect(page.get_by_test_id("day-tabs")).to_be_hidden()
    expect(page.get_by_test_id("program-day").nth(2)).to_be_visible()


def test_icons_are_kept_for_offline(page):
    page.goto("")
    page.evaluate("navigator.serviceWorker.ready")
    cached = page.evaluate("""(async () => {
      const keys = await caches.keys();
      const all = await Promise.all(keys.map(async k => (await (await caches.open(k)).keys()).map(r => r.url)));
      return all.flat();
    })()""")
    assert any("/img/m-chest.webp" in u for u in cached)
    assert any("/img/dumbbell.webp" in u for u in cached)
