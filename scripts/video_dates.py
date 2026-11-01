"""Дописывает роликам дату публикации и длину со страницы YouTube: они нужны разметке VideoObject, в oEmbed их нет.

Запуск: .venv\\Scripts\\python scripts\\video_dates.py
Трогает только ролики без даты, поэтому после добавления нового ролика достаточно запустить ещё раз.
"""

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

EXERCISES = Path(__file__).resolve().parent.parent / "src" / "content" / "exercises"


def video_facts(video_id):
    request = urllib.request.Request(
        f"https://www.youtube.com/watch?v={video_id}",
        headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "ru"},
    )
    html = urllib.request.urlopen(request, timeout=30).read().decode("utf-8")
    uploaded = re.search(r'"uploadDate":"([^"]+)"', html)
    seconds = re.search(r'"lengthSeconds":"(\d+)"', html)
    if not uploaded or not seconds:
        raise ValueError("на странице нет даты или длины: открой ролик руками")
    return uploaded.group(1), int(seconds.group(1))


def main():
    known = {}
    failed = []
    for path in sorted(EXERCISES.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        changed = False
        for video in data["videos"]:
            if "uploaded" in video:
                continue
            video_id = video["id"]
            if video_id not in known:
                try:
                    known[video_id] = video_facts(video_id)
                except (OSError, ValueError) as error:
                    failed.append(f"{path.stem} {video_id}: {error}")
                    continue
                time.sleep(0.5)
            video["uploaded"], video["seconds"] = known[video_id]
            changed = True
        if changed:
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Роликов обновлено: {len(known)}")
    if failed:
        sys.exit("Не получилось:\n" + "\n".join(failed))


if __name__ == "__main__":
    main()
