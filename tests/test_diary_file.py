"""Дневник: загрузка только добавляет, ошибка в файле не меняет записи, исправление и удаление доходят до базы."""

import json

import pytest
from conftest import ROOT
from playwright.sync_api import expect

# Образец первого формата храним навсегда: каждая новая версия обязана его открывать.
SAMPLE = ROOT / "tests" / "data" / "dnevnik-format-1.json"
WORKOUTS = 5


def load(page, path):
    page.get_by_test_id("diary-file").set_input_files(path)
    return expect(page.get_by_test_id("file-result"))


def rows(page):
    return page.get_by_test_id("workout-row")


def changed(tmp_path, change):
    data = json.loads(SAMPLE.read_text(encoding="utf-8"))
    change(data)
    path = tmp_path / "file.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


@pytest.fixture
def diary(page):
    page.goto("dnevnik/")
    expect(page.get_by_test_id("diary-empty")).to_be_visible()
    return page


@pytest.fixture
def filled(diary):
    load(diary, SAMPLE).to_contain_text("добавлено 5, уже были 0")
    expect(rows(diary)).to_have_count(WORKOUTS)
    return diary


def test_records_survive_reload(filled):
    filled.reload()
    expect(rows(filled)).to_have_count(WORKOUTS)


def test_same_file_twice_makes_no_duplicates(filled):
    load(filled, SAMPLE).to_contain_text("добавлено 0, уже были 5")
    expect(rows(filled)).to_have_count(WORKOUTS)


def test_later_record_wins(filled, tmp_path):
    def change(data):
        data["workouts"][0].update(updatedAt="2027-01-01T00:00:00.000Z", dayName="Новое имя")
        data["workouts"][1].update(updatedAt="2020-01-01T00:00:00.000Z", dayName="Старое имя")

    load(filled, changed(tmp_path, change)).to_contain_text("добавлено 0, обновлено 1, уже были 4")
    expect(filled.get_by_test_id("workout-list")).to_contain_text("Новое имя")
    expect(filled.get_by_test_id("workout-list")).not_to_contain_text("Старое имя")


def export(page, path):
    with page.expect_download() as download:
        page.get_by_test_id("diary-export").click()
    assert download.value.suggested_filename.startswith("trener-dnevnik-")
    download.value.save_as(path)
    return json.loads(path.read_text(encoding="utf-8"))


def test_save_clear_load_gives_same_data(filled, tmp_path):
    saved = tmp_path / "first.json"
    before = export(filled, saved)
    filled.get_by_test_id("clear-diary").click()
    filled.get_by_test_id("clear-confirm-yes").click()
    expect(filled.get_by_test_id("diary-empty")).to_be_visible()
    load(filled, saved).to_contain_text("добавлено 5")
    assert export(filled, tmp_path / "second.json")["workouts"] == before["workouts"]


def test_rest_comes_back_from_file(diary, tmp_path):
    rest = {"endsAt": "2026-10-20T18:30:00.000Z", "total": 90, "from": 0, "to": 1}
    load(diary, changed(tmp_path, lambda d: d["workouts"][-1].update(rest=rest))).to_contain_text("добавлено 5")
    saved = export(diary, tmp_path / "again.json")
    assert next(w for w in saved["workouts"] if not w["finishedAt"])["rest"] == rest


def test_unfinished_workout_is_shown(filled):
    expect(rows(filled).last).to_contain_text("не закончена")


BAD_FILES = {
    "не json": b"not json",
    "чужой": json.dumps({"app": "other", "format": 1, "workouts": []}).encode(),
    "массив": b"[]",
}


@pytest.mark.parametrize("content", BAD_FILES.values(), ids=BAD_FILES.keys())
def test_foreign_file_changes_nothing(filled, tmp_path, content):
    path = tmp_path / "file.json"
    path.write_bytes(content)
    load(filled, path).to_contain_text("ничего не изменилось")
    expect(rows(filled)).to_have_count(WORKOUTS)


DAMAGE = {
    "вес вне границ": lambda d: d["workouts"][-1]["items"][0]["sets"][0].update(weight=501),
    "вес текстом": lambda d: d["workouts"][-1]["items"][0]["sets"][0].update(weight="40"),
    "нет названия": lambda d: d["workouts"][-1]["items"][0].pop("exerciseName"),
    "нет id": lambda d: d["workouts"][-1].pop("id"),
    "группа с разметкой": lambda d: d["workouts"][-1]["items"][0].update(group="x);}"),
    "id для адреса": lambda d: d["workouts"][-1].update(id="50%"),
    "поле из прототипа": lambda d: d["workouts"][-1]["items"][0].update(fields=["toString"]),
    "поле вложенным списком": lambda d: d["workouts"][-1]["items"][0].update(fields=[["weight"]]),
    "подход без значений": lambda d: d["workouts"][-1]["items"][0]["sets"][0].update(weight=None, reps=None),
    "лишнее значение": lambda d: d["workouts"][-1]["items"][0]["sets"][0].update(seconds=30),
    "отдых за границей списка": lambda d: d["workouts"][-1].update(rest={"endsAt": "2026-10-20T18:30:00.000Z", "total": 90, "from": 0, "to": 99}),
    "дробные повторы": lambda d: d["workouts"][-1]["items"][0]["sets"][0].update(reps=8.5),
}


