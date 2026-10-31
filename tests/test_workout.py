"""Режим «Тренировка»: подходы пишутся сразу, прерванную можно продолжить, записи не теряются."""

import json
import re

import pytest
from conftest import DIST, ROOT
from playwright.sync_api import expect

PROGRAM = "sila-novichok-2-raza"  # день 1: гоблет, жим штанги, тяга, жим сидя, планка, по 3 подхода
NAMES = json.loads((ROOT / "tests" / "data" / "issued-names.json").read_text(encoding="utf-8"))


def open_with(page, program=PROGRAM):
    page.add_init_script(f"localStorage.setItem('my-program', '{program}')")
    page.goto("trenirovka/")


@pytest.fixture
def day(page):
    open_with(page)
    expect(page.get_by_test_id("start-workout")).to_be_visible()
    return page


@pytest.fixture
def work(day):
    day.get_by_test_id("start-workout").click()
    expect(day.get_by_test_id("set-pos")).to_have_text("Подход 1 из 3")
    return day


def done(page, n=1):
    start = page.get_by_test_id("set-chip").count()
    for k in range(n):
        page.get_by_test_id("set-done").click()
        page.get_by_test_id("rest-skip").click()  # таймер проверяет test_rest.py
        if start + k + 1 < 3:
            expect(page.get_by_test_id("set-pos")).to_have_text(f"Подход {start + k + 2} из 3")


def stored(page):
    return page.evaluate("""() => new Promise((ok, no) => {
        const r = indexedDB.open('trenirovki');
        r.onerror = no;
        r.onsuccess = () => {
            const q = r.result.transaction('workouts').objectStore('workouts').getAll();
            q.onsuccess = () => { r.result.close(); ok(q.result); };
        };
    })""")


def test_no_program_leads_to_programs(page, page_problems):
    page.goto("trenirovka/")
    expect(page.get_by_test_id("no-program")).to_be_visible()
    expect(page.get_by_test_id("to-programs")).to_be_visible()
    assert page_problems == []


def test_unknown_program_is_like_none(page):
    open_with(page, "net-takoj")
    expect(page.get_by_test_id("no-program")).to_be_visible()


def test_day_screen_has_warning_and_diary(day):
    expect(day.get_by_test_id("care-note")).to_be_visible()
    expect(day.get_by_test_id("open-diary")).to_be_visible()
    expect(day.get_by_test_id("other-day")).to_have_count(1)


def test_menu_opens_workout(page):
    page.goto("./")
    page.get_by_test_id("tabbar").get_by_text("Тренировка").click()
    expect(page.get_by_test_id("no-program")).to_be_visible()


def test_set_survives_reload(work):
    work.get_by_test_id("set-weight").fill("17,5")
    work.get_by_test_id("set-reps-plus").click()
    done(work)
    work.reload()
    expect(work.get_by_test_id("resume")).to_contain_text("подходов: 1")
    work.get_by_test_id("resume-continue").click()
    expect(work.get_by_test_id("set-chip").first).to_contain_text("17,5 кг × 7")


def test_next_set_takes_previous_values(work):
    work.get_by_test_id("set-weight").fill("30")
    done(work)
    expect(work.get_by_test_id("set-weight")).to_have_value("30")


def test_resume_after_technique(work):
    done(work)
    work.get_by_test_id("technique").click()
    expect(work).to_have_url(re.compile("/uprazhneniya/"))
    work.go_back()
    work.get_by_test_id("resume-continue").click()
    expect(work.get_by_test_id("set-pos")).to_have_text("Подход 2 из 3")


def test_exit_keeps_workout(work):
    done(work)
    work.get_by_test_id("workout-exit").click()
    expect(work.get_by_test_id("resume")).to_be_visible()
    expect(work.get_by_test_id("start-workout")).to_have_count(0)


def test_fix_set_in_workout(work):
    done(work)
    work.get_by_test_id("set-chip").first.click()
    work.get_by_test_id("set-weight").fill("99")
    work.get_by_test_id("set-done").click()
    expect(work.get_by_test_id("set-chip").first).to_contain_text("99 кг")
    assert stored(work)[0]["items"][0]["sets"][0]["weight"] == 99


