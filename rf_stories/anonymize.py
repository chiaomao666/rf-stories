"""把劇情文本裡的玩家名換成佔位符。

UW 副本劇情會把抓取者的玩家名寫進 `speaker` 與 `dialogue`（實測 93 張中有 40 句），
所以入庫前必須先過這一關——公開帶有玩家名的文本等於散佈帳號身分。
主線劇情目前沒觀察到這個情形，但一併過一次不會有壞處。
"""
from __future__ import annotations

import copy
from typing import Any

PLACEHOLDER = "主角"


def scrub_slides(
    slides: list[dict[str, Any]], player_name: str, placeholder: str = PLACEHOLDER
) -> tuple[list[dict[str, Any]], int]:
    """回傳 (清理後的 slides, 被改動的欄位數)。原始資料不會被修改。"""
    if not player_name:
        return slides, 0

    cleaned = copy.deepcopy(slides)
    hits = 0
    for s in cleaned:
        if s.get("speaker") == player_name:
            s["speaker"] = placeholder
            hits += 1
        elif s.get("speaker") and player_name in s["speaker"]:
            s["speaker"] = s["speaker"].replace(player_name, placeholder)
            hits += 1
        if s.get("dialogue") and player_name in s["dialogue"]:
            s["dialogue"] = s["dialogue"].replace(player_name, placeholder)
            hits += 1
    return cleaned, hits


def count_occurrences(slides: list[dict[str, Any]], player_name: str) -> dict[str, int]:
    """只統計不修改，用來檢查某批資料是否還殘留玩家名。"""
    if not player_name:
        return {"speaker": 0, "dialogue": 0}
    return {
        "speaker": sum(
            1 for s in slides if s.get("speaker") and player_name in s["speaker"]
        ),
        "dialogue": sum(
            1 for s in slides if s.get("dialogue") and player_name in s["dialogue"]
        ),
    }
