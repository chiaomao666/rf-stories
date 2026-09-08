# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

專案文件、註解、CLI 輸出與 UI 字串一律使用**正體中文**（見 README）。

## 專案性質

RF（`api.komisureiya.com`，Phoenix/WebSocket 後端）遊戲劇情的**抓取 → 去識別化 → 靜態重播**流程。
不是應用程式，是「一次性抓取腳本 + 版控資料集 + GitHub Pages 靜態站」三段式的資料專案。

沒有測試、沒有 linter 設定、沒有 CI。驗證靠腳本自身的 `--check` / 自我驗證與人工重跑。

## 常用指令

```bash
pip install -r requirements.txt          # Python 3.11+，只需 requests + websockets

export RF_EMAIL=... RF_PASSWORD=...      # 憑證只走環境變數，絕不落檔

python scripts/fetch_nation_story.py                    # 只抓陣營劇情（補其他陣營用）
python scripts/fetch_nation_story.py --check            # 看已收錄哪些陣營
python scripts/import_uw_capture.py <匯出檔> --check     # 匯入 UW 側錄結果

python scripts/fetch_main_story.py                      # 抓主線＋陣營劇情（自動判定變體）
python scripts/fetch_main_story.py --variant red_army   # 覆寫變體判定
python scripts/fetch_main_story.py --all                # 不過濾 status，打全部 271 座城

python scripts/scrub_data.py data/red_army --player-name <暱稱> --check   # 只檢查殘留
python scripts/scrub_data.py data/red_army --player-name <暱稱>           # 實際替換

python scripts/uw_probe.py                              # 唯讀掃九陣營 HQ 站點
python scripts/uw_probe.py --city 110
python scripts/uw_probe.py --dispatch <SITE_ID> --team <TEAM_ID> --yes    # ⚠️ 扣能量、不可逆

python -m http.server 8000               # 本機預覽站台 → http://127.0.0.1:8000/site/
```

## 架構

```
rf_stories/client.py      RFClient：HTTPS 登入 → Phoenix WS → join player channel → send/await reply
rf_stories/anonymize.py   scrub_slides / count_occurrences（純函式，不碰 IO）
scripts/*.py              CLI 進入點，各自 sys.path.insert(ROOT) 後 import rf_stories
data/<variant>/           版控的成品資料集（全 repo 唯一一份）
site/                     GitHub Pages 靜態重播站，由 Actions 部署
docs/                     只放 .md 文件
docs/story_slides_engine.md  ★ 動任何播放／資料格式相關的東西前先讀這份
```

`RFClient` 的協定細節：Phoenix v2 frame 是 `[join_ref, ref, topic, event, payload]`，
`send()` 用遞增 ref 對應 future，且**在送出前就註冊 future**（避免 reply-first race）；
reader task 也是在 join 之前就啟動，同樣是為了這個競態。`max_size` 設 16MB——單城可達 340 張 slide。

## 三個容易踩的不變式

1. **紅軍 / 非紅軍是兩套完全獨立的平行主線**，不是九陣營各一套、也不是共用劇情加分支
   （51 城逐張比對確認零重疊）。`fetch_main_story.py` 依登入帳號陣營自動判定並寫進
   `data/red_army/` 或 `data/non_red_army/`。**陣營判不出來時腳本直接中止**——曾經預設非紅軍，
   結果紅軍帳號覆蓋掉另一份資料。同理 `index.json` 的 `user_id` 不符時也會擋下來（需 `--force`）。
   要收齊全量必須用兩個不同陣營的帳號各跑一次。

2. **玩家身分去識別化是入庫前的硬性關卡**。伺服器把登入帳號的**暱稱與組織名**都直接代入
   `speaker` 與 `dialogue`（實測非紅軍暱稱 1,929 處＋組織名 35 處、紅軍暱稱 3,253 處），
   兩者都取自 profile（`userProfile.nickname` / `.organization`）。抓取時自動替換為
   「主角」與「組織」，既有資料用 `scrub_data.py --player-name X --organization Y` 補做。
   兩者都可能是任意字串（有測試帳號兩者都是單一底線 `_`），**只能用帳號實際值替換、
   不可用樣式猜測，且務必先 `--check`**——盲目替換單字元會毀掉正常文本
   （`city_32.json` 有顏文字 `(ಥ _ ಥ)`）。未清理的原始 dump 不得進版控。
   `fetch_main_story.py` 取不到暱稱時會直接中止，不會默默寫出帶身分的資料。

3. **寫檔一律先 `.tmp` 再 `replace()`**（三支腳本各有一份 `write_json`），中斷不留半個檔。

## 三種劇情的存放單位不同

搞混這件事會讓資料互相覆蓋，是這個 repo 踩過最多次的坑：

| 劇情 | 單位 | 位置 |
|---|---|---|
| 主線攻城 | 紅軍／非紅軍**兩種版本** | `data/<variant>/main_story/city_<id>.json` |
| 陣營劇情 | **九個陣營各一套** | `data/nation_story/nation_<陣營 id>.json` |
| UW 副本 | 不分陣營 | `data/uw_plots/site_<id>_plot_<plot_id>.json` |

