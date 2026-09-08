"""與 RF 遊戲伺服器溝通的最小客戶端。

只實作抓劇情需要的部分：HTTPS 登入取得 userToken，連上 Phoenix WebSocket，
加入 player channel，然後送查詢事件並等待對應的回覆。

刻意不依賴外部專案，這個 repo 要能獨立運作。協定細節見 docs/story_slides_engine.md。
"""
from __future__ import annotations

import asyncio
import json
import urllib.parse
from dataclasses import dataclass, field
from typing import Any

import requests
import websockets

LOGIN_URL = "https://api.komisureiya.com/api/users/log_in"
SOCKET_URL = "wss://api.komisureiya.com/socket/websocket"
APP_KEY = "t9cTpsbSCYcJgsrrC"
APP_VERSION = "3.00"
LOCALE = "zh_TW"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/136.0.0.0 Safari/537.36"
)


class RFError(RuntimeError):
    """伺服器回了 error，或連線層出問題。"""


@dataclass
class Reply:
    """一次 send() 的結果。

    status 是 Phoenix 的 "ok" / "error"；payload 是回覆內容。
    失敗時 payload 通常含 message。
    """

    status: str
    payload: dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status == "ok"

    def require(self, what: str = "") -> dict[str, Any]:
        if not self.ok:
            msg = self.payload.get("message") or self.payload.get("error") or self.status
            raise RFError(f"{what or '請求'}失敗: {msg}")
        return self.payload