def test_skip_and_full_workout_to_summary(work):
    done(work, 3)  # гоблет
    expect(work.get_by_test_id("exercise-pos")).to_have_text("Упражнение 2 из 5")
    work.get_by_test_id("skip-exercise").click()
    expect(work.get_by_test_id("exercise-pos")).to_have_text("Упражнение 3 из 5")
    for _ in range(2):
        pos = work.get_by_test_id("exercise-pos").inner_text()
        done(work, 3)
        expect(work.get_by_test_id("exercise-pos")).not_to_have_text(pos)
    # Планка: только секунды, и последний подход ведёт сразу в итог.
    expect(work.get_by_test_id("set-seconds")).to_be_visible()
    expect(work.get_by_test_id("set-weight")).to_have_count(0)
    done(work, 2)
    expect(work.get_by_test_id("set-done")).to_have_text("Готово и в итог")
    work.get_by_test_id("set-done").click()
    expect(work.get_by_test_id("summary")).to_contain_text("12 из 15")
    expect(work.get_by_test_id("summary-skipped")).to_contain_text("Жим штанги лёжа")
    expect(work.get_by_test_id("file-reminder")).to_be_visible()
    workout = stored(work)[0]
    assert workout["finishedAt"]
    assert workout["items"][1]["skipped"] is True


def test_empty_workout_is_not_saved(work):
    work.get_by_test_id("finish-workout").click()
    work.get_by_test_id("finish-confirm").click()
    expect(work.get_by_test_id("start-workout")).to_be_visible()
    assert stored(work) == []


def finish_early(page):
    page.get_by_test_id("finish-workout").click()
    page.get_by_test_id("finish-confirm").click()
    expect(page.get_by_test_id("summary")).to_be_visible()


def test_next_day_goes_round(work):
    done(work)
    finish_early(work)
    work.goto("trenirovka/")
    expect(work.get_by_role("heading", name="День 2", exact=True)).to_be_visible()
    work.get_by_test_id("start-workout").click()
    expect(work.get_by_test_id("exercise-name")).to_have_text("Ягодичный мост со штангой")
    done(work)
    finish_early(work)
    work.goto("trenirovka/")
    expect(work.get_by_role("heading", name="День 1", exact=True)).to_be_visible()


def test_last_time_comes_from_another_program(work):
    work.get_by_test_id("set-weight").fill("22,5")
    done(work)
    finish_early(work)
    other = "massa-novichok-2-raza"
    days = json.loads((ROOT / "src" / "content" / "programs" / f"{other}.json").read_text(encoding="utf-8"))["days"]
    day = next(k for k, d in enumerate(days) if any(i["exercise"] == "goblet-prisedaniya" for i in d["items"]))
    work.add_init_script(f"localStorage.setItem('my-program', '{other}')")  # позже первого, значит важнее
    work.goto("trenirovka/")
    if day > 0:
        work.get_by_test_id("other-day").nth(day - 1).click()
    work.get_by_test_id("start-workout").click()
    while work.get_by_test_id("exercise-name").inner_text() != "Гоблет-приседания с гантелью":
        work.get_by_test_id("skip-exercise").click()
        work.wait_for_timeout(50)
    expect(work.get_by_test_id("last-time")).to_contain_text("22,5 кг × 6")
    expect(work.get_by_test_id("set-weight")).to_have_value("22,5")


def test_failed_save_shows_message_and_keeps_numbers(work):
    work.get_by_test_id("set-weight").fill("33")
    work.evaluate("() => { IDBObjectStore.prototype.put = () => { throw new Error('нет места'); }; }")
    work.get_by_test_id("set-done").click()
    expect(work.get_by_test_id("save-error")).to_be_visible()
    expect(work.get_by_test_id("set-chip")).to_have_count(0)
    expect(work.get_by_test_id("set-weight")).to_have_value("33")


def test_storage_closed_says_so(page):
    page.add_init_script("Object.defineProperty(window, 'indexedDB', { get() { throw new Error('closed'); } })")
    open_with(page)
    expect(page.get_by_test_id("storage-error")).to_be_visible()


def test_resume_shows_skipped_exercise(work):
    work.get_by_test_id("skip-exercise").click()
    done(work)
    work.reload()
    rows = work.get_by_test_id("resume").get_by_test_id("route-row")
    expect(rows.nth(0)).to_contain_text("Пропущено")
    expect(rows.nth(1)).to_contain_text("Подходов: 1 из 3")
    assert work.locator(".segs i:not(.off)").count() == 0


