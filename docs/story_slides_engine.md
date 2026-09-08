# 劇情播放引擎（主線攻城／陣營／地下世界副本）

> 分析對象：`RF_mod/v3.01/main.d3867357.js.map`（webapp source map 內附原始碼）
> 前端版本：API `3.00`／Web build `3.01`
> 相關檔案：`pages/Story.js`、`lib/DCContext.js`、`routes.js`、`lib/funcs.js`、`iConfig.js`、`features/underworld/`
> 用途：靜態分析紀錄，供劇情資料抓取與「劇情重播」工具設計參考

主線劇情（攻城前／攻城後／陣營）與地下世界（UW）副本劇情共用同一支播放器
`pages/Story.js` 與同一份 slide 資料格式，只靠 `props.mode` 分岔。

一段劇情就是一個 `slides` 陣列。播放器一次吃一張 slide：畫背景、擺最多五個立繪、
以打字機效果吐一句對白，等玩家點螢幕換下一張。**路由本身就是播放進度**：

```
/story/{mode}/{cityId}
/story/{mode}/{cityId}/{_slideIdx}
```

因此播放邏輯可以完全離線重寫——只要拿得到 `slides` 陣列，不需要遊戲的 WebSocket 連線。

---

## 資料來源

全部走 Phoenix channel，topic 固定 `player:{user_id}`，由 `lib/DCContext.js` 統一收發。

| Phoenix 事件 | 送出參數 | 用途 | 發起處 |
|---|---|---|---|
| `slides` | `{city_id}` | 攻城劇情，戰前＋戰後一次全給 | `DCContext.getSlides()` |
| `nation_slides` | `{}` | 陣營開場劇情，不吃 `city_id` | `DCContext.getNationSlides()` |
| `uw_start_plot` | `{site_id, team_id}` | UW 副本：後端此時才扣能量並抽一段劇情 | `DCContext.uwStartPlot()` |
| `uw_finish_plot` | `{site_id, site_plot_id, team_id}` | 劇情播完／跳過時結算，回傳獎勵 | `DCContext.uwFinishPlot()` |

三個取得劇情的事件，成功回覆格式一致：

```jsonc
{
  "slides":   [ { /* slide */ }, { /* slide */ } ],
  "preloads": [ "/images/slide/background/T0009a.png", "..." ]  // 播放前先預載
}
```

`uw_start_plot` 的 payload 另外帶 `site_id`／`site_plot_id`／`team_id`／`city_id`，
整包存進 `DCContext.uwPlotR`（**寫在 localStorage**），結算時原封不動送回。

> **資料抓取的關鍵**：`slides` 事件只吃一個 `city_id` 就回整段攻城劇情，
> 不必真的發動攻城，是最乾淨的抓取管道。
> `union_apply.py` 的 `UnionApplyClient.send_msg(..., await_reply=True)`
> 已有完整的 login → Phoenix → 等待 reply 機制，加一個事件即可整包 dump。
>
> UW 劇情沒有這種旁路：`uw_start_plot` 是「抽」的，會扣 `sites.energy_charge`
> 且一次只回一段，要蒐集齊只能反覆執行。

### 實測：無劇情城市的 `slides` 行為

> 實測日期：2026-09-08　測試方式：唯讀查詢事件（`profile` / `cities` / `slides` /
> `nation_slides`），未執行任何改變遊戲狀態的操作

**`slides` 對任何 `city_id` 都回 `status: ok`，從不回錯誤**；沒有劇情的城市回的是空的
`slides: []`。因此「請求成功」不等於「拿得到劇情」，抓取端必須自己判斷長度。

實務上的判準是 `cities[].status`，共三種值：

| `cities[].status` | 城市數 | 抽樣結果 | 是否可抓 |
|---|---|---|---|
| `no_entry` | 213 | 0 / 3 有劇情 | ❌ 一律空陣列 |
| `locked` | 56 | 3 / 3 有劇情（124／146／158 張） | ✅ |
| `attackable` | 2 | 2 / 2 有劇情（114／132 張） | ✅ |

**空陣列的成因是劇情尚未實作，不是玩家進度不足。** 主線劇情目前只做到仰光，
之後的城市根本沒有內容可回。實測資料與此一致：該帳號的 `attackable` 是臺灣篇
I-1、I-2（主線幾乎未推進），卻仍能取得 58 座城的完整劇情——若門檻是進度，
可取得的數量不會這麼多。

