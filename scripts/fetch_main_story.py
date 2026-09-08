#!/usr/bin/env python3
"""抓取全部主線攻城劇情與陣營劇情，存成 JSON。

`slides` 是純查詢事件：不扣資源、不改變遊戲狀態，同一個 city_id 送幾次回幾次，
所以這支腳本可以隨時重跑（官方更新劇情後就該重跑一次）。

主線劇情只有**紅軍**與**非紅軍**兩種版本（不是九個陣營各一套），腳本依登入帳號的
陣營自動判定，分別寫進 data/red_army/ 與 data/non_red_army/，兩者不會互相覆蓋。
所以要收齊全部內容，需要用一個紅軍帳號與一個非紅軍帳號各跑一次。

用法：
    set RF_EMAIL=...  /  export RF_EMAIL=...
    set RF_PASSWORD=...
    python scripts/fetch_main_story.py                    # 自動判定變體
    python scripts/fetch_main_story.py --variant red_army # 覆寫判定
    python scripts/fetch_main_story.py --out somewhere --all

預設只打 status != "no_entry" 的城市（其餘尚未實作劇情，一律回空陣列）；
--all 會改成打全部 271 座，用來確認過濾條件是否仍然成立。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from rf_stories.client import RFClient, RFError  # noqa: E402

SKIP_STATUS = "no_entry"

# 主線劇情只有兩種版本：紅軍與非紅軍。九個陣營不各有一套。
RED = "red_army"
NON_RED = "non_red_army"
RED_NATION_NAME = "紅軍"


def variant_of(nation: dict) -> str:
    return RED if (nation.get("name") or "") == RED_NATION_NAME else NON_RED


def write_json(path: Path, data: object) -> None:
    """先寫 .tmp 再 replace，中途中斷不會留下半個檔。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def chapter_of(city: dict) -> dict:
    ch = city.get("chapter")
    return ch if isinstance(ch, dict) else {}


def split_by_phase(slides: list[dict]) -> dict[str, list[dict]]:
    """依 before_attack 切成戰前／戰後兩章——遊戲裡本來就是分兩次播的。"""
    before = [s for s in slides if s.get("before_attack")]
    after = [s for s in slides if not s.get("before_attack")]
    return {"before_attack": before, "after_attack": after}


def scan_assets(slides: list[dict], into: set[str]) -> None:
    for s in slides:
        for key in ("background", "music", "sound_effect"):
            v = s.get(key)
            if v:
                into.add(v)
        for slot in (s.get("placement") or {}).values():
            fig = (slot or {}).get("figure")
            if fig:
                into.add(fig)


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--out",
        default=None,
        help="輸出目錄。預設為 data/<variant>/，variant 由帳號陣營自動判定",
    )
    ap.add_argument(
        "--variant",
        choices=(RED, NON_RED),
        help="覆寫變體判定（主線劇情只分紅軍與非紅軍兩種）",
    )
    ap.add_argument("--all", action="store_true", help="不過濾 status，打全部城市")
    ap.add_argument("--delay", type=float, default=0.3, help="每次請求間隔秒數")
    args = ap.parse_args()

    email = os.environ.get("RF_EMAIL")
    password = os.environ.get("RF_PASSWORD")
    if not email or not password:
        print("需要環境變數 RF_EMAIL 與 RF_PASSWORD", file=sys.stderr)
        return 2

    async with RFClient(email, password) as rf:
        print(f"login ok (user_id={rf.user_id})")

        # 主線劇情分紅軍與非紅軍兩版，先判定這個帳號屬於哪一版再決定輸出位置，
        # 免得兩份資料互相覆蓋。
        profile = await rf.profile()
        nation = await rf.nation_of(profile)
        variant = args.variant or variant_of(nation)
        print(f"陣營: {nation.get('name') or '（取不到）'} → variant={variant}")
        if not args.variant and not nation.get("name"):
            print("⚠️ 取不到陣營名稱，已當作非紅軍處理；如有疑慮請用 --variant 指定")

        out = Path(args.out) if args.out else ROOT / "data" / variant
        story_dir = out / "main_story"

        cities = await rf.cities()
        print(f"cities: {len(cities)}")

        targets = cities if args.all else [
            c for c in cities if c.get("status") != SKIP_STATUS
        ]
        print(f"待抓: {len(targets)} 座（--all={args.all}）")

        index: list[dict] = []
        assets: set[str] = set()
        empty = 0

        for i, c in enumerate(targets, 1):
            cid = c["id"]
            try:
                pl = await rf.slides(cid)
            except RFError as exc:
                print(f"  [{i:>3}/{len(targets)}] city={cid} 失敗: {exc}")
                continue

            slides = pl.get("slides") or []
            if not slides:
                empty += 1
                print(f"  [{i:>3}/{len(targets)}] city={cid:<5} 無劇情")
                await asyncio.sleep(args.delay)
                continue

            ch = chapter_of(c)
            phases = split_by_phase(slides)
            scan_assets(slides, assets)

            record = {
                "city_id": cid,
                "city_name": c.get("name"),
                "chapter": ch,
                "city_status": c.get("status"),
                "counts": {
                    "total": len(slides),
                    "before_attack": len(phases["before_attack"]),
                    "after_attack": len(phases["after_attack"]),
                    "with_dialogue": sum(1 for s in slides if s.get("dialogue")),
                },
                "preloads": pl.get("preloads") or [],
                "slides": slides,
            }
            write_json(story_dir / f"city_{cid}.json", record)

            index.append(
                {
                    "city_id": cid,
                    "city_name": c.get("name"),
                    "chapter_name": ch.get("name"),
                    "chapter_number": ch.get("number"),
                    "chapter_serial": ch.get("serial"),
                    "file": f"main_story/city_{cid}.json",
                    **record["counts"],
                }
            )
            print(
                f"  [{i:>3}/{len(targets)}] city={cid:<5} {str(c.get('name') or ''):<8} "
                f"{ch.get('name','')}{ch.get('number','')}-{ch.get('serial','')} "
                f"slides={len(slides)} (前{len(phases['before_attack'])}/後{len(phases['after_attack'])})"
            )
            await asyncio.sleep(args.delay)

        # 陣營劇情
        nation = await rf.nation_slides()
        n_slides = nation.get("slides") or []
        if n_slides:
            scan_assets(n_slides, assets)
            write_json(
                out / "nation_story.json",
                {
                    "mode": "story_nation",
                    "variant": variant,
                    "nation": nation,
                    "counts": {
                        "total": len(n_slides),
                        "with_dialogue": sum(1 for s in n_slides if s.get("dialogue")),
                    },
                    "preloads": nation.get("preloads") or [],
                    "slides": n_slides,
                },
            )
        print(f"\nnation_slides: {len(n_slides)} 張")

        write_json(
            out / "index.json",
            {
                "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "source": "api.komisureiya.com",
                "variant": variant,
                "nation": nation,
                "cities_total": len(cities),
                "cities_probed": len(targets),
                "cities_with_story": len(index),
                "cities_empty": empty,
                "nation_slides": len(n_slides),
                "cities": sorted(
                    index,
                    key=lambda r: (
                        str(r.get("chapter_name") or ""),
                        r.get("chapter_serial") or 0,
                    ),
                ),
            },
        )
        write_json(out / "assets.json", sorted(assets))

    total_slides = sum(r["total"] for r in index)
    print(
        f"\n完成：{len(index)} 座城有劇情、{empty} 座空，"
        f"共 {total_slides} 張 slide，素材 {len(assets)} 個"
    )
    print(f"輸出：{out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
