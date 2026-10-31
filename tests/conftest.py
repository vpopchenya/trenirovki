"""Общие настройки тестов: поднимаем собранный сайт на компьютере, тесты проверяют его, а не живой сайт."""

import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
BASE_PATH = "/trenirovki/"


class SiteHandler(SimpleHTTPRequestHandler):
    """Отдаёт dist/ по адресу /trenirovki/, как GitHub Pages: сайт собран под эту подпапку."""

    def translate_path(self, path):
        return super().translate_path(path.replace(BASE_PATH, "/", 1))

    def log_message(self, *args):
        pass


class SiteServer(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        pass  # браузер закрыл страницу посреди ответа: для тестов это не ошибка


@pytest.fixture(scope="session")
def base_url():
    """Адрес сайта на всё время тестов. Страницы открываем без начального слеша: page.goto("dnevnik/")."""
    if not (DIST / "sw.js").exists():
        pytest.exit("Нет собранного сайта: сначала npm run build", returncode=2)
    server = SiteServer(("127.0.0.1", 0), partial(SiteHandler, directory=str(DIST)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}{BASE_PATH}"
    server.shutdown()


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    """Сначала телефон: все тесты идут на ширине 375, как в техтребованиях."""
    return {**browser_context_args, "viewport": {"width": 375, "height": 667}, "locale": "ru-RU"}


@pytest.fixture
def page_problems(page):
    """Собирает ошибки страницы: консоль и ответы 4xx/5xx. Подписка ставится до page.goto, ловит и загрузку."""
    problems = []
    page.on("console", lambda msg: msg.type == "error" and problems.append(msg.text))
    page.on("pageerror", lambda err: problems.append(str(err)))
    page.on("response", lambda r: r.status >= 400 and problems.append(f"{r.status} {r.url}"))
    return problems
