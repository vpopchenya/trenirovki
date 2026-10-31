"""Входы в тренировку и история: кнопки у выбранной программы, «Твоя история», текст про дневник в «О проекте»."""

import pytest
from conftest import DIST
from playwright.sync_api import expect

PROGRAM = "sila-novichok-2-raza"
EXERCISE = "goblet-prisedaniya"


def workout(n, exercise=EXERCISE, finished=True, sets=1):
    """Запись дневника: n — день октября, чем больше, тем новее."""
    date = f"2026-10-{n:02d}T10:00:00.000Z"
    return {
        "id": f"w{n}", "programId": PROGRAM, "programName": "Сила", "dayIndex": 0, "dayName": "День 1",
        "startedAt": date, "finishedAt": date if finished else None, "updatedAt": date,
        "items": [{
            "exerciseId": exercise, "exerciseName": "Упражнение", "group": "legs", "fields": ["weight", "reps"],
            "weightLabel": "Вес одной гантели", "note": None, "plan": {"sets": 3, "reps": "6–8", "rest": "2 мин"},
            "skipped": False,
            "sets": [{"weight": 10 + n, "reps": 8, "seconds": None, "doneAt": date} for _ in range(sets)],
        }],
    }


def seed(page, workouts):
    """Страница дневника создаёт базу, потом кладём записи прямо в неё."""
    page.goto("dnevnik/")
    expect(page.get_by_test_id("diary-import")).to_be_visible()
    page.evaluate("""records => new Promise((ok, no) => {
        const r = indexedDB.open('trenirovki');
        r.onerror = no;
        r.onsuccess = () => {
            const tx = r.result.transaction('workouts', 'readwrite');
            records.forEach(x => tx.objectStore('workouts').put(x));
            tx.oncomplete = () => { r.result.close(); ok(); };
        };
    })""", workouts)


def test_program_page_starts_only_chosen(page):
    page.goto(f"programmy/{PROGRAM}/")
    start = page.get_by_test_id("start-workout-link")
    expect(start).to_be_hidden()
    page.get_by_test_id("my-program-btn").click()
    expect(start).to_be_visible()
    page.get_by_test_id("my-program-btn").click()
    expect(start).to_be_hidden()
    page.get_by_test_id("my-program-btn").click()
    start.click()
    expect(page.get_by_test_id("start-workout")).to_be_visible()


def test_other_program_has_no_start(page):
    page.add_init_script(f"localStorage.setItem('my-program', '{PROGRAM}')")
    page.goto("programmy/massa-novichok-2-raza/")
    expect(page.get_by_test_id("start-workout-link")).to_be_hidden()


def test_home_card_starts_and_opens_program(page):
    page.add_init_script(f"localStorage.setItem('my-program', '{PROGRAM}')")
    page.goto("")
    link = page.get_by_test_id("home-my-program-link")
    expect(link).to_have_attribute("href", f"/trenirovki/programmy/{PROGRAM}/")
    page.get_by_test_id("home-start-workout").click()
    expect(page.get_by_test_id("start-workout")).to_be_visible()


def test_home_without_program_has_no_card(page):
    page.goto("")
    expect(page.get_by_test_id("home-my-program")).to_be_hidden()


def test_no_records_no_history(page, page_problems):
    page.goto(f"uprazhneniya/{EXERCISE}/")
    expect(page.get_by_test_id("exercise-title")).to_be_visible()
    page.wait_for_timeout(200)
    expect(page.get_by_test_id("exercise-history")).to_have_count(0)
    assert [p for p in page_problems if "ytimg" not in p] == []


def test_history_shows_last_five_newest_first(page):
    seed(page, [workout(n) for n in range(1, 8)])
    page.goto(f"uprazhneniya/{EXERCISE}/")
    rows = page.get_by_test_id("history-row")
    expect(rows).to_have_count(5)
    expect(rows.first).to_contain_text("7 октября")
    expect(rows.first).to_contain_text("17 кг × 8")
    expect(rows.last).to_contain_text("3 октября")


def test_history_groups_sets_of_one_workout(page):
    seed(page, [workout(5, sets=3)])
    page.goto(f"uprazhneniya/{EXERCISE}/")
    expect(page.get_by_test_id("history-row")).to_contain_text("15 кг × 8, 8, 8")


def test_history_skips_unfinished_and_other_exercises(page):
    seed(page, [workout(1, finished=False), workout(2, exercise="zhim-shtangi-lezha"), workout(3, sets=0)])
    page.goto(f"uprazhneniya/{EXERCISE}/")
    page.wait_for_timeout(200)
    expect(page.get_by_test_id("exercise-history")).to_have_count(0)


def test_history_is_not_in_page_for_search():
    assert "Твоя история" not in (DIST / "uprazhneniya" / EXERCISE / "index.html").read_text(encoding="utf-8")


def test_closed_storage_keeps_exercise_page(page, page_problems):
    page.add_init_script("indexedDB.open = () => { throw new Error('закрыто'); }")
    page.goto(f"uprazhneniya/{EXERCISE}/")
    expect(page.get_by_test_id("steps")).to_be_visible()
    page.wait_for_timeout(200)
    expect(page.get_by_test_id("exercise-history")).to_have_count(0)
    assert [p for p in page_problems if "ytimg" not in p] == []


@pytest.mark.parametrize("text", ["только в этом браузере", "никуда не отправляются", "Удалить", "лежит он у тебя", "перенести"])
def test_about_explains_diary(page, text):
    page.goto("o-proekte/")
    expect(page.get_by_test_id("privacy-diary")).to_contain_text(text)