因此 `locked` / `no_entry` 反映的是**該城是否屬於已實作的主線範圍**，
而非解鎖狀態；58 / 271 座（約 21%）應理解為目前的劇情實作進度，
會隨官方更新增加，與帳號進度無關。

> 註：本節抽樣的 `no_entry` 城市（維吾爾篇、東南亞篇）全數位於仰光之後，
> 故此次實測無法單獨驗證「章節未開放」是否也會造成空陣列。
> 上述結論的成因來自遊戲實際內容進度，非由本次抽樣推得。

其他欄位與結果無關，不可用作判準：

- `movable`：271 座中有 260 座為 `false`，指的是「以目前所在位置能否移動過去」
  （相鄰性），不是解鎖狀態。`movable: false` 的城照樣回完整劇情。
- `visitable`：僅 2 座為 `false`。
- `controlled`、`reward_collected`：有劇情與無劇情兩組取樣皆為 `False`。

因此收集腳本應**先以 `status != "no_entry"` 過濾**，可省下 200 次以上的無效請求。
由於範圍取決於官方實作進度，重跑收集時應重新取一次 `cities` 而非沿用舊清單。

> **副作用**：`slides: []` 是 truthy，正是 `Story.js` 中那段防呆註解記載的
> `TypeError reading 'fade_in'` 成因——導向沒有劇情的城市會讓劇情頁整頁崩潰。

---

## slide 欄位

欄位名與範例值取自 `Story.js` 檔尾保留的 `debugData`，並經 2026-09-08 實際回覆核對一致
（`placement` 確為 `a`–`e` 五格，每格含 `color_filter` / `effect` / `figure` / `shift_to`）。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | int | slide 唯一鍵；同時作為打字機元件的 React key，換 id 才重打一次字 |
| `background` | string | 背景圖路徑，如 `/images/slide/background/T0009a.png` |
| `speaker` | string \| null | 對話框左上的說話者；`null` 為旁白／無人說話 |
| `dialogue` | string \| null | 對白，**是 HTML**，以 `dangerouslySetInnerHTML` 塞入 |
| `dialogue_color` | bool | `true` 時對白多掛一個 `.dialogue_color` class（變色強調） |
| `placement` | object | 五個站位 `a`–`e` 的立繪配置，見下節 |
| `music` | string \| null | BGM 路徑；**未填等於停止音樂**（`playMusic(false)`），不是延續上一首 |
| `sound_effect` | string | 進場音效，播一次 |
| `duration` | float \| null | 強制停留秒數。有值就到時自動翻頁，且點螢幕只補完打字、不提前翻頁 |
| `fade_in` | bool | 與 `fade_out` 組成 `iStyle`：`fadein` / `fadeout` / `fadeinout` / `''` |
| `fade_out` | bool | 同上；`fadeout` 會把轉場 timeout 拉長為 1000ms（其餘 100ms） |
| `before_attack` | bool | 僅攻城劇情有意義：切開「戰鬥前」與「戰鬥後」兩段的旗標 |
| ~~`position`~~ | int | 後端排序值，前端只用陣列 index，未讀取 |
| ~~`fast_paging`~~ | bool | 後端有給，v3.01 播放器沒有任何一行讀它 |
| ~~`subtitle`~~ | string | **僅 UW 劇情有這個 key**（主線回傳沒有），實測 93 張全為空，播放器亦未讀取 |

`dialogue` 的 HTML 使用**自訂標籤**而非標準 HTML，例如
`靠的是<b9>信息落差</b9>。`——瀏覽器會當成未知元素，重播工具需自行定義這類標籤
的樣式對應，直接 `innerHTML` 只會得到無樣式的純文字。

UW 劇情的 `before_attack` 是無意義的殘值（實測 93 張中 92 張為 `true`）。
播放器在 `uw_plot` 模式一律從 index 0 開始、不讀此欄，但重播工具若沿用主線的
切段邏輯會切錯。

---

## 舞台：站位與立繪特效

