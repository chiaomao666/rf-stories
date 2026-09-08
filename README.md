# rf-stories

RF（`api.komisureiya.com`）遊戲劇情的抓取、保存與重播工具。

UI 字串與文件維持正體中文。

## 內容

| 路徑 | 說明 |
| --- | --- |
| `docs/story_slides_engine.md` | **先讀這份**：劇情播放引擎的完整拆解——slide 格式、渲染順序、四種觸發模式、UW 副本鏈路、素材網址解析，含多次實測紀錄 |
| `rf_stories/client.py` | 最小 Phoenix 客戶端（登入 → WebSocket → player channel → 查詢事件） |
| `rf_stories/anonymize.py` | 把劇情文本裡的玩家名換成佔位符 |
| `scripts/fetch_main_story.py` | 抓全部主線攻城劇情 + 陣營劇情 |
| `scripts/uw_probe.py` | UW 站點偵查；`--dispatch` 可實際派遣抓取（會扣能量） |
| `scripts/scrub_data.py` | 替既有資料補做玩家名去識別化 |
| `data/` | 抓下來的劇情 JSON（已去識別化，見下方說明） |

## 安裝

需要 Python 3.11+。

```bash
pip install -r requirements.txt
```

## 抓取

憑證由環境變數提供，不要寫進檔案：

```bash
export RF_EMAIL=...
export RF_PASSWORD=...
```

### 主線劇情

主線劇情有**兩種版本：紅軍與非紅軍**（不是九個陣營各一套）。
腳本依登入帳號的陣營自動判定並分開存放，所以要收齊全部內容，
需要用一個紅軍帳號與一個非紅軍帳號**各跑一次**：

```bash
RF_EMAIL=<非紅軍帳號> RF_PASSWORD=... python scripts/fetch_main_story.py
RF_EMAIL=<紅軍帳號>   RF_PASSWORD=... python scripts/fetch_main_story.py
```

`slides` 是純查詢事件——不扣資源、不改變遊戲狀態，可以隨時重跑。
預設只打 `status != "no_entry"` 的城市（其餘尚未實作劇情，一律回空陣列），
官方更新主線後重跑一次即可補上新內容。

輸出（`red_army` / `non_red_army` 由陣營自動判定，可用 `--variant` 覆寫）：

```
data/
├── red_army/
│   ├── index.json          # 變體、陣營、城市清單、章節、各段張數
│   ├── assets.json         # 用到的所有圖／音路徑
│   ├── nation_story.json   # 陣營劇情
│   └── main_story/
│       └── city_<id>.json  # 單城完整 slides
└── non_red_army/
    └── ...                 # 同上
```

### UW 副本劇情

```bash
python scripts/uw_probe.py                # 唯讀：掃九陣營 HQ 的站點
python scripts/uw_probe.py --city 110     # 只看一座城
```

實際派遣（**會扣能量、可能推進進度，不可逆**）：

```bash
python scripts/uw_probe.py --dispatch 666 --team 84058 --yes
```

UW 的限制比主線多得多，動手前先讀文件的「UW 的多段結構與可重看性」一節：

- 每次派遣扣 `energy_charge`，且**角色必須當下就在該座城市**
- 開放條件是**每一級各自一組**，後段常卡在關係等級這類長期養成進度
- 後端隨機抽選，客戶端無法指定要看哪一段

因此 UW 只能**累積式蒐集**：在平常遊玩的流程裡持續 dump，以 `site_plot_id` 去重。

## ⚠️ 玩家名

伺服器會把登入帳號的暱稱直接代入 `speaker` 與 `dialogue`，**主線與 UW 都會**
（全量抓取實測：非紅軍 1,929 處、紅軍 3,253 處）。

抓取腳本會在寫檔前自動替換成「主角」，既有資料可用 `scripts/scrub_data.py` 補做：

```bash
python scripts/scrub_data.py data/non_red_army --player-name <暱稱> --check  # 先檢查
python scripts/scrub_data.py data/non_red_army --player-name <暱稱>          # 再替換
```

暱稱可能是任意字串（例如某測試帳號的暱稱就是單一底線 `_`），所以一定要用帳號的
實際暱稱替換，不要靠樣式猜測。**公開任何資料前請再確認一次**——
帶著玩家名的文本等同散佈帳號身分。

## 資料與版控

`data/` 收錄已去識別化的劇情資料（玩家名已替換為「主角」）。
**未經清理的原始 dump 不要放進來**——文本會帶抓取帳號的暱稱。

目前內容：

| | 紅軍 | 非紅軍 |
|---|---|---|
| 城市 | 51 | 51 |
| slide | 8,289 | 8,867 |
| 陣營劇情 | 26 | 22 |
| 素材 | 430 | 500 |

兩個版本逐張比對後確認**零重疊**：51 座城沒有任何一張共用 slide id，
文本與登場角色都不同，是兩套完全獨立的平行主線，而非共用劇情加分支。
素材共用 246 個，各自獨有 184 / 254。

素材（背景、立繪、音樂）本身不在這裡，路徑是相對的，
實際位於 `https://media.komisureiya.com`。直接熱連結等於把流量掛在對方帳上，
且對方改版就整站失效——見文件的「素材網址解析」一節。