陣營劇情曾被誤放在 `data/<variant>/nation_story.json`——非紅軍那份其實是「蒙古」的
故事，換一個非紅軍陣營的帳號來抓就會互相覆蓋。現在改以陣營 id 為主鍵，
`rf_stories/nation_story.py` 的 `save_nation_story()` 只動自己那一個陣營，
index.json 用合併的方式更新。

UW 只能**累積式蒐集**：每次派遣扣能量、角色必須當下就在該城、後端隨機抽段。
實務上用 `site/tools/rf_uw_capture.js` 邊玩邊側錄（掛 WebSocket，看到帶
`site_plot_id` 的回覆就收，以此去重），再用 `import_uw_capture.py` 合併進來。

## 城鎮順序

遊戲的城鎮順序鍵是 **`cities.position`**（由小到大），Attackmap 的左右鍵就是依它跳轉，
所以探險與特別篇會穿插在主線篇章之間。`chapter` 物件只有 `name`/`number`/`serial`，
**沒有跨章節的排序鍵**——只靠 chapter_name 排會得到跟遊戲完全不同的順序。
`position >= 10000` 是隱藏城（卡加布列島 10060），座標刻意放在地圖外，只能由 UW Access 進入。

`fetch_main_story.py` 會把 `position` 寫進 index.json 並依它排序；站台 (`site/js/archive.js`)
同樣以 position 為主鍵，缺席時才退回章節排序並在頁面上標示。

## 事件與副作用

- `slides` / `nation_slides` / `cities` / `city_sites` / `actors` 是**純查詢**：不扣資源、不改狀態，可隨時重跑。
  官方更新劇情後重跑 `fetch_main_story.py` 即可增量補上。
- 預設只打 `status != "no_entry"` 的城市（其餘一律回空陣列）；`--all` 用來驗證這個過濾條件是否仍成立。
- `uw_start_plot` **有副作用**：扣 `energy_charge`、可能推進 `cur_level`，且要求角色當下就在該城。
  後端隨機抽段，客戶端無法指定，所以 UW 只能靠平常遊玩累積式蒐集、以 `site_plot_id` 去重。
  派遣後必須送 `uw_finish_plot` 收尾，否則留下未結算的 plot。

## site/ 靜態站

```
site/index.html   索引頁 + 播放器的 DOM
site/css/         site.css（索引頁）／story.css（舞台、站位、特效、對話框）
site/js/          config（常數）、assets（路徑解析）、audio、typewriter、story（引擎）、
                  archive（索引資料）、main（接線）——ES modules，無打包步驟
site/assets/      素材，維持與 slide 內相同的相對路徑（images/... 與 audio/...）
site/tools/       rf_story_capture.js，貼進遊戲 console 側錄 [Story] log
```

- **資料只有一份**：`data/` 在 repo 根目錄，`.github/workflows/pages.yml` 部署時複製成 `site/data/`
  （已 gitignore）。`site/js/assets.js` 的 `resolveDataBase()` 會依序探測 `data/` 與 `../data/`，
  所以本機從 repo 根目錄起 server、線上從站台根目錄跑，兩種都能載到資料。
- **素材缺檔自動回退 CDN**：本地 `site/assets/` 載不到就用 `https://media.komisureiya.com`。
  目前主線引用的 467 張圖本地有 352 張，音訊 217 個檔一個都還沒收錄。
- **播放器是重寫不是移植**。所有時間／座標常數集中在 `site/js/config.js`，數值出處是
  `docs/story_slides_engine.md` 的實測紀錄，改動前先回頭核對文件，兩邊要一起改。
- 全量資料掃描結果（決定實作範圍用）：`effect` 五種都有出現、`color_filter` 只有
  `black` 與 `red`、對白的自訂標籤只有 `<b9>`（另有 `br`/`i`/`b`）、`duration` 最常見 1.0／0.3／1.4 秒。
- `assets/vendor/` 是遊戲端原始碼（含 `.map`）的比對位置，已 gitignore。**改播放器樣式前先去那裡查真值**：
  `static/js/main.*.js.map` 的 sourcesContent 有 `pages/Story.js` 與 `pages/Story.module.scss`，
  `static/css/main.*.css.map` 有 `index.css`。已校正過的關鍵值：舞台設計基準 2800×1600（7:4）、
  縮放單位 `min(57vw,100vh)`、立繪三層結構（posBox 滿版裁切 → actorImgBox 135%／GIF 100% → img）、
  `b9{font-weight:900}`（沒有顏色）、`filter_black{brightness(50%)}`、`dialogue_color{color:#ccc}`、
  轉場一律 `opacity 1000ms ease-out`（文件裡的 100/1000ms 是 CSSTransition 的 timeout，不是動畫長度）。
  站台 CSS 把遊戲的 `vw` 換成 `cqw`（舞台是 container），比例才跟遊戲一致。