`placement` 是固定的五個 key。位置與疊圖層級寫死在 `Story.js` 的 `avatarPoss`，
中間 `c` 最前、兩側往後遞減——自行重寫播放器時最容易漏掉的細節。

| 站位 | `left` | `zIndex` |
|---|---|---|
| `a` | 20% | 6 |
| `b` | 32% | 8 |
| `c` | 50% | 9 |
| `d` | 68% | 7 |
| `e` | 80% | 5 |

皆以 `translateX(-50%)` 定位。單一站位的內容：

```jsonc
"c": {
  "figure":       "/images/slide/actor/TW0301.png",  // null = 這格不出現任何人
  "effect":       "horizontal_shift",
  "shift_to":     "d",                               // 只有 horizontal_shift 會用到
  "color_filter": "black"                            // → CSS class filter_black
}
```

| `effect` | 行為 | 實作 |
|---|---|---|
| `fade_in` | 2 秒淡入 | opacity 0→1，duration 2000 |
| `swift_in` | 0.5 秒快速淡入 | opacity 0→1，duration 500 |
| `half_transparent` | 淡化到半透明（退到背景） | opacity 固定 0.7 |
| `motion` | 震動 | x 在 +10 / −10 之間插值來回八段 |
| `horizontal_shift` | 從本站位平移到 `shift_to` 的站位 | 對**外層容器**補間 left/zIndex |
| `null` | 直接出現 | — |

`figure` 副檔名為 `.gif` 時會多掛一個 `.gif` class——立繪 GIF 與靜態故事角色圖
構圖不同，套用另一組 CSS。

---

## 渲染順序

外層 `Story` 負責擋預載，內層 `_Story` 才真正播放。推進整個播放器的 state 只有兩個：
`slideIdx` 與 `dialogueComplete`。

1. **外層 `Story` 擋預載**
   依 mode 送出對應事件取得 slides，把 `preloads` 交給 `useImagePreloader`；
   在 `slides` 或圖片未到齊前一律顯示 `<Loading>` 進度條。
   原始碼註解說明用意是「避免劇情背景音樂在預載階段就播放」。

2. **決定起始 index**
   網址未帶 `_slideIdx` 時：`story_nation`／`before_attack`／`uw_plot` 從 0 開始；
   `after_attack` 掃到**第一個 `before_attack === false`** 的 slide 當起點。

3. **算出 `iStyle`**
   由 `fade_in`／`fade_out` 兩個 bool 組出轉場 class 名。
   此處有一段防呆：後台把劇情設 active 卻沒編任何 slide 時後端回 `slides: []`，
   空陣列是 truthy，直接讀 `.fade_in` 會整頁崩潰（原始碼有記錄此回報）。

4. **音效與計時**
   `music` 有值就播、無值就停；`sound_effect` 播一次。
   有 `duration` → 到時自動翻頁；否則若開啟自動播放 → 固定停 3 秒；都沒有就等點擊。

5. **背景轉場**
   `SwitchTransition` + `CSSTransition`，**key 綁 `slide.background` 而非 `slideIdx`**——
   連續多張同背景的 slide 不會重跑轉場。

6. **擺立繪**
   走訪 `placement` 五個 key，`figure` 為 `null` 者跳過，其餘各渲染一個 `<Character>`
   （`React.memo` + JSON 深比較，資料未變不重繪）。

7. **打字機吐對白**
   Typed.js，`typeSpeed: 1`、無游標字元；打完呼叫 `callback_complete()` 把
   `dialogueComplete` 設 `true`，之後改用靜態 HTML 顯示。

8. **等點擊 → `goNext()`**
   全螢幕有一層感應區。**第一下補完打字、第二下才翻頁**；
   但若該張有 `duration`，點擊永遠只做「補完打字」。

附帶 UI：

- **LOG 面板**：列出 `slides` 中 index ≤ 目前、且 `dialogue` 非空者（speaker + 對白 HTML），
  自動捲到底。
- **自動播放鍵**：切換後每張停 3 秒；開啟瞬間先排一個 1 秒 timer 推進第一張。

---

## 四種 mode 的觸發與收尾

