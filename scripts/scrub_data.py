#!/usr/bin/env python3
"""把已抓下來的資料裡的玩家暱稱換成佔位符。

劇情文本會把抓取帳號的暱稱直接寫進 `speaker` 與 `dialogue`（主線與 UW 都會），
所以資料進版控或公開之前必須先過這一關。

`fetch_main_story.py` 從此會在寫檔時就自動處理；這支腳本是給既有資料補做，
或是自動判定失敗時手動指定用的。

用法：
    python scripts/scrub_data.py data/non_red_army --player-name 中華電信
    python scripts/scrub_data.py data/red_army --player-name _
    python scripts/scrub_data.py data/red_army --player-name _ --check   # 只檢查不改
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from rf_stories.anonymize import PLACEHOLDER, count_occurrences, scrub_slides  # noqa: E402


def iter_story_files(root: Path):
    yield from sorted((root / "main_story").glob("city_*.json"))
    nation = root / "nation_story.json"
    if nation.exists():
        yield nation
    uw = root / "uw_plots"
    if uw.is_dir():
        yield from sorted(uw.glob("*.json"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset", help="資料目錄，例如 data/non_red_army")
    ap.add_argument("--player-name", required=True, help="要替換掉的玩家暱稱")
    ap.add_argument("--placeholder", default=PLACEHOLDER)
    ap.add_argument("--check", action="store_true", help="只回報，不寫檔")
    args = ap.parse_args()

    root = Path(args.dataset)
    if not root.is_dir():
        print(f"找不到目錄：{root}", file=sys.stderr)
        return 2

    files = list(iter_story_files(root))
    if not files:
        print(f"{root} 底下沒有劇情檔", file=sys.stderr)
        return 2

    total_before = 0
    total_changed = 0
    touched = 0

    for f in files:
        doc = json.loads(f.read_text(encoding="utf-8"))
        slides = doc.get("slides") or []
        before = count_occurrences(slides, args.player_name)
        n_before = before["speaker"] + before["dialogue"]
        total_before += n_before
        if not n_before:
            continue

        touched += 1
        if args.check:
            print(f"  {f.relative_to(root)}: {n_before} 處")
            continue

        cleaned, changed = scrub_slides(slides, args.player_name, args.placeholder)
        doc["slides"] = cleaned
        doc["anonymized"] = True
        doc["anonymized_placeholder"] = args.placeholder
        tmp = f.with_suffix(f.suffix + ".tmp")
        tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(f)
        total_changed += changed

    verb = "發現" if args.check else "替換"
    print(
        f"{root}：{len(files)} 個檔案，{touched} 個含「{args.player_name}」，"
        f"{verb} {total_before if args.check else total_changed} 處"
    )

    if not args.check:
        # 改完立刻自我驗證，別讓殘留漏到 commit
        residue = 0
        for f in files:
            doc = json.loads(f.read_text(encoding="utf-8"))
            r = count_occurrences(doc.get("slides") or [], args.player_name)
            residue += r["speaker"] + r["dialogue"]
        if residue:
            print(f"⚠️ 仍殘留 {residue} 處，請檢查", file=sys.stderr)
            return 1
        print("驗證：無殘留")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
