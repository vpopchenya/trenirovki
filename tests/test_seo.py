"""SEO: проверяем готовые страницы из dist/, браузер не нужен."""

import json
import re
from collections import Counter
from functools import lru_cache
from html.parser import HTMLParser

from conftest import BASE_PATH, DIST

SITE = "https://vpopchenya.github.io"


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.title = ""
        self.description = self.canonical = self.lang = self.video_id = None
        self.noindex = False
        self.h1 = 0
        self.ld = []
        self._tag = None
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self._tag = tag
        if tag == "html":
            self.lang = a.get("lang")
        elif tag == "h1":
            self.h1 += 1
        elif a.get("data-testid") == "video":
            self.video_id = a.get("data-id")
        elif tag == "meta" and a.get("name") == "description":
            self.description = a.get("content")
        elif tag == "meta" and a.get("name") == "robots":
            self.noindex = "noindex" in a.get("content", "")
        elif tag == "link" and a.get("rel") == "canonical":
            self.canonical = a.get("href")
        elif tag == "script" and a.get("type") == "application/ld+json":
            self._tag = "ld"

    def handle_endtag(self, tag):
        self._tag = None

    def handle_data(self, data):
        if self._tag == "title":
            self.title += data
        elif self._tag == "ld":
            found = json.loads(data)
            self.ld += found if isinstance(found, list) else [found]


@lru_cache
def pages():
    found = {}
    for path in DIST.rglob("*.html"):
        url = SITE + BASE_PATH + path.relative_to(DIST).as_posix().removesuffix("index.html")
        found[url] = Page(path.read_text(encoding="utf-8"))
    return found


def indexed():
    return {url: page for url, page in pages().items() if not page.noindex}


def sitemap_urls():
    urls = set()
    for path in DIST.glob("sitemap-[0-9]*.xml"):
        urls |= set(re.findall(r"<loc>([^<]+)</loc>", path.read_text(encoding="utf-8")))
    return urls


def repeated(values):
    return [value for value, count in Counter(values).items() if count > 1]


def test_sitemap_lists_exactly_indexed_pages():
    assert sitemap_urls() == set(indexed())


def test_closed_pages_stay_closed():
    closed = {url.removeprefix(SITE + BASE_PATH) for url, page in pages().items() if page.noindex}
    assert {"dnevnik/", "trenirovka/", "404.html"} <= closed


def test_every_indexed_page_has_basics():
    for url, page in indexed().items():
        assert page.lang == "ru", url
        assert page.title.strip(), url
        assert page.description, url
        assert page.h1 == 1, url
        assert page.canonical == url, url


def test_titles_and_descriptions_are_unique():
    assert repeated(page.title for page in indexed().values()) == []
    assert repeated(page.description for page in indexed().values()) == []


def test_exercise_has_video_markup():
    exercises = {url: page for url, page in indexed().items() if "/uprazhneniya/" in url}
    assert exercises
    for url, page in exercises.items():
        videos = [item for item in page.ld if item["@type"] == "VideoObject"]
        assert len(videos) == 1, url
        video = videos[0]
        assert video["name"], url
        assert video["thumbnailUrl"].startswith("https://i.ytimg.com/vi/"), url
        assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d", video["uploadDate"]), url
        assert re.fullmatch(r"PT\d+S", video["duration"]), url
        assert video["embedUrl"] == f"https://www.youtube.com/embed/{page.video_id}", url
        assert any(item["@type"] == "BreadcrumbList" for item in page.ld), url