| mode | 進入點 | 播完之後 | 可跳過 |
|---|---|---|---|
| `story_nation` | `pages/settings/Nation.js` 選完陣營 → `/story/story_nation/fakeCityId`（cityId 是假的，不會用到） | 導回 `/home` | **不可**，跳過鍵與返回鍵都隱藏 |
| `before_attack` | `Attackteams.js` 收到 `new_attack` ok 之後 | 播到下一張 `before_attack` 為 `false` 就進 `/attacks/attack` | 可（先跳確認框） |
| `after_attack` | `Attackresult.js` 戰鬥結算後 | 回 `/attacks/attackmap` | 可；返回鍵等同跳過 |
| `uw_plot` | `UwTeams.js` 按「派遣」→ `uw_start_plot` | 送 `uw_finish_plot` 結算，再進 `/attacks/uwplotresult` | 可；返回鍵等同跳過（一樣會結算） |

只有 `before_attack` 會用 `history.block` 攔住換頁，跳「確定要放棄任務？」並在確認後送
`drop_attack`。因為白名單放行時會呼叫 `unblock()`，**每翻一張 slide 都得重新 block 一次**。

---

## UW 副本的完整鏈路

UW（地下世界）劇情只是這條鏈的中段。副本全程不出現戰鬥畫面——派遣、播劇情、發獎。

1. **城內介面 `UwTown`**
   點 Visit / Explore 類型的 site → `navigate('/user/teams/uwplot')`，帶
   `site_id`、`energyCharge`、`city_id`。此時尚未扣任何資源。

2. **選隊 `UwTeams mode="uwplot"`**
   按「派遣」才送 `uw_start_plot {site_id, team_id}`，後端這時扣 `sites.energy_charge`
   並抽一段劇情。能量不足會回 `energy_boost_options`，前端跳補充能量視窗。

3. **導向劇情**
   `/story/uw_plot/{site_id}`。注意路由參數名為 `cityId`，實際塞的是 site_id——
   播放器在 `uw_plot` 模式下不會使用它。

4. **播放**
   播放器不重新請求，直接吃 `DCContext.uwPlotR.slides`。

5. **結算 `uw_finish_plot`**
   播完或跳過都會送，參數 `{site_id, site_plot_id, team_id}`。
   回覆帶 `collected_items {items, actors}`、`uw_music`、`city_id`。

6. **結算畫面 `UwPlotResult`**
   使用每日領取那套「恭喜獲得」公版（`BundleReceivedAlert`），不是攻城的勝敗版面，
   也不播勝敗音效；沒中獎（`spoil_probability` 未擲中）就直接回城內。
   `good_ending` 只決定是否解鎖下一級，不影響畫面。

> **已知坑**：`uwPlotR` 存在 localStorage，會一直留著上一次抽到的劇情。
> `UwTeams` 因此加了 `startedRef` 旗標：沒有它的話，第二次進選隊畫面會被舊資料
> 立刻導去劇情頁，不扣能量、每次都播同一段，表現得像「機率壞掉、結局固定」。

---

## UW 的多段結構與可重看性

### 一個 site 有多段劇情

Visit / Explore 類型的 site 在城內介面顯示為 `名稱（cur_level/max_level）`
（`UwTown.js` 的 `renderSite`）：

```js
big = `${s.name || ''}（${s.cur_level ?? 0}/${s.max_level ?? 0}）`;
```

即**一個 site 內含 `max_level` 段劇情，依序解鎖**，`cur_level` 為目前進度。
`UwPlotResult.js` 註解說明 `good_ending` 只決定是否解鎖下一級——因此不是每次派遣
都會前進，抽到非 good ending 就停在原級。

site 之間也會互相擋：`conditionText` 的條件型別含 `SitePlot`（詞句
`uw_site_cond_site_plot`：「需完成 {{name}}{{level}}」），代表某些 site 要先把
別的 site 推到指定級數才會開放。

### 條件是「每一級」各自一組（實測）

> 實測日期：2026-09-08，於烏蘭巴托（city 110）site 666「納蘭圖勒市場」派遣一次

`sites[].condition` 顯示的是**當前這一級**的要求，會隨 `cur_level` 前進而更換：

```
派遣前   site=666  lv=1/2  state=5  cond=Actor(其其格)
派遣後   site=666  lv=2/2  state=4  cond=ActorRelationLevel(其其格 lv=2)
```

