#!/usr/bin/env python3
"""把一個變體的城鎮順序（`position`）套用到另一個變體。

城鎮順序是**世界地圖的屬性，不是陣營的屬性**——紅軍與非紅軍看到的 `cities.position`
一模一樣。所以只要有任一個帳號跑過 `fetch_main_story.py`，另一邊就不必為了拿順序
再跑一次（劇情內容仍然是兩套獨立的，那個還是得各抓各的）。

會先確認兩邊的城市集合（id／名稱／章節）完全相同才動手；不同就中止，
因為那代表其中一份資料過期了，硬套順序只會把錯誤蓋進去。

用法：
    python scripts/share_city_order.py --from data/non_red_army --to data/red_army --check
    python scripts/share_city_order.py --from data/non_red_army --to data/red_army
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def city_key(city: dict) -> tuple:
    return (
        city["city_id"],
        city.get("city_name"),
        city.get("chapter_name"),
        city.get("chapter_number"),
        city.get("chapter_serial"),
    )


def order_key(city: dict) -> tuple:
    """與 fetch_main_story.py 的排序規則一致。"""
    pos = city.get("position")
    if pos is None:
        return (1, 0, str(city.get("chapter_name") or ""), city.get("chapter_serial") or 0)
    return (0, pos, "", 0)


def load_index(root: Path) -> dict:
    path = root / "index.json"
    if not path.is_file():
        raise SystemExit(f"找不到 {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", required=True, help="順序來源，例如 data/non_red_army")
    ap.add_argument("--to", dest="dst", required=True, help="要套用的目標，例如 data/red_army")
    ap.add_argument("--check", action="store_true", help="只回報，不寫檔")
    args = ap.parse_args()

    src_root, dst_root = Path(args.src), Path(args.dst)
    src, dst = load_index(src_root), load_index(dst_root)

    if sorted(map(city_key, src["cities"])) != sorted(map(city_key, dst["cities"])):
        print(
            f"{src_root} 與 {dst_root} 的城市集合不同，不套用順序。"
            f"其中一份可能過期，請先各自重跑 fetch_main_story.py",
            file=sys.stderr,
        )
        return 2

    positions = {c["city_id"]: c.get("position") for c in src["cities"]}
    if any(p is None for p in positions.values()):
        print(f"{src_root} 本身就沒有 position，無法當來源", file=sys.stderr)
        return 2

    changed = sum(
        1 for c in dst["cities"] if c.get("position") != positions[c["city_id"]]
    )
    print(f"{dst_root}：{len(dst['cities'])} 座城，{changed} 座的 position 需要更新")

    if args.check:
        return 0
    if not changed:
        print("已經一致，沒有動作")
        return 0

    for c in dst["cities"]:
        c["position"] = positions[c["city_id"]]
    dst["cities"].sort(key=order_key)
    dst["city_order_from"] = str(src_root).replace("\\", "/")

    path = dst_root / "index.json"
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(dst, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    print(f"-> {path}")

    first = dst["cities"][:3]
    print("前三座：" + "、".join(f"{c['city_name']}({c['position']})" for c in first))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
