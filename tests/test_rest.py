"""Таймер отдыха: идёт по часам, переживает уход со страницы, сигнал один раз."""

import re

import pytest
from playwright.sync_api import expect

PROGRAM = "sila-novichok-2-raza"  # гоблет: 3 подхода, отдых «2–3 мин», значит 3:00


@pytest.fixture
def rest(page):
    page.add_init_script(f"""
        localStorage.setItem('my-program', '{PROGRAM}');
        window.vibrated = 0;
        navigator.vibrate = () => {{ window.vibrated++; return true; }};
    """)
    page.clock.install()
    page.goto("trenirovka/")
    page.get_by_test_id("start-workout").click()
    page.get_by_test_id("set-done").click()
    expect(page.get_by_test_id("rest")).to_be_visible()
    page.clock.run_for(600)  # снимает защиту от двойного нажатия
    return page


def time_of(page):
    return page.get_by_test_id("rest-time")


def test_starts_from_upper_bound(rest):
    expect(time_of(rest)).to_have_text(re.compile("^(3:00|2:59)$"))
    expect(rest.get_by_test_id("rest-next")).to_contain_text("Подход 2 из 3")


def test_plus_and_minus(rest):
    rest.get_by_test_id("rest-plus").click()
    rest.clock.run_for(600)
    expect(time_of(rest)).to_have_text(re.compile("^3:1[45]$"))
    rest.get_by_test_id("rest-minus").click()
    rest.get_by_test_id("rest-minus").click()
    rest.clock.run_for(600)
    expect(time_of(rest)).to_have_text(re.compile("^2:[34][0-9]$"))  # 3:00 + 15 − 30, часы идут и сами


def test_skip_goes_to_next_set(rest):
    rest.get_by_test_id("rest-skip").click()
    expect(rest.get_by_test_id("set-pos")).to_have_text("Подход 2 из 3")


def test_clock_runs_by_time_not_ticks(rest):
    rest.clock.fast_forward("01:00")
    expect(time_of(rest)).to_have_text(re.compile("^(2:00|1:59|1:58)$"))


def test_end_gives_one_signal_and_saves_nothing(rest):
    rest.clock.fast_forward("03:40")
    rest.clock.run_for(1200)
    expect(rest.get_by_test_id("rest-label")).to_contain_text("закончился 0:4")
    expect(rest.get_by_test_id("rest-skip")).to_have_text("К подходу")
    expect(rest.get_by_test_id("rest-plus")).to_be_disabled()
    rest.clock.run_for(2000)
    assert rest.evaluate("window.vibrated") == 1
    rest.get_by_test_id("rest-skip").click()
    expect(rest.get_by_test_id("set-chip")).to_have_count(1)


def test_rest_survives_reload(rest):
    rest.clock.fast_forward("01:00")
    rest.reload()
    rest.get_by_test_id("resume-continue").click()
    expect(rest.get_by_test_id("rest")).to_be_visible()
    expect(time_of(rest)).to_have_text(re.compile("^(2:00|1:59|1:58)$"))


def test_expired_while_away_is_honest_and_silent(rest):
    rest.reload()
    rest.clock.fast_forward("04:00")
    rest.get_by_test_id("resume-continue").click()
    rest.clock.run_for(1000)
    expect(rest.get_by_test_id("rest-label")).to_contain_text("закончился")
    assert rest.evaluate("window.vibrated") == 0


def test_peek_lets_fix_set_and_timer_goes_on(rest):
    rest.get_by_test_id("rest-peek").click()
    expect(rest.get_by_test_id("rest-pill")).to_be_visible()
    rest.get_by_test_id("set-chip").first.click()
    rest.get_by_test_id("set-weight").fill("44")
    rest.get_by_test_id("set-done").click()
    expect(rest.get_by_test_id("rest")).to_be_visible()
    rest.get_by_test_id("rest-peek").click()
    expect(rest.get_by_test_id("set-chip").first).to_contain_text("44 кг")
    rest.get_by_test_id("rest-pill").click()
    expect(rest.get_by_test_id("rest")).to_be_visible()


def test_last_set_of_exercise_points_to_next_one(rest):
    for _ in range(2):
        rest.get_by_test_id("rest-skip").click()
        rest.get_by_test_id("set-done").click()
        expect(rest.get_by_test_id("rest")).to_be_visible()
        rest.clock.run_for(600)
    expect(rest.get_by_test_id("rest-next")).to_contain_text("Упражнение 2 из 5")
    rest.get_by_test_id("rest-peek").click()
    expect(rest.get_by_test_id("set-chip")).to_have_count(3)


def test_no_rest_after_last_set_of_workout(rest):
    rest.get_by_test_id("rest-skip").click()
    for _ in range(3):
        rest.get_by_test_id("skip-exercise").click()
    rest.get_by_test_id("skip-exercise").click()
    expect(rest.get_by_test_id("exercise-pos")).to_have_text("Упражнение 5 из 5")
    for _ in range(2):
        rest.get_by_test_id("set-done").click()
        rest.clock.run_for(600)
        rest.get_by_test_id("rest-skip").click()
    rest.clock.run_for(600)
    rest.get_by_test_id("set-done").click()
    expect(rest.get_by_test_id("summary")).to_be_visible()


def test_sound_choice_is_remembered(rest):
    rest.get_by_test_id("rest-sound").click()
    expect(rest.get_by_test_id("rest-sound")).to_have_attribute("aria-label", "Включить звук")
    rest.reload()
    rest.get_by_test_id("resume-continue").click()
    expect(rest.get_by_test_id("rest-sound")).to_have_attribute("aria-label", "Включить звук")


def test_says_when_screen_may_go_dark(page):
    page.add_init_script(f"""
        localStorage.setItem('my-program', '{PROGRAM}');
        delete Navigator.prototype.wakeLock;
    """)
    page.goto("trenirovka/")
    page.get_by_test_id("start-workout").click()
    page.get_by_test_id("set-done").click()
    expect(page.get_by_test_id("no-wake")).to_be_visible()


def test_no_horizontal_scroll(rest):
    assert rest.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def test_double_tap_on_skip_makes_no_set(rest):
    rest.get_by_test_id("rest-skip").dblclick(force=True)
    expect(rest.get_by_test_id("set-pos")).to_have_text("Подход 2 из 3")
    rest.wait_for_timeout(600)
    expect(rest.get_by_test_id("set-chip")).to_have_count(1)


def test_exit_from_peek_returns_to_rest(rest):
    rest.get_by_test_id("rest-peek").click()
    rest.get_by_test_id("workout-exit").click()
    rest.get_by_test_id("resume-continue").click()
    expect(rest.get_by_test_id("rest")).to_be_visible()


def test_expired_while_hidden_stays_silent(rest):
    hide = "hidden => { Object.defineProperty(document, 'hidden', { value: hidden, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }"
    rest.evaluate(hide, True)
    rest.clock.fast_forward("04:00")
    rest.clock.run_for(1000)
    rest.evaluate(hide, False)
    rest.clock.run_for(1000)
    expect(rest.get_by_test_id("rest-label")).to_contain_text("закончился")
    assert rest.evaluate("window.vibrated") == 0