def test_works_without_network(page, context):
    open_with(page)
    page.evaluate("navigator.serviceWorker.ready")
    page.wait_for_function("navigator.serviceWorker.controller !== null")
    context.set_offline(True)
    page.reload()
    page.get_by_test_id("start-workout").click()
    done(page)
    page.reload()
    expect(page.get_by_test_id("resume")).to_contain_text("подходов: 1")


@pytest.mark.parametrize("name", NAMES["programs"])
def test_all_programs_open(page, name):
    open_with(page, name)
    page.get_by_test_id("start-workout").click()
    expect(page.get_by_test_id("set-pos")).to_have_text(re.compile("^Подход 1 из"))
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def test_band_exercise_asks_only_reps(page):
    open_with(page, "doma-massa-novichok-3-raza")
    page.get_by_test_id("start-workout").click()
    for _ in range(8):
        if not page.get_by_test_id("set-seconds").count():
            break
        page.get_by_test_id("skip-exercise").click()
    expect(page.get_by_test_id("set-weight")).to_have_count(0)
    expect(page.get_by_test_id("set-reps")).to_be_visible()


def test_double_tap_makes_one_set(work):
    work.get_by_test_id("set-done").dblclick(force=True)
    expect(work.get_by_test_id("rest")).to_be_visible()
    work.wait_for_timeout(600)
    expect(work.get_by_test_id("rest")).to_be_visible()
    assert len(stored(work)[0]["items"][0]["sets"]) == 1


def test_skip_on_last_exercise_asks_first(work):
    for _ in range(4):
        work.get_by_test_id("skip-exercise").click()
    expect(work.get_by_test_id("exercise-pos")).to_have_text("Упражнение 5 из 5")
    done(work)
    work.get_by_test_id("skip-exercise").click()
    expect(work.get_by_test_id("finish-confirm")).to_be_visible()
    work.get_by_test_id("finish-cancel").click()
    assert stored(work)[0]["finishedAt"] is None


def test_finish_days_later_keeps_real_duration(work):
    done(work)
    work.evaluate("""() => new Promise(ok => {
        const shift = iso => new Date(Date.parse(iso) - 3 * 864e5).toISOString();
        const r = indexedDB.open('trenirovki');
        r.onsuccess = () => {
            const store = r.result.transaction('workouts', 'readwrite').objectStore('workouts');
            store.getAll().onsuccess = ev => {
                const w = ev.target.result[0];
                w.startedAt = shift(w.startedAt);
                w.items[0].sets[0].doneAt = shift(w.items[0].sets[0].doneAt);
                store.put(w).onsuccess = () => { r.result.close(); ok(); };
            };
        };
    })""")
    work.reload()
    work.get_by_test_id("resume-finish").click()
    expect(work.get_by_test_id("summary")).to_contain_text("1 мин")


def test_old_format_sample_resumes(page):
    page.goto("dnevnik/")
    page.get_by_test_id("diary-file").set_input_files(ROOT / "tests" / "data" / "dnevnik-format-1.json")
    expect(page.get_by_test_id("file-result")).to_contain_text("добавлено 5")
    page.goto("trenirovka/")
    page.get_by_test_id("resume-continue").click()
    page.get_by_test_id("prev-exercise").click()
    page.get_by_test_id("prev-exercise").click()
    expect(page.get_by_test_id("set-tile")).to_contain_text("6–8 повторов")
    expect(page.get_by_test_id("set-tile")).not_to_contain_text("повторов повторов")


def test_failed_finish_is_said_on_day_screen(work):
    done(work)
    work.get_by_test_id("workout-exit").click()
    work.evaluate("() => { IDBObjectStore.prototype.put = () => { throw new Error('нет места'); }; }")
    work.get_by_test_id("resume-finish").click()
    expect(work.get_by_test_id("save-error")).to_contain_text("Не получилось сохранить")


@pytest.mark.parametrize("kind", ["programs", "exercises"])
def test_issued_names_stay(kind):
    folder = ROOT / "src" / "content" / kind
    assert set(NAMES[kind]) <= {f.stem for f in folder.glob("*.json")}


def test_no_horizontal_scroll(work):
    fits = "document.documentElement.scrollWidth <= window.innerWidth"
    assert work.evaluate(fits)
    done(work)
    finish_early(work)
    assert work.evaluate(fits)


def test_closed_from_search():
    html = (DIST / "trenirovka" / "index.html").read_text(encoding="utf-8")
    assert 'name="robots" content="noindex"' in html
