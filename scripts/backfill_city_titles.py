#!/usr/bin/env python3
"""從 cities 回應的 dump 補上每座城的 `title`（篇章標題，例如「集會遊行法」）。

⚠️ `title` 跟 `position` 不一樣：**position 是世界地圖的屬性、兩個變體共用，
title 卻是隨陣營而異的**（51 座城實測有 45 座紅軍與非紅軍不同，例如 city 2
非紅軍是「來客」、紅軍是「扮花臉」）。所以一份 dump 只能套用到抓它的那個帳號
所屬的變體，`--dataset` 必須明確指定，腳本不會替你猜。

⚠️ 原始的 cities dump **不要進版控**：裡面的 `control_name` 是其他玩家的工會名，
把整份存進來等於散佈別人的資料。這支腳本只取 `id` → `title` 這一組對應。

用法：
    python scripts/backfill_city_titles.py cities_red.json --dataset data/red_army --check
    python scripts/backfill_city_titles.py cities_red.json --dataset data/red_army
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# 後端用 "-" 表示沒有標題。
EMPTY_TITLES = {"", "-"}


def load_titles(dump: Path) -> dict[int, str]:
    raw = json.loads(dump.read_text(encoding="utf-8"))
    cities = raw.get("cities") if isinstance(raw, dict) else raw
    if not isinstance(cities, list):
        raise SystemExit(f"{dump} 不是 cities 回應的格式")
    out = {}
    for c in cities:
        title = (c.get("title") or "").strip()
        if c.get("id") is not None and title not in EMPTY_TITLES:
            out[c["id"]] = title
    return out


def write_json(path: Path, data: object) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def apply_to(root: Path, titles: dict[int, str], check: bool) -> tuple[int, int]:
    """回傳 (需要更新的筆數, 找不到 title 的筆數)。"""
    index_path = root / "index.json"
    if not index_path.is_file():
        raise SystemExit(f"找不到 {index_path}")
    index = json.loads(index_path.read_text(encoding="utf-8"))

    changed = missing = 0
    for row in index["cities"]:
        title = titles.get(row["city_id"])
        if not title:
            missing += 1
            print(f"  city={row['city_id']} {row.get('city_name')} 在 dump 裡沒有 title")
            continue
        if row.get("title") != title:
            changed += 1
            if not check:
                row["title"] = title

    if check:
        return changed, missing

    write_json(index_path, index)

    # 單城檔也補一份，這樣每個劇情檔自己就看得出是哪一章
    for row in index["cities"]:
        title = titles.get(row["city_id"])
        if not title:
            continue
        path = root / row["file"]
        if not path.is_file():
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        if doc.get("title") != title:
            doc["title"] = title
            write_json(path, doc)
    return changed, missing


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dump", help="cities 回應的 JSON dump，例如 cities.json")
    ap.add_argument(
        "--dataset",
        action="append",
        required=True,
        help="要套用的資料目錄，例如 data/red_army。title 隨陣營而異，"
        "只能指定這份 dump 所屬變體，不可一次套兩個",
    )
    ap.add_argument("--check", action="store_true", help="只回報，不寫檔")
    args = ap.parse_args()

    dump = Path(args.dump)
    if not dump.is_file():
        print(f"找不到 {dump}", file=sys.stderr)
        return 2

    titles = load_titles(dump)
    print(f"{dump}：取得 {len(titles)} 座城的 title")

    roots = [Path(d) for d in args.dataset]
    total_missing = 0
    for root in roots:
        changed, missing = apply_to(root, titles, args.check)
        verb = "需要更新" if args.check else "已更新"
        print(f"{root}：{verb} {changed} 筆，缺 title {missing} 筆")
        total_missing += missing

    return 1 if total_missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
