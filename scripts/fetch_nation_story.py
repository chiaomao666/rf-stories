#!/usr/bin/env python3
"""抓取登入帳號所屬陣營的陣營劇情。

陣營劇情是**陣營的屬性**，九個陣營各一套，所以要收齊必須用九個不同陣營的帳號
各跑一次。這支腳本只送 `nation_slides` 一個純查詢事件，不碰主線，
因此可以隨便換帳號重跑——不會像 fetch_main_story.py 那樣受主線目錄的
user_id 防呆擋下，也不必為了一份陣營劇情重抓幾千張主線 slide。

輸出（只動自己那一個陣營，不影響其他陣營）：

    data/nation_story/
    ├── index.json
    └── nation_<陣營 id>.json

用法：
    set RF_EMAIL=...  /  export RF_EMAIL=...
    set RF_PASSWORD=...
    python scripts/fetch_nation_story.py
    python scripts/fetch_nation_story.py --check    # 只看目前收了哪些陣營
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from rf_stories.anonymize import scrub_slides  # noqa: E402
from rf_stories.client import RFClient, RFError  # noqa: E402
from rf_stories.nation_story import load_index, save_nation_story  # noqa: E402


def print_index(root: Path) -> None:
    index = load_index(root)
    nations = index.get("nations") or []
    print(f"目前已收錄 {len(nations)} 個陣營：")
    for n in nations:
        print(
            f"  id={n['id']:<3} {str(n.get('name') or ''):<8} "
            f"slides={n.get('total')} 對白={n.get('with_dialogue')} "
            f"({str(n.get('fetched_at') or '')[:10]})"
        )


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None, help="輸出根目錄，預設 data/")
    ap.add_argument("--check", action="store_true", help="只列出已收錄的陣營，不連線")
    ap.add_argument("--player-name", help="要替換掉的玩家暱稱（預設取 profile）")
    ap.add_argument("--organization", help="要替換掉的組織名（預設取 profile）")
    ap.add_argument(
        "--allow-unanonymized",
        action="store_true",
        help="暱稱取不到時仍然寫檔（預設中止；寫出的資料會帶帳號身分，不可公開）",
    )
    args = ap.parse_args()

    root = Path(args.out) if args.out else ROOT / "data"

    if args.check:
        print_index(root)
        return 0

    email = os.environ.get("RF_EMAIL")
    password = os.environ.get("RF_PASSWORD")
    if not email or not password:
        print("需要環境變數 RF_EMAIL 與 RF_PASSWORD", file=sys.stderr)
        return 2

    async with RFClient(email, password) as rf:
        print(f"login ok (user_id={rf.user_id})")

        profile = await rf.profile()
        nation = await rf.nation_of(profile)
        if nation.get("id") is None:
            print(f"無法判定陣營（nation={nation}），中止", file=sys.stderr)
            return 2
        print(f"陣營: id={nation['id']} {nation.get('name') or '(名稱未知)'}")

        # 劇情文本會帶抓取帳號的暱稱與組織名，落地前先換掉。
        player_name = args.player_name or rf.nickname or profile.get("nickname")
        organization = args.organization or profile.get("organization")
        if not player_name and not args.allow_unanonymized:
            print(
                "取不到玩家暱稱，中止。帶身分的文本等同散佈帳號身分。\n"
                "請用 --player-name <暱稱> 指定後重跑；"
                "確定要寫入未去識別化的資料才加 --allow-unanonymized",
                file=sys.stderr,
            )
            return 2
        if organization:
            print(f"組織名「{organization}」將替換為佔位符")
        if player_name:
            print(f"玩家暱稱「{player_name}」將替換為佔位符")

        payload = await rf.nation_slides()
        slides = payload.get("slides") or []
        if not slides:
            print("nation_slides 回了空陣列——這個陣營目前沒有劇情，不寫檔")
            return 1

        changed = 0
        if player_name or organization:
            slides, changed = scrub_slides(slides, player_name, organization=organization)

        path = save_nation_story(
            root,
            nation,
            payload,
            slides,
            user_id=rf.user_id,
            anonymized=bool(player_name or organization),
        )
        print(f"slides={len(slides)}（去識別化替換 {changed} 處）")
        print(f"-> {path}")

    print()
    print_index(root)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