第一級只要「擁有其其格」，第二級改為「與其其格關係達 2 級」；條件未滿足時
`state` 由 5 轉為 4，而 `UwTown.js` 的 `clickable = st !== 4` 使該站點不可點。

這同時證實 `good_ending: true` 會推進 `cur_level`。**實務含意**：UW 後段劇情卡在
關係等級這類需長期養成的進度上，不是花能量就能刷完——這比能量成本更硬。

### 派遣有位置限制（實測）

`uw_start_plot` 要求角色**當下就在該座城市**，否則後端直接回錯誤、不扣能量：

```
uw_start_plot -> error | 　　您已離開此城鎮，無法在此進行操作。
payload keys: ['message', 'status', 'update_data']
```

對應 `UwTown.js` 的 `if (!inCity || !clickable) return;`。跨城蒐集必須先用
`uw_move_cost` / `uw_move_to_city` 移動過去，成本高於單純的 `energy_charge`。

### 實際的 payload（實測）

`uw_start_plot` 成功回覆（site 666 一次派遣，93 張 slide）：

| 欄位 | 說明 |
|---|---|
| `slides` | 劇情本體 |
| `preloads` | 預載清單（此例 4 筆） |
| `site_plot_id` | 本段的識別碼（此例 70），`uw_finish_plot` 要帶回 |
| `level` | 本段對應的級數 |
| `site_name` | 站點名稱 |
| `site_id`／`city_id`／`team_id` | 回聲參數 |
| `update_data` | 伺服器一併回推的狀態（此例含 `profile`） |

`uw_finish_plot` 回覆：`good_ending`、`rewarded`、`collected_items`、`uw_music`、
`city_id`、`site_id`、`site_plot_id`、`update_data`。

失敗時回 `{message, status, update_data}`，`slides` 不存在。

### 客戶端無法指定看哪一段

- `uw_start_plot` 只接受 `{site_id, team_id}`，**選哪一段由後端決定**。
- 沒有任何事件會回傳某個 site 的 `site_plot_id` 清單；`site_plot_id` 只在
  `uw_start_plot` 的回覆中單向出現，供 `uw_finish_plot` 帶回。
- 每次派遣都扣 `sites.energy_charge`。

所以在遊戲內，**已推進過去的段落沒有回頭路**。

### 唯一的例外：localStorage 裡的最後一段

`uwPlotR`（含完整 `slides`）以 `useLocalStorage` 保存，只有在下次呼叫
`uwStartPlot()` 時才被清空（`DCContext.js`），重整頁面不會消失。
`Story` 在 `uw_plot` 模式下不重新請求、直接讀它。

因此只要中間沒有再派遣，直接開 `/story/uw_plot/{site_id}` 就會重播上一段——
這正是 `UwTeams` 必須加 `startedRef` 旗標來防堵的行為。

### 對重播工具的意涵

| 劇情種類 | 能否重複取得 | 說明 |
|---|---|---|
| 攻城（`slides`） | ✅ 無限次 | 純查詢事件，不扣資源、不改狀態，同 `city_id` 送幾次回幾次 |
| 陣營（`nation_slides`） | ✅ 無限次 | 同上 |
| UW 副本（`uw_start_plot`） | ⚠️ 僅能累積 | 每次扣能量、需人在該城、後段卡養成條件，且無法指定段落 |

> ### ⚠️ UW 劇情文本帶有抓取者的玩家名
>
> 實測 site 666 的 93 張 slide 中，`speaker` 為玩家自身名稱者 36 句，
> 另有 4 句的 `dialogue` 內文嵌入玩家名（其餘 47 句為 NPC「其其格」）。
> 主線劇情沒有這個情形。
>
> **抓到的 UW 文本等同帶著抓取帳號的身分。** 公開前必須把玩家名以佔位符
> （例如「主角」）取代，否則等於將帳號名散佈出去。這是上線前的阻斷性項目，
> 不是選配的清理步驟。

主線劇情抓一次即永久可用。UW 則需改用**累積式蒐集**：在抓取端掛鉤，每次派遣後
把回覆 dump 一份，以 `site_plot_id` 去重存進劇情庫。看過一次就永久可重看——
對重播工具而言限制比遊戲本身寬鬆，但湊齊單一 site 的 `max_level` 段需要反覆派遣，
能量成本是唯一無法繞過的瓶頸。

