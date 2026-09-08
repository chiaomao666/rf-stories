#!/usr/bin/env python3
"""UW 副本站點偵查與（可選的）派遣抓取。

預設模式是唯讀的：列出九陣營 HQ 的站點、能量消耗、cur_level/max_level、
當前級數的開放條件，以及本帳號的隊伍與條件幹部持有狀況。

--dispatch SITE_ID 會實際派遣一次。**這會扣掉該站點的 energy_charge、
可能推進 cur_level，是不可逆的存檔變更**，所以必須另外帶 --yes。
派遣還要求角色當下就在該座城市，否則後端直接回錯誤（不扣能量）。

用法：
    python scripts/uw_probe.py                       # 掃九個 HQ
    python scripts/uw_probe.py --city 110            # 只看一座城
    python scripts/uw_probe.py --dispatch 666 --team 84058 --yes
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

from rf_stories.anonymize import count_occurrences, scrub_slides  # noqa: E402
from rf_stories.client import RFClient, RFError  # noqa: E402

PLOT_TYPES = ("Visit", "Explore")


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def cond_str(c: dict | None) -> str:
    if not isinstance(c, dict):
        return "-"
    bits = [str(c.get("type"))]
    if c.get("reference_name"):
        bits.append(str(c["reference_name"]))
    for k, label in (("condition_level", "lv"), ("ref_level", "ref_lv"),
                     ("condition_quantity", "x")):
        if c.get(k) is not None:
            bits.append(f"{label}={c[k]}")
    return " ".join(bits)


async def recon(rf: RFClient, args: argparse.Namespace, out: Path) -> None:
    cities = await rf.cities()
    hqs = [c for c in cities if c.get("hq")]
    targets = [c for c in cities if c["id"] == args.city] if args.city else hqs

    if not args.city:
        print(f"\n--- HQ 城市 ({len(hqs)}) ---")
        for c in hqs:
            nat = (c.get("control_nation") or {}).get("name")
            print(f"  city={c['id']:<5} {str(c.get('name') or ''):<10} 陣營={nat}")

    found: list[dict] = []
    print("\n--- 站點 ---")
    for c in targets:
        sites = await rf.city_sites(c["id"])
        nat = (c.get("control_nation") or {}).get("name")
        print(f"\n  [city {c['id']} {c.get('name','')} / {nat}] sites={len(sites)}")
        for s in sites:
            if s.get("reference_type") not in PLOT_TYPES:
                continue
            print(
                f"    site={s.get('id'):<6} {str(s.get('name') or ''):<12} "
                f"{str(s.get('reference_type')):<8} energy={s.get('energy_charge')} "
                f"lv={s.get('cur_level')}/{s.get('max_level')} "
                f"state={s.get('state')}{'(不可點)' if s.get('state') == 4 else ''} "
                f"cond={cond_str(s.get('condition'))}"
            )
            found.append(
                {
                    "city_id": c["id"],
                    "city_name": c.get("name"),
                    "nation": nat,
                    **{
                        k: s.get(k)
                        for k in ("id", "name", "reference_type", "energy_charge",
                                  "cur_level", "max_level", "state")
                    },
                    "condition": s.get("condition"),
                }
            )
        await asyncio.sleep(0.3)

    actors = await rf.actors()
    teams: dict[int, dict] = {}
    owned: set[str] = set()
    for a in actors:
        nm = (a.get("actor_prototype") or {}).get("name")
        if nm:
            owned.add(nm)
        t = a.get("team") or {}
        if t.get("team_number"):
            e = teams.setdefault(
                t["team_number"], {"team_id": t.get("id"), "n": 0, "power": t.get("power")}
            )
            e["n"] += 1

    print(f"\n--- 隊伍（actors={len(actors)}）---")
    if not teams:
        print("  （沒有已編隊的幹部，無法派遣）")
    for num, e in sorted(teams.items()):
        print(f"  team_number={num}  team_id={e['team_id']}  人數={e['n']}")

    print("\n--- 各站點當前級數的條件是否滿足 ---")
    for f in found:
        c = f.get("condition") or {}
        nm = c.get("reference_name")
        if c.get("type") == "Actor" and nm:
            mark = "✅" if nm in owned else "❌"
            note = "持有" if nm in owned else "未持有"
            print(f"  {mark} site={f['id']:<6} {f['name']:<12} 需{note} {nm}")
        else:
            # ActorRelationLevel / Prop / SitePlot 等無法由 actors 直接判定
            state = "不可點" if f.get("state") == 4 else "可點"
            print(f"  ?  site={f['id']:<6} {f['name']:<12} {cond_str(c)}（{state}）")

    write_json(out / "uw_sites.json", {
        "scanned_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sites": found,
    })
    print(f"\n-> {out / 'uw_sites.json'}")


async def dispatch(rf: RFClient, args: argparse.Namespace, out: Path) -> int:
    site_id, team_id = args.dispatch, args.team
    if not team_id:
        print("需要 --team TEAM_ID（先跑唯讀模式看有哪些）", file=sys.stderr)
        return 2

    print(f"\n*** 派遣 site_id={site_id} team_id={team_id}：會扣能量並可能推進進度 ***")
    reply = await rf.player("uw_start_plot", {"site_id": site_id, "team_id": team_id})
    if not reply.ok:
        msg = reply.payload.get("message") or reply.status
        print(f"uw_start_plot 失敗：{msg}")
        return 1

    pl = reply.payload
    slides = pl.get("slides") or []
    site_plot_id = pl.get("site_plot_id")
    if not slides:
        print("回覆沒有 slides，中止（不送 finish）")
        return 1

    print(
        f"uw_start_plot ok：slides={len(slides)} site_plot_id={site_plot_id} "
        f"level={pl.get('level')} site_name={pl.get('site_name')}"
    )

    # 身分清理——UW 文本會帶抓取者的暱稱與組織名，入庫前一定要過這關
    profile = await rf.profile()
    player_name = args.player_name or rf.nickname or profile.get("nickname")
    organization = args.organization or profile.get("organization")
    if player_name or organization:
        hits = count_occurrences(slides, player_name, organization)
        cleaned, changed = scrub_slides(slides, player_name, organization=organization)
        print(
            f"玩家身分（暱稱「{player_name}」／組織「{organization}」）出現：{hits}，"
            f"已替換 {changed} 處"
        )
    else:
        cleaned, changed = slides, 0
        print("⚠️ 取不到玩家身分，未做替換——請用 --player-name / --organization 指定後重跑清理")

    record = {
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "site_id": pl.get("site_id"),
        "site_name": pl.get("site_name"),
        "site_plot_id": site_plot_id,
        "level": pl.get("level"),
        "city_id": pl.get("city_id"),
        "anonymized": bool(player_name or organization),
        "counts": {
            "total": len(cleaned),
            "with_dialogue": sum(1 for s in cleaned if s.get("dialogue")),
        },
        "preloads": pl.get("preloads") or [],
        "slides": cleaned,
    }
    dest = out / "uw_plots" / f"site_{site_id}_plot_{site_plot_id}.json"
    write_json(dest, record)
    print(f"-> {dest}")

    print("\n--- 前 5 句 ---")
    shown = 0
    for s in cleaned:
        if s.get("dialogue"):
            print(f"  {s.get('speaker') or '（旁白）'}：{s['dialogue'][:60]}")
            shown += 1
            if shown >= 5:
                break

    # 比照客戶端收尾，否則留下未結算的 plot、也拿不到獎勵
    fin = await rf.player(
        "uw_finish_plot",
        {"site_id": site_id, "site_plot_id": site_plot_id, "team_id": team_id},
    )
    if fin.ok:
        print(
            f"\nuw_finish_plot ok：good_ending={fin.payload.get('good_ending')} "
            f"rewarded={fin.payload.get('rewarded')}"
        )
    else:
        print(f"\nuw_finish_plot 失敗：{fin.payload.get('message')}")
    return 0


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", type=int, help="只看這座城")
    ap.add_argument("--out", default=str(ROOT / "data"))
    ap.add_argument("--dispatch", type=int, metavar="SITE_ID", help="實際派遣（扣能量）")
    ap.add_argument("--team", type=int, help="派遣用的 team_id")
    ap.add_argument("--player-name", help="取不到暱稱時，手動指定要清理的玩家名")
    ap.add_argument("--organization", help="取不到組織名時，手動指定要清理的組織名")
    ap.add_argument("--yes", action="store_true", help="確認執行 --dispatch")
    args = ap.parse_args()

    if args.dispatch and not args.yes:
        print("--dispatch 會扣能量並可能推進 cur_level；確認後請加 --yes", file=sys.stderr)
        return 2

    email = os.environ.get("RF_EMAIL")
    password = os.environ.get("RF_PASSWORD")
    if not email or not password:
        print("需要環境變數 RF_EMAIL 與 RF_PASSWORD", file=sys.stderr)
        return 2

    out = Path(args.out)
    try:
        async with RFClient(email, password) as rf:
            print(f"login ok (user_id={rf.user_id})")
            if args.dispatch:
                return await dispatch(rf, args, out)
            await recon(rf, args, out)
            return 0
    except RFError as exc:
        print(f"錯誤：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
