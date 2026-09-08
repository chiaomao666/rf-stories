"""把劇情文本裡的玩家身分換成佔位符。

伺服器會把抓取帳號的**暱稱**與**組織名**直接代入 `speaker` 與 `dialogue`
（主線與 UW 都會），所以入庫前必須先過這一關——公開帶有這些字串的文本
等同散佈帳號身分。

兩者的來源都是 profile：遊戲自己讀的是 `userProfile.nickname` 與
`userProfile.organization`。
"""
from __future__ import annotations

import copy
from typing import Any, Iterable

PLACEHOLDER = "主角"
ORG_PLACEHOLDER = "組織"

FIELDS = ("speaker", "dialogue")


def _pairs(
    player_name: str | None,
    organization: str | None = None,
    placeholder: str = PLACEHOLDER,
    org_placeholder: str = ORG_PLACEHOLDER,
) -> list[tuple[str, str]]:
    """(要替換的字串, 佔位符) 清單，長的排前面。

    先換長的才不會出問題：若組織名剛好包含暱稱，先換短的會把長的切碎。
    """
    out = [(v, p) for v, p in ((player_name, placeholder), (organization, org_placeholder)) if v]
    return sorted(out, key=lambda kv: len(kv[0]), reverse=True)


def scrub_slides(
    slides: list[dict[str, Any]],
    player_name: str | None,
    placeholder: str = PLACEHOLDER,
    organization: str | None = None,
    org_placeholder: str = ORG_PLACEHOLDER,
) -> tuple[list[dict[str, Any]], int]:
    """回傳 (清理後的 slides, 被改動的欄位數)。原始資料不會被修改。"""
    subs = _pairs(player_name, organization, placeholder, org_placeholder)
    if not subs:
        return slides, 0

    cleaned = copy.deepcopy(slides)
    hits = 0
    for s in cleaned:
        for field in FIELDS:
            value = s.get(field)
            if not value:
                continue
            new = value
            for needle, repl in subs:
                if needle in new:
                    new = new.replace(needle, repl)
            if new != value:
                s[field] = new
                hits += 1
    return cleaned, hits


def count_occurrences(
    slides: list[dict[str, Any]],
    player_name: str | None,
    organization: str | None = None,
) -> dict[str, int]:
    """只統計不修改，用來檢查某批資料是否還殘留玩家身分。"""
    needles: Iterable[str] = [v for v in (player_name, organization) if v]
    counts = {f: 0 for f in FIELDS}
    if not needles:
        return counts
    for s in slides:
        for field in FIELDS:
            value = s.get(field)
            if value and any(n in value for n in needles):
                counts[field] += 1
    return counts
