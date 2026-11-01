"""Снимает экраны для страницы «Как пользоваться» в public/img/guide/. Приложение изменилось — запусти снова:
npm run build, затем .venv\\Scripts\\python scripts\\guide_screenshots.py. Записи — образец из tests/data, личных данных нет."""

import io
import sys
import threading
from functools import partial
from pathlib import Path

from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.append(str(ROOT / "tests"))
from conftest import BASE_PATH, DIST, SiteHandler, SiteServer  # noqa: E402

OUT = ROOT / "public" / "img" / "guide"
SAMPLE = ROOT / "tests" / "data" / "dnevnik-format-1.json"
PROGRAM = "sila-novichok-2-raza"  # по ней записи в образце: на экране подхода будет «В прошлый раз»
WIDTH, HEIGHT, DAY_HEIGHT, SCALE = 375, 720, 900, 2
WEBP_QUALITY = 72

# Настоящей кнопки установки в автоматическом браузере нет: подаём событие, которое присылает Chrome на телефоне.
FAKE_INSTALL = "const e = new Event('beforeinstallprompt'); e.prompt = async () => {}; dispatchEvent(e)"
# Тренировка в скрипте идёт секунды: сдвигаем начало, чтобы итог не показал «0 мин».
OLDER_START = """() => new Promise((ok, no) => {
  const r = indexedDB.open('trenirovki');
  r.onerror = no;
  r.onsuccess = () => {
    const store = r.result.transaction('workouts', 'readwrite').objectStore('workouts');
    const q = store.getAll();
    q.onsuccess = () => {
      const w = q.result.find(x => !x.finishedAt);
      w.startedAt = new Date(Date.now() - 47 * 60000).toISOString();
      store.put(w).onsuccess = () => { r.result.close(); ok(); };
    };
  };
})"""


# Для снимков: сообщение автоматического браузера людям на телефоне не покажется, меню заслоняет отдельные блоки.
HIDE_NO_WAKE = "[data-testid=no-wake] { display: none }"
HIDE_MENU = ".tabbar { display: none }"
HIDE_PREVIEW = "[data-testid=video] img { display: none }"  # превью чужого ролика заблокировано: без значка битой картинки


def save(png, name):
    Image.open(io.BytesIO(png)).convert("RGB").save(OUT / f"{name}.webp", quality=WEBP_QUALITY, method=6)
    print(f"{name}.webp: {(OUT / f'{name}.webp').stat().st_size // 1024} КБ")


def shot(page, name):
    page.evaluate("document.fonts.ready")
    page.wait_for_load_state("networkidle")
    save(page.screenshot(animations="disabled"), name)


def shot_of(page, test_id, name):
    page.evaluate("document.fonts.ready")
    page.add_style_tag(content=HIDE_MENU)
    save(page.get_by_test_id(test_id).screenshot(animations="disabled"), name)


def catalog(page):
    page.goto("")
    shot(page, "home")  # до снимка карточки: он прокручивает страницу
    page.evaluate(FAKE_INSTALL)
    shot_of(page, "install-card", "install")
    page.goto("myshcy/grud/")
    shot(page, "group")
    page.goto("uprazhneniya/zhim-shtangi-lezha/")
    page.add_style_tag(content=HIDE_PREVIEW)
    shot(page, "exercise")
    page.goto("programmy/")
    shot(page, "programs")
    page.goto(f"programmy/{PROGRAM}/")
    shot(page, "program")


def workout(page):
    page.evaluate(f"localStorage.setItem('my-program', '{PROGRAM}')")
    page.goto("dnevnik/")
    page.locator("#diary-file").set_input_files(SAMPLE)
    expect(page.get_by_test_id("workout-list")).to_be_visible()

    page.goto("trenirovka/")
    page.get_by_test_id("resume-finish").click()  # в образце есть незаконченная тренировка
    expect(page.get_by_test_id("summary")).to_be_visible()
    page.goto("trenirovka/")
    expect(page.get_by_test_id("start-workout")).to_be_visible()
    page.set_viewport_size({"width": WIDTH, "height": DAY_HEIGHT})  # кнопка «Начать» ниже списка упражнений
    shot(page, "day")
    page.set_viewport_size({"width": WIDTH, "height": HEIGHT})
    page.get_by_test_id("start-workout").click()
    expect(page.get_by_test_id("last-time")).to_be_visible()
    shot(page, "set")
    page.get_by_test_id("set-done").click()
    expect(page.get_by_test_id("rest")).to_be_visible()
    page.add_style_tag(content=HIDE_NO_WAKE)
    shot(page, "rest")

    page.evaluate(OLDER_START)
    summary, rest = page.get_by_test_id("summary"), page.get_by_test_id("rest-skip")
    rest.click()
    while not summary.is_visible():
        page.get_by_test_id("set-done").click()
        page.wait_for_timeout(500)  # кнопка гаснет после нажатия: защита от двойного касания
        if rest.is_visible():
            rest.click()
            page.wait_for_timeout(500)
    shot(page, "summary")

    page.goto("dnevnik/")
    expect(page.get_by_test_id("workout-list")).to_be_visible()
    shot_of(page, "workout-list", "diary")
    shot_of(page, "file-card", "diary-file")


def main():
    if not (DIST / "sw.js").exists():
        sys.exit("Нет собранного сайта: сначала npm run build")
    OUT.mkdir(parents=True, exist_ok=True)
    server = SiteServer(("127.0.0.1", 0), partial(SiteHandler, directory=str(DIST)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(
            base_url=f"http://127.0.0.1:{server.server_address[1]}{BASE_PATH}",
            viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=SCALE,
            locale="ru-RU", service_workers="block", reduced_motion="reduce",
        )
        context.route("**://i.ytimg.com/**", lambda route: route.abort())  # чужой кадр в наш репозиторий не кладём
        page = context.new_page()
        catalog(page)
        workout(page)
        browser.close()
    server.shutdown()


if __name__ == "__main__":
    main()
