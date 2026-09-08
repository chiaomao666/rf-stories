"""陣營劇情的存放。

陣營劇情是**陣營的屬性**，不是主線紅軍／非紅軍版本的屬性——先前把它寫進
data/<variant>/nation_story.json 是誤置：非紅軍那份其實是「蒙古」的故事，
換一個非紅軍陣營的帳號來抓就會互相覆蓋。

改成以陣營 id 為主鍵存放，九個陣營各一份：

    data/nation_story/
    ├── index.json        # 陣營清單與各自張數
    ├── nation_1.json     # 紅軍
    └── nation_8.json     # 蒙古

每支腳本都用這裡的 save_nation_story()，寫入時只動自己那一個陣營，
index.json 用合併的方式更新，不會把別的陣營洗掉。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DIR_NAME = "nation_story"
INDEX_NAME = "index.json"


def write_json(path: Path, data: object) -> None:
    """先寫 .tmp 再 replace，中途中斷不會留下半個檔。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def store_dir(root: Path) -> Path:
    return root / DIR_NAME


def nation_file(nation_id: int | str) -> str:
    return f"nation_{nation_id}.json"


def save_nation_story(
    root: Path,
    nation: dict[str, Any],
    payload: dict[str, Any],
    slides: list[dict[str, Any]],
    *,
    user_id: int | None = None,
    anonymized: bool = False,
) -> Path:
    """寫入單一陣營的劇情，並把它併進 index.json。回傳寫出的檔案路徑。"""
    nid = nation.get("id")
    if nid is None:
        raise ValueError("陣營沒有 id，無法決定存放位置")

    out = store_dir(root)
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    record = {
        "mode": "story_nation",
        "nation": nation,
        "fetched_at": fetched_at,
        "user_id": user_id,
        "anonymized": anonymized,
        "counts": {
            "total": len(slides),
            "with_dialogue": sum(1 for s in slides if s.get("dialogue")),
        },
        "preloads": payload.get("preloads") or [],
        "slides": slides,
    }
    path = out / nation_file(nid)
    write_json(path, record)
    _merge_index(out, nation, record, fetched_at)
    return path


def _merge_index(
    out: Path, nation: dict[str, Any], record: dict[str, Any], fetched_at: str
) -> None:
    """更新 index.json，只替換自己那一筆。"""
    index_path = out / INDEX_NAME
    try:
        index = json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        index = {}

    nations = {n["id"]: n for n in index.get("nations", []) if n.get("id") is not None}
    nations[nation["id"]] = {
        "id": nation["id"],
        "name": nation.get("name"),
        "file": nation_file(nation["id"]),
        "fetched_at": fetched_at,
        "anonymized": record["anonymized"],
        **record["counts"],
    }
    write_json(
        out / INDEX_NAME,
        {
            "source": "api.komisureiya.com",
            "updated_at": fetched_at,
            "nations": [nations[k] for k in sorted(nations)],
        },
    )


def load_index(root: Path) -> dict[str, Any]:
    try:
        return json.loads((store_dir(root) / INDEX_NAME).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"nations": []}