---

## 素材網址解析

slide 內的路徑全為相對路徑。`lib/funcs.js` 的 `validImageSrc` 依序嘗試三個來源，
第一個載得起來的就採用：

```js
// 1. App 下載的離線素材（純網頁環境沒有 window.deviceInfo，直接跳過）
`${window.deviceInfo.assetsDL_path}${path}`

// 2. 打包進 App 的內建素材
`./passionfruit${path}`

// 3. 遠端 CDN —— 網頁版實際上都走這條
`https://media.komisureiya.com${path}`

// 三者都會再接一個以「月日時」為單位的快取破壞參數
+ `?t=${moment().format('MMDDHH')}`
```

`iConfig.hosts` 中，正式站（level 0）與公測站（level 1）的 `remoteAssets` 皆為
`https://media.komisureiya.com`，內測／開發站為 `https://staging.komisureiya.com`。

所以一張背景圖的完整網址為
`https://media.komisureiya.com/images/slide/background/T0009a.png`，
音樂同理（`/audio/music/BGM22.mp3`）。

---

## 劇情重播工具的設計建議

三層彼此獨立，第一層完成即有價值。

### 抓取層（一次性 Python script）

沿用 `union_apply.py` 的 `UnionApplyClient`：login 取得 token → 連
`wss://api.komisureiya.com/socket/websocket` → join `player:{user_id}` →
對每個 city_id 送 `slides`，把回覆整包存成 JSON。

先送 `cities {}` 取得城市清單，濾掉 `status == "no_entry"` 者（見上方實測），
再對其餘城市逐一送 `slides`：

```python
# 概念示意，實際請用 UnionApplyClient.send_msg(..., await_reply=True)
city_ids = [c["id"] for c in cities if c.get("status") != "no_entry"]
for city_id in city_ids:
    reply = await client.send_msg(
        topic=f"player:{user_id}", event="slides",
        payload={"city_id": city_id}, await_reply=True,
    )
    dump[city_id] = reply["payload"]["slides"]
```

`nation_slides` 送一次即可。之後掃過所有 slide 的 `background`／`figure`／`music`／
`sound_effect` 收成素材清單。城市 id 可由 `cities` 事件取得（見
[rf_mod_3.0_phoenix_probe.md](rf_mod_3.0_phoenix_probe.md)）。

### 資料層（靜態 JSON）

- 一段劇情一個檔：`{ id, title, mode, city_id, slides: [...] }`。
- 攻城劇情**依 `before_attack` 切成戰前／戰後兩章**，遊戲裡本來就是分兩次播的。
- 另存索引：劇情清單、登場角色、背景圖，供搜尋與目錄使用。
- 素材路徑改寫成自有前綴，別把 `media.komisureiya.com` 寫死在前端。
- **UW 劇情入庫前先把 `speaker` 與 `dialogue` 中的玩家名替換成佔位符**
  （見上方警告），這一步要放在寫檔前，不能留到前端顯示時才做。

### 播放層（重寫，不要移植）

原播放器綁了 `DCContext`、Phoenix、路由攔截、預載，重播工具全都不需要。
真正要照抄的只有：

- `avatarPoss` 的五個站位座標與 z-index。
- 五種 `effect` 的時長與行為；`horizontal_shift` 動的是外層容器而非圖片本身。
- 背景轉場的 key 綁 `background` 而非 index。
- 「點一下補完打字、再點一下翻頁」，以及 `duration` 會改變這個規則。
- `dialogue` 是 HTML——需自行消毒，別原封不動 `innerHTML`。
- `music` 為空代表停止音樂，不是延續。

因為 slides 是純資料，其餘（可拖曳進度條、跳至任一 slide、全文模式、
以角色或背景為索引瀏覽）都只是 UI 問題。

### 注意事項

- 直接熱連結 `media.komisureiya.com` 等於把流量掛在對方帳上，且對方改版就整站失效。
  要嘛自行鏡像用到的素材，要嘛在站上明確標示來源——這應在上線前決定。
- 抓取需要有效帳號登入。依 repo 慣例，token 與密碼不得寫入版控或未遮蔽記錄
  （見 `sanitize_log_text`）。