@pytest.mark.parametrize("damage", DAMAGE.values(), ids=DAMAGE.keys())
def test_damaged_record_blocks_whole_file(diary, tmp_path, damage):
    # Хорошие записи идут раньше плохой: не должна записаться даже часть файла.
    load(diary, changed(tmp_path, damage)).to_contain_text("ничего не изменилось")
    expect(diary.get_by_test_id("diary-empty")).to_be_visible()


def test_newer_format_changes_nothing(diary, tmp_path):
    load(diary, changed(tmp_path, lambda d: d.update(format=2))).to_contain_text("Обнови страницу")
    expect(diary.get_by_test_id("diary-empty")).to_be_visible()


def test_too_big_file_changes_nothing(diary, tmp_path):
    path = tmp_path / "big.json"
    path.write_bytes(b" " * (5 * 1024 * 1024 + 1))
    load(diary, path).to_contain_text("больше 5 МБ")


def test_text_from_file_is_not_markup(diary, tmp_path):
    bad = '<img src=x onerror="window.hacked=1">'
    load(diary, changed(tmp_path, lambda d: d["workouts"][-1].update(dayName=bad))).to_contain_text("добавлено 5")
    expect(diary.get_by_test_id("workout-list")).to_contain_text(bad)
    assert diary.evaluate("window.hacked") is None
    assert diary.locator("#diary img").count() == 0


def test_my_program_only_when_none_chosen(diary):
    diary.evaluate("localStorage.setItem('my-program', 'moya')")
    load(diary, SAMPLE).to_contain_text("добавлено 5")
    assert diary.evaluate("localStorage.getItem('my-program')") == "moya"
    diary.evaluate("localStorage.removeItem('my-program')")
    load(diary, SAMPLE).to_contain_text("уже были 5")
    diary.wait_for_function("localStorage.getItem('my-program') === 'sila-novichok-2-raza'")


def test_fix_set_stays_after_reload(filled):
    rows(filled).first.click()
    filled.get_by_test_id("set-row").first.click()
    filled.get_by_test_id("edit-weight").fill("17,5")
    filled.get_by_test_id("edit-reps-plus").click()
    filled.get_by_test_id("edit-save").click()
    expect(filled.get_by_test_id("set-row").first).to_contain_text("17,5 кг × 9")
    filled.reload()
    expect(filled.get_by_test_id("set-row").first).to_contain_text("17,5 кг × 9")


def test_broken_address_shows_list(filled):
    filled.goto(filled.url + "#%")
    filled.reload()
    expect(rows(filled)).to_have_count(WORKOUTS)


def test_edit_is_limited(filled):
    rows(filled).first.click()
    filled.get_by_test_id("set-row").first.click()
    filled.get_by_test_id("edit-weight").fill("600")
    filled.get_by_test_id("edit-save").click()
    expect(filled.get_by_test_id("set-row").first).to_contain_text("500 кг")


def test_delete_workout_needs_confirmation(filled):
    rows(filled).first.click()
    filled.get_by_test_id("delete-workout").click()
    filled.get_by_test_id("delete-cancel").click()
    filled.get_by_test_id("delete-workout").click()
    filled.get_by_test_id("delete-confirm").click()
    expect(rows(filled)).to_have_count(WORKOUTS - 1)


def test_clear_offers_file_first_and_can_be_cancelled(filled):
    filled.get_by_test_id("clear-diary").click()
    expect(filled.get_by_test_id("clear-save-first")).to_be_visible()
    filled.get_by_test_id("clear-cancel").click()
    expect(rows(filled)).to_have_count(WORKOUTS)


def test_reminder_goes_after_saving(filled):
    expect(filled.get_by_test_id("file-reminder")).to_be_visible()
    with filled.expect_download():
        filled.get_by_test_id("diary-export").click()
    expect(filled.get_by_test_id("file-reminder")).to_have_count(0)


def test_storage_closed_shows_message(page):
    page.add_init_script("Object.defineProperty(window, 'indexedDB', { get() { throw new Error('closed'); } })")
    page.goto("dnevnik/")
    expect(page.get_by_test_id("storage-error")).to_be_visible()


def test_records_survive_app_update(filled):
    # Обновление меняет только сохранённые страницы, база отдельно: снимаем service worker и кэш.
    filled.evaluate("""async () => {
        for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
        for (const k of await caches.keys()) await caches.delete(k);
    }""")
    filled.reload()
    expect(rows(filled)).to_have_count(WORKOUTS)


def test_no_horizontal_scroll_with_records(filled):
    assert filled.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    rows(filled).first.click()
    expect(filled.get_by_test_id("workout-exercise").first).to_be_visible()
    assert filled.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