class RFClient:
    """單一帳號的連線。用 async with 使用，離開時自動關閉 socket。"""

    def __init__(self, email: str, password: str, *, timeout: float = 30.0) -> None:
        self._email = email
        self._password = password
        self._timeout = timeout
        self._socket: websockets.WebSocketClientProtocol | None = None
        self._reader: asyncio.Task[None] | None = None
        self._waiters: dict[str, asyncio.Future[Reply]] = {}
        self._ref = 0
        self.user_id: int | None = None
        self.nickname: str | None = None

    # ---- 生命週期 -------------------------------------------------------

    async def __aenter__(self) -> "RFClient":
        await self.connect()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    @property
    def topic(self) -> str:
        if self.user_id is None:
            raise RFError("尚未登入")
        return f"player:{self.user_id}"

    async def connect(self) -> None:
        token = await self._login()
        url = (
            f"{SOCKET_URL}?userToken={urllib.parse.quote(token)}"
            f"&locale={LOCALE}&vsn=2.0.0"
        )
        self._socket = await websockets.connect(
            url,
            max_size=16 * 1024 * 1024,  # 劇情回覆可能很大 (單城 340 張 slide)
            ping_interval=15,
            ping_timeout=30,
            close_timeout=10,
        )
        # 先起 reader 再送 join，避免極快的回覆在註冊 future 之前就到達。
        self._reader = asyncio.create_task(self._read_loop())
        (await self.send(self.topic, "phx_join", {"fake2": 1})).require("加入 player channel")

    async def close(self) -> None:
        if self._reader:
            self._reader.cancel()
            try:
                await self._reader
            except (asyncio.CancelledError, Exception):
                pass
            self._reader = None
        if self._socket:
            try:
                await self._socket.close()
            except Exception:
                pass
            self._socket = None
        for fut in self._waiters.values():
            if not fut.done():
                fut.cancel()
        self._waiters.clear()

    # ---- 登入 -----------------------------------------------------------

    async def _login(self) -> str:
        payload = {
            "user[email]": self._email,
            "user[password]": self._password,
            "locale": LOCALE,
            "key": APP_KEY,
            "app_version": APP_VERSION,
        }
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json, text/plain, */*",
            "User-Agent": USER_AGENT,
        }
        loop = asyncio.get_running_loop()
        res = await loop.run_in_executor(
            None,
            lambda: requests.post(LOGIN_URL, headers=headers, data=payload, timeout=15),
        )
        if res.status_code >= 400:
            raise RFError(f"登入 HTTP {res.status_code}")
        data = res.json()
        if data.get("status") != "ok" or not data.get("data", {}).get("user_token"):
            raise RFError("登入失敗：回應沒有 user_token")
        self.user_id = data["data"]["user_id"]
        self.nickname = data["data"].get("nickname")
        return str(data["data"]["user_token"])

    # ---- 訊息收發 -------------------------------------------------------

    async def _read_loop(self) -> None:
        assert self._socket is not None
        async for raw in self._socket:
            try:
                frame = json.loads(raw)
            except Exception:
                continue
            # Phoenix v2 frame: [join_ref, ref, topic, event, payload]
            if not isinstance(frame, list) or len(frame) < 5:
                continue
            _join_ref, ref, _topic, _event, body = frame
            fut = self._waiters.pop(str(ref), None)
            if fut is None or fut.done():
                continue
            if isinstance(body, dict):
                fut.set_result(
                    Reply(str(body.get("status")), body.get("response") or {})
                )
            else:
                fut.set_result(Reply("error", {"message": "unexpected frame"}))

    async def send(
        self, topic: str, event: str, payload: dict[str, Any] | None = None
    ) -> Reply:
        """送一個事件並等回覆。future 在送出前就註冊，避免 reply-first race。"""
        if self._socket is None:
            raise RFError("尚未連線")
        self._ref += 1
        ref = str(self._ref)
        fut: asyncio.Future[Reply] = asyncio.get_running_loop().create_future()
        self._waiters[ref] = fut
        await self._socket.send(json.dumps([ref, ref, topic, event, payload or {}]))
        try:
            return await asyncio.wait_for(fut, timeout=self._timeout)
        except asyncio.TimeoutError:
            self._waiters.pop(ref, None)
            raise RFError(f"{event} 逾時（{self._timeout}s）") from None

    async def player(self, event: str, payload: dict[str, Any] | None = None) -> Reply:
        """對自己的 player channel 送事件。"""
        return await self.send(self.topic, event, payload)

    # ---- 常用查詢 -------------------------------------------------------

    async def cities(self) -> list[dict[str, Any]]:
        return (await self.player("cities")).require("cities").get("cities") or []

    async def profile(self) -> dict[str, Any]:
        pl = (await self.player("profile", {"user_id": self.user_id})).require("profile")
        inner = pl.get("profile")
        return inner if isinstance(inner, dict) else pl

    async def nation_of(
        self,
        profile: dict[str, Any] | None = None,
        cities: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """取出帳號所屬陣營 {id, name}。

        `profile.nation` 通常只有 `id`，沒有 `name`——客戶端是拿 id 去 `nations`
        清單查名字的（`DCContext` 的 myNation）。這裡改用 cities 裡每座城的
        `control_nation: {id, name}` 建對照表，省一次請求。

        查不到名字時 `name` 為 None，由呼叫端決定要不要當成錯誤處理，
        絕不要在這裡猜——猜錯會把兩個陣營的資料寫進同一個目錄。
        """
        p = profile if profile is not None else await self.profile()
        nation = p.get("nation")
        nid = nation.get("id") if isinstance(nation, dict) else p.get("nation_id")
        name = nation.get("name") if isinstance(nation, dict) else None

        if not name and nid is not None:
            source = cities if cities is not None else await self.cities()
            for c in source:
                cn = c.get("control_nation")
                if isinstance(cn, dict) and cn.get("id") == nid and cn.get("name"):
                    name = cn["name"]
                    break
        return {"id": nid, "name": name}

    async def slides(self, city_id: int) -> dict[str, Any]:
        """攻城劇情。未實作劇情的城市會回 status ok 但 slides 為空陣列。"""
        return (await self.player("slides", {"city_id": city_id})).require("slides")

    async def nation_slides(self) -> dict[str, Any]:
        return (await self.player("nation_slides")).require("nation_slides")

    async def city_sites(self, city_id: int) -> list[dict[str, Any]]:
        pl = (await self.player("city_sites", {"city_id": city_id})).require("city_sites")
        return pl.get("sites") or pl.get("city_sites") or []

    async def actors(self) -> list[dict[str, Any]]:
        return (await self.player("actors")).require("actors").get("actors") or []
