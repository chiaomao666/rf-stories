#!/usr/bin/env python3
"""把 site/tools/rf_uw_capture.js 匯出的檔案併進 data/uw_plots/。

UW 劇情只能累積式蒐集（每次派遣扣能量、後端隨機抽段、客戶端無法指定要看哪一段），
所以這支腳本的重點是**合併**而不是覆蓋：以劇情內容指紋去重，內容相同的就跳過，
可以在每次匯出後重跑。

匯入前會檢查去識別化：只要文本裡還找得到暱稱或組織名就中止，
帶身分的文本等同散佈帳號身分。

用法：
    python scripts/import_uw_capture.py ~/Downloads/rf_uw_plots_1234.json --check
    python scripts/import_uw_capture.py ~/Downloads/rf_uw_plots_1234.json
    python scripts/import_uw_capture.py dump.json --player-name X --organization Y
"""
from __future__ import annotations

import argparse
from difflib import SequenceMatcher
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from rf_stories.anonymize import count_occurrences, scrub_slides  # noqa: E402


TEXT_FIELDS = {"speaker", "dialogue"}
# Captures of the same plot can differ only because an earlier export did not
# know the player nickname (or substituted a short organization name into
# ordinary prose).  Keep genuinely different plot outcomes, but collapse these
# near-identical, presentation-only variants.
NEAR_DUPLICATE_TEXT_RATIO = 0.985


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def slides_signature(slides: list[dict]) -> str:
    payload = json.dumps(slides or [], ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def slide_layout_signature(slides: list[dict]) -> str:
    """Hash the non-text portion of a plot's slides."""
    layout = [{key: value for key, value in slide.items() if key not in TEXT_FIELDS} for slide in slides]
    payload = json.dumps(layout, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def protagonist_aliases(left: list[dict], right: list[dict]) -> set[str]:
    """Find names paired with the canonical 主角 speaker in matching slides."""
    aliases = set()
    for left_slide, right_slide in zip(left, right):
        left_speaker = str(left_slide.get("speaker") or "")
        right_speaker = str(right_slide.get("speaker") or "")
        if left_speaker == "主角" and right_speaker:
            aliases.add(right_speaker)
        if right_speaker == "主角" and left_speaker:
            aliases.add(left_speaker)
    aliases.discard("主角")
    return aliases


def slide_text(slides: list[dict], aliases: set[str] | None = None) -> str:
    aliases = aliases or set()
    def canonical(value: object) -> str:
        text = str(value or "")
        for alias in aliases:
            text = text.replace(alias, "主角")
        return text

    return "\n".join(
        f"{canonical(slide.get('speaker'))}\n{canonical(slide.get('dialogue'))}"
        for slide in slides
    )


def same_plot_content(left: list[dict], right: list[dict]) -> bool:
    """Return whether two captures are identical apart from minor text scrubbing."""
    if left == right:
        return True
    if len(left) != len(right) or slide_layout_signature(left) != slide_layout_signature(right):
        return False
    aliases = protagonist_aliases(left, right)
    return (
        SequenceMatcher(
            None, slide_text(left, aliases), slide_text(right, aliases), autojunk=False
        ).ratio()
        >= NEAR_DUPLICATE_TEXT_RATIO
    )


def anonymization_quality(record: dict) -> int:
    """Prefer a capture that has already replaced the player name with 主角."""
    return sum(
        str(slide.get(field) or "").count("主角")
        for slide in record.get("slides") or []
        for field in TEXT_FIELDS
    )


def plot_filename(record: dict) -> str:
    """以內容指紋區分同一 site_plot_id 的不同隨機結果。"""
    digest = slides_signature(record.get("slides") or [])[:10]
    return f"site_{record.get('site_id')}_plot_{record.get('site_plot_id')}_{digest}.json"


def preferred_record(record: dict, current: dict | None) -> bool:
    if current is None:
        return True
    record_quality = anonymization_quality(record)
    current_quality = anonymization_quality(current)
    if record_quality != current_quality:
        return record_quality > current_quality
    current_city = current.get("city_name")
    record_city = record.get("city_name")
    current_has_city = bool(current_city and str(current_city).strip() not in {"", "-", "null"})
    record_has_city = bool(record_city and str(record_city).strip() not in {"", "-", "null"})
    current_time = current.get("fetched_at") or ""
    record_time = record.get("fetched_at") or ""
    return (
        (record_has_city > current_has_city)
        or (record_has_city == current_has_city and record_time > current_time)
        or (record_has_city == current_has_city and record_time == current_time and record.get("file", "") > current.get("file", ""))
    )


def existing_plot_path(out: Path, record: dict) -> Path | None:
    pattern = f"site_{record.get('site_id')}_plot_{record.get('site_plot_id')}*.json"
    slides = record.get("slides") or []
    for path in sorted(out.glob(pattern)):
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if same_plot_content(existing.get("slides") or [], slides):
            return path
    return None


def rebuild_index(out: Path) -> dict:
    kept: dict[tuple[int | None, int | None, str], tuple[Path, dict]] = {}
    for path in sorted(out.glob("site_*_plot_*.json")):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        slides = record.get("slides") or []
        key = (record.get("site_id"), record.get("site_plot_id"), slide_layout_signature(slides))
        current = kept.get(key)
        if current is None:
            kept[key] = (path, record)
        elif same_plot_content(current[1].get("slides") or [], slides):
            if preferred_record(record, current[1]):
                kept[key] = (path, record)
        else:
            # The layout happens to match but the text describes a genuinely
            # different random outcome, so retain it under its full signature.
            kept[(record.get("site_id"), record.get("site_plot_id"), slides_signature(slides))] = (path, record)

    plots = []
    for path, record in sorted(kept.values(), key=lambda item: item[0].name):
        slides = record.get("slides") or []
        counts = record.get("counts") or {}
        plots.append(
            {
                "site_id": record.get("site_id"),
                "site_name": record.get("site_name"),
                "site_plot_id": record.get("site_plot_id"),
                "level": record.get("level"),
                "city_id": record.get("city_id"),
                "city_name": record.get("city_name"),
                "file": path.name,
                "total": counts.get("total", len(slides)),
                "with_dialogue": counts.get(
                    "with_dialogue", sum(bool(s.get("dialogue")) for s in slides)
                ),
                "fetched_at": record.get("fetched_at"),
            }
        )
    index = {
        "source": "rf_uw_capture.js",
        "anonymized": all(
            json.loads(p.read_text(encoding="utf-8")).get("anonymized", False)
            for p in sorted(out.glob("site_*_plot_*.json"))
        ),
        "plots_total": len(plots),
        "slides_total": sum(p["total"] for p in plots),
        "with_dialogue_total": sum(p["with_dialogue"] for p in plots),
        "plots": plots,
    }
    write_json(out / "index.json", index)
    return index


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dump", help="rf_uw_capture.js 匯出的 JSON")
    ap.add_argument("--out", default=None, help="輸出目錄，預設 data/uw_plots/")
    ap.add_argument("--check", action="store_true", help="只回報，不寫檔")
    ap.add_argument("--player-name", help="匯出時沒清乾淨的話，在這裡補指定暱稱")
    ap.add_argument("--organization", help="匯出時沒清乾淨的話，在這裡補指定組織名")
    ap.add_argument("--force", action="store_true", help="內容相同的既有段落也覆寫")
    args = ap.parse_args()

    dump = Path(args.dump)
    if not dump.is_file():
        print(f"找不到 {dump}", file=sys.stderr)
        return 2

    raw = json.loads(dump.read_text(encoding="utf-8"))
    records = raw.get("plots") if isinstance(raw, dict) else raw
    if not isinstance(records, list):
        print(f"{dump} 不是 rf_uw_capture.js 的匯出格式", file=sys.stderr)
        return 2

    out = Path(args.out) if args.out else ROOT / "data" / "uw_plots"
    print(f"{dump}：{len(records)} 段，目標 {out}")

    added = skipped = 0
    dirty: list[str] = []
    to_write: list[tuple[Path, dict]] = []

    for rec in records:
        slides = rec.get("slides") or []
        if not slides:
            continue

        # 匯出時就該清乾淨了；這裡是最後一道關卡。
        if args.player_name or args.organization:
            slides, _ = scrub_slides(
                slides, args.player_name, organization=args.organization
            )
            rec = {**rec, "slides": slides, "anonymized": True}
        hits = count_occurrences(slides, args.player_name, args.organization)
        if sum(hits.values()):
            dirty.append(f"{plot_filename(rec)}（{sum(hits.values())} 處）")
            continue
        if not rec.get("anonymized"):
            dirty.append(f"{plot_filename(rec)}（匯出時未做去識別化）")
            continue

        path = existing_plot_path(out, rec) or out / plot_filename(rec)
        if path.exists() and not args.force:
            skipped += 1
            continue
        added += 1
        to_write.append((path, rec))

    if dirty:
        print("以下段落沒有通過去識別化檢查，全部中止：", file=sys.stderr)
        for d in dirty:
            print(f"  {d}", file=sys.stderr)
        print(
            "請用 --player-name / --organization 指定實際值後重跑",
            file=sys.stderr,
        )
        return 1

    print(f"新增 {added} 段，已存在略過 {skipped} 段")
    if args.check:
        for path, _ in to_write:
            print(f"  會寫入 {path.name}")
        return 0

    for path, rec in to_write:
        write_json(path, rec)
    index = rebuild_index(out)
    if to_write:
        print(f"-> {out}")

    existing = sorted(out.glob("site_*_plot_*.json")) if out.is_dir() else []
    print(f"目前 data/uw_plots/ 共 {len(existing)} 段，索引同步為 {index['plots_total']} 段")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
