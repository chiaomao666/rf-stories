// rf_uw_capture.js
//
// 邊玩邊蒐集 UW（地下世界副本）劇情。
//
// 為什麼需要這個：UW 劇情沒辦法像主線那樣一次抓完——每次派遣扣 energy_charge、
// 角色必須當下就在該座城市、後端還會隨機抽選要播哪一段，客戶端無法指定。
// 所以只能「累積式蒐集」：在平常遊玩的流程裡把每次看到的劇情 dump 下來，
// 以劇情內容去重；相同 site_plot_id 的不同結果也要保留。詳見 docs/story_slides_engine.md 的
// 「UW 的多段結構與可重看性」一節。
//
// UW 劇情不分陣營，看到什麼就收什麼。
//
// 用法：在遊戲頁面的 Console 貼上整份執行，右下角會出現面板。
// 之後照常玩，每派遣一次 UW 就會自動收一筆。要入庫時按「下載 JSON」，
// 再用 scripts/import_uw_capture.py 匯入 data/uw_plots/。
//
// ⚠️ 劇情文本會帶你的暱稱與組織名。這支腳本在**收到當下**就做去識別化，
// localStorage 與匯出檔裡永遠只有清乾淨的文本。
//
// 身分來自登入後的 `profile` 回覆（`profile.nickname` / `.organization`）。
// 改過名的帳號會累積記住每一個看過的暱稱與組織名，舊名也一起替換——
// 舊版只換「匯出當下」那一個名字，導致改名前側錄的段落整段沒清到。
// 還沒認出暱稱就收到劇情時，該段只暫存在記憶體（不落地），
// 等 profile 到手或你在面板手動填入後自動補做並入庫。
(function () {
    'use strict';

    if (window.__RF_UW_CAPTURE_STARTED__) {
        console.log('[UW] 已經在執行了');
        return;
    }
    window.__RF_UW_CAPTURE_STARTED__ = true;

    var STORAGE_KEY = 'rf_uw_capture_v1';
    var PLACEHOLDER = '主角';
    var ORG_PLACEHOLDER = '組織';

    var plots = {};        // site_plot_id + 內容指紋 -> record
    var cityNames = {};    // city_id -> 城市名稱
    var identity = { nickname: null, organization: null };
    // 累積記住所有看過的名字，改名後舊段落才不會漏清。
    var aliases = { nicknames: [], organizations: [] };
    // 還沒認出暱稱時收到的劇情：只放記憶體，絕不寫進 localStorage。
    var pending = [];
    var panelEl, countEl, pendingEl, statusEl, idEl;

    // ---- 儲存 -------------------------------------------------------------

    function load() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            var saved = JSON.parse(raw);
            plots = saved.plots || {};
            cityNames = saved.cityNames || {};
            identity = saved.identity || identity;
            aliases = {
                nicknames: (saved.aliases && saved.aliases.nicknames) || [],
                organizations: (saved.aliases && saved.aliases.organizations) || []
            };
            // 舊版沒有 aliases，用當時的 identity 補起來。
            rememberAlias('nickname', identity.nickname);
            rememberAlias('organization', identity.organization);
        } catch (error) {
            console.warn('[UW] 讀取既有紀錄失敗，從空的開始', error);
        }
        // 舊版是匯出時才清，localStorage 裡可能躺著帶身分的原文。
        var cleaned = rescrubStored();
        if (cleaned) {
            console.warn('[UW] 既有紀錄有 ' + cleaned + ' 處殘留身分，已就地清掉');
            save();
        }
    }

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                plots: plots,
                cityNames: cityNames,
                identity: identity,
                aliases: aliases
            }));
        } catch (error) {
            // localStorage 大約只有 5MB，UW 劇情一段就可能上百 KB。
            flashStatus('儲存失敗（容量已滿）——請先下載再清空');
            console.warn('[UW] localStorage 寫入失敗', error);
        }
    }

    function count() {
        return Object.keys(plots).length;
    }

    function contentKey(response) {
        var text = JSON.stringify(response.slides || []);
        var hash = 2166136261;
        for (var i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return String(response.site_id) + ':' + String(response.site_plot_id) + ':' + (hash >>> 0).toString(16);
    }

    function rememberCity(cityId, name) {
        if (cityId === undefined || cityId === null || !name || name === '-') return false;
        var key = String(cityId);
        if (cityNames[key] === name) return false;
        cityNames[key] = name;
        Object.keys(plots).forEach(function (plotKey) {
            if (String(plots[plotKey].city_id) === key) plots[plotKey].city_name = name;
        });
        return true;
    }

    function rememberCities(obj) {
        if (!obj || typeof obj !== 'object') return false;
        var changed = false;
        var cities = Array.isArray(obj) ? obj : obj.cities;
        if (Array.isArray(cities)) {
            cities.forEach(function (city) {
                if (!city || typeof city !== 'object') return;
                var id = city.id !== undefined ? city.id : city.city_id;
                var name = city.name || city.city_name || city.city_title || city.title;
                if (rememberCity(id, name)) changed = true;
            });
        }
        return changed;
    }

    // ---- 去識別化 ---------------------------------------------------------

    function rememberAlias(key, value) {
        var name = typeof value === 'string' ? value.trim() : '';
        if (!name) return false;
        var bucket = key === 'nickname' ? aliases.nicknames : aliases.organizations;
        if (bucket.indexOf(name) !== -1) return false;
        bucket.push(name);
        if (name.length <= 2) {
            // 有測試帳號的暱稱與組織名都是單一底線；全文替換一定會誤傷正常文本
            // （主線 city_32 就有顏文字 (ಥ _ ಥ)）。照樣替換，但要留下痕跡。
            console.warn('[UW] 記住的名字只有 ' + name.length +
                ' 個字，全文替換可能誤傷正常文本，匯入前務必先跑 --check');
        }
        return true;
    }

    // 先換長的：組織名若包含暱稱，先換短的會把長的切碎。
    function substitutions() {
        var subs = [];
        aliases.nicknames.forEach(function (name) { subs.push([name, PLACEHOLDER]); });
        aliases.organizations.forEach(function (name) { subs.push([name, ORG_PLACEHOLDER]); });
        return subs.sort(function (a, b) { return b[0].length - a[0].length; });
    }

    function anonymizationStamp() {
        return {
            nickname: aliases.nicknames.length > 0,
            organization: true,
            // 帳號本來就沒有組織名時沒有東西可漏，不該卡住匯出。
            organization_source: aliases.organizations.length ? 'replaced' : 'none'
        };
    }

    function shortAliasLengths() {
        // 只回報長度，不回報名字本身——匯出檔不該帶任何身分字串。
        return aliases.nicknames.concat(aliases.organizations)
            .filter(function (name) { return name.length <= 2; })
            .map(function (name) { return name.length; });
    }

    function scrubSlides(slides) {
        var subs = substitutions();
        if (!subs.length) return { slides: slides, changed: 0 };
        var changed = 0;
        var cleaned = slides.map(function (slide) {
            var copy = Object.assign({}, slide);
            ['speaker', 'dialogue'].forEach(function (field) {
                var value = copy[field];
                if (!value) return;
                var next = value;
                subs.forEach(function (pair) {
                    if (next.indexOf(pair[0]) !== -1) next = next.split(pair[0]).join(pair[1]);
                });
                if (next !== value) {
                    copy[field] = next;
                    changed += 1;
                }
            });
            return copy;
        });
        return { slides: cleaned, changed: changed };
    }

    /** 用目前的 alias 清單把已收錄的段落重清一遍，並重算內容指紋。
     *
     * 認到新名字（例如改名、或事後手動補填）時呼叫。指紋是算在清理後的
     * 文本上，所以改名前後看到的同一段會在這裡自然合併成一筆。
     */
    function rescrubStored() {
        if (!substitutions().length) return 0;
        var next = {};
        var changed = 0;
        Object.keys(plots).forEach(function (key) {
            var plot = plots[key];
            var result = scrubSlides(plot.slides || []);
            changed += result.changed;
            plot.slides = result.slides;
            plot.anonymized = true;
            plot.anonymization = anonymizationStamp();
            next[contentKey(plot)] = plot;
        });
        plots = next;
        return changed;
    }

    // ---- 側錄 -------------------------------------------------------------

    function rememberIdentity(obj) {
        if (!obj || typeof obj !== 'object') return;
        var profile = obj.profile && typeof obj.profile === 'object' ? obj.profile : obj;
        var learned = false;
        if (profile.nickname && identity.nickname !== profile.nickname) {
            identity.nickname = profile.nickname;
            learned = rememberAlias('nickname', profile.nickname) || learned;
        }
        if (profile.organization && identity.organization !== profile.organization) {
            identity.organization = profile.organization;
            learned = rememberAlias('organization', profile.organization) || learned;
        }
        if (!learned) return;
        console.log('[UW] 記住身分（累積 ' + aliases.nicknames.length + ' 個暱稱、' +
            aliases.organizations.length + ' 個組織名）');
        var cleaned = rescrubStored();
        if (cleaned) {
            flashStatus('認到新名字，已回頭清掉 ' + cleaned + ' 處');
        }
        save();
        flushPending();
        updatePanel();
    }

    /** 認出暱稱前收到的段落補做去識別化並入庫。 */
    function flushPending() {
        if (!pending.length || !aliases.nicknames.length) return;
        var queued = pending;
        pending = [];
        var stored = 0;
        queued.forEach(function (response) {
            if (storeScrubbed(response, true)) stored += 1;
        });
        save();
        updatePanel();
        flashStatus('補收暫存的 ' + stored + ' 段 ✓');
        console.log('[UW] 暫存的 ' + queued.length + ' 段已清理入庫（新增 ' + stored + ' 段）');
    }

    function capture(response) {
        var id = response.site_plot_id;
        if (id === undefined || id === null) return;
        if (!aliases.nicknames.length) {
            // 落地前一定要清乾淨，所以先押在記憶體裡，別浪費掉這次派遣的能量。
            pending.push(response);
            updatePanel();
            flashStatus('還沒認出暱稱，這段先暫存（' + pending.length + ' 段待清理）');
            console.warn('[UW] 尚未取得 profile.nickname，暫存 site_plot_id=' + id +
                '。重整頁面讓 profile 重送，或在面板填入暱稱，就會自動清理入庫。' +
                '注意：暫存只在記憶體，關掉分頁就沒了。');
            return;
        }
        storeScrubbed(response, false);
    }

    /** 去識別化後才寫進 plots；回傳是否真的新增了一筆。 */
    function storeScrubbed(response, quiet) {
        var result = scrubSlides(response.slides || []);
        var record = {
            fetched_at: new Date().toISOString(),
            site_id: response.site_id,
            site_name: response.site_name,
            site_plot_id: response.site_plot_id,
            level: response.level,
            city_id: response.city_id,
            city_name: response.city_name || response.city_title || cityNames[String(response.city_id)] || null,
            anonymized: true,
            anonymization: anonymizationStamp(),
            scrubbed: result.changed,
            preloads: response.preloads || [],
            slides: result.slides
        };
        // 指紋算在清理後的文本上，改名前後的同一段才會被視為同一筆。
        var key = contentKey(record);
        if (plots[key]) {
            if (!quiet) flashStatus('site_plot_id=' + record.site_plot_id + ' 的相同結果已收過，略過');
            return false;
        }
        plots[key] = record;
        if (!quiet) {
            save();
            updatePanel();
            flashStatus('收到「' + (record.site_name || '?') + '」' + result.slides.length + ' 張 ✓');
            console.log('[UW] 收錄 site_plot_id=' + record.site_plot_id +
                ' 的新結果（清掉 ' + result.changed + ' 處身分）', record);
        }
        return true;
    }

    function inspect(raw) {
        if (typeof raw !== 'string') return;
        // Phoenix v2 frame: [join_ref, ref, topic, event, payload]
        if (raw.indexOf('site_plot_id') === -1 &&
            raw.indexOf('nickname') === -1 &&
            raw.indexOf('organization') === -1) return;
        var frame;
        try {
            frame = JSON.parse(raw);
        } catch (error) {
            return;
        }
        if (!Array.isArray(frame) || frame.length < 5) return;
        var body = frame[4];
        if (!body || typeof body !== 'object') return;
        var response = body.response || body;
        if (!response || typeof response !== 'object') return;

        var citiesChanged = rememberCities(body) || rememberCities(response);
        if (response.city_id !== undefined) {
            citiesChanged = rememberCity(
                response.city_id,
                response.city_name || response.city_title || (response.city && response.city.name),
            ) || citiesChanged;
        }
        if (citiesChanged) save();
        rememberIdentity(response);
        if (Array.isArray(response.slides) && response.slides.length &&
            response.site_plot_id !== undefined) {
            capture(response);
        }
    }

    // 掛在 WebSocket 上，不動遊戲本身的程式碼。
    var NativeWebSocket = window.WebSocket;
    function PatchedWebSocket(url, protocols) {
        var socket = protocols === undefined
            ? new NativeWebSocket(url)
            : new NativeWebSocket(url, protocols);
        socket.addEventListener('message', function (event) {
            try {
                inspect(event.data);
            } catch (error) {
                console.warn('[UW] 解析訊息時出錯', error);
            }
        });
        return socket;
    }
    PatchedWebSocket.prototype = NativeWebSocket.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) {
        PatchedWebSocket[k] = NativeWebSocket[k];
    });
    window.WebSocket = PatchedWebSocket;

    // ---- 匯出 -------------------------------------------------------------

    // 匯出只是把已經清乾淨的紀錄倒出來——替換是在收到當下就做完的。
    function buildExport() {
        var stamp = anonymizationStamp();
        var records = Object.keys(plots).map(function (key) {
            var plot = plots[key];
            var slides = plot.slides || [];
            return {
                fetched_at: plot.fetched_at,
                site_id: plot.site_id,
                site_name: plot.site_name,
                site_plot_id: plot.site_plot_id,
                level: plot.level,
                city_id: plot.city_id,
                city_name: plot.city_name || cityNames[String(plot.city_id)] || null,
                anonymized: true,
                anonymization: plot.anonymization || stamp,
                counts: {
                    total: slides.length,
                    with_dialogue: slides.filter(function (s) { return s.dialogue; }).length
                },
                preloads: plot.preloads,
                slides: slides
            };
        });
        return {
            source: 'rf_uw_capture.js',
            exported_at: new Date().toISOString(),
            anonymized: true,
            anonymization: stamp,
            // 只帶長度不帶名字：匯出檔不該出現任何身分字串。
            short_alias_lengths: shortAliasLengths(),
            aliases_applied: {
                nicknames: aliases.nicknames.length,
                organizations: aliases.organizations.length
            },
            plots: records
        };
    }

    function download() {
        if (!count()) {
            flashStatus('目前沒有收到任何 UW 劇情');
            return;
        }
        if (!aliases.nicknames.length) {
            flashStatus('還沒辨識出你的暱稱，先在下方填好再匯出');
            return;
        }
        if (pending.length) {
            flashStatus(pending.length + ' 段還沒清理，不會包含在這次匯出');
        }
        var shorts = shortAliasLengths();
        if (shorts.length) {
            console.warn('[UW] 有 ' + shorts.length +
                ' 個名字短到只有 1-2 個字，可能誤傷正常文本，匯入前請先跑 --check');
        }
        var blob = new Blob([JSON.stringify(buildExport(), null, 2)],
            { type: 'application/json;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'rf_uw_plots_' + Date.now() + '.json';
        anchor.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 500);
        flashStatus('已下載 ' + count() + ' 段');
    }

    function clearAll() {
        if (!count()) {
            flashStatus('本來就是空的');
            return;
        }
        if (!window.confirm('確定要清空已收錄的 ' + count() + ' 段 UW 劇情？請先確認已經下載。')) {
            return;
        }
        plots = {};
        pending = [];
        save();
        updatePanel();
        flashStatus('已清空');
    }

    // ---- 面板 -------------------------------------------------------------

    function flashStatus(message) {
        if (!statusEl) return;
        statusEl.textContent = message;
        setTimeout(function () {
            if (statusEl.textContent === message) statusEl.textContent = '';
        }, 3000);
    }

    function updatePanel() {
        if (countEl) countEl.textContent = count();
        if (pendingEl) {
            pendingEl.textContent = pending.length
                ? '⚠ ' + pending.length + ' 段待清理（僅在記憶體，關掉分頁就沒了）'
                : '';
        }
        if (idEl) {
            idEl.querySelector('[data-field="nickname"]').value = identity.nickname || '';
            idEl.querySelector('[data-field="organization"]').value = identity.organization || '';
        }
    }

    function button(label, onClick) {
        var el = document.createElement('button');
        el.textContent = label;
        el.style.cssText = 'flex:1;min-width:56px;padding:5px 6px;font-size:12px;cursor:pointer;' +
            'border:1px solid #4a5560;background:#222c34;color:#e6ebe8;border-radius:3px';
        el.onclick = onClick;
        return el;
    }

    function field(label, key) {
        var wrap = document.createElement('label');
        wrap.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:#9fb0ad';
        wrap.textContent = label;
        var input = document.createElement('input');
        input.dataset.field = key;
        input.placeholder = '未偵測到';
        input.style.cssText = 'flex:1;min-width:0;padding:3px 5px;font-size:11px;' +
            'border:1px solid #3b4650;background:#161d23;color:#e6ebe8;border-radius:2px';
        // 用 change 不用 input：逐字輸入會把「柴」「柴貓」「柴貓的」每個前綴
        // 都記成 alias，接著整份文本被單字替換掉，救不回來。
        input.onchange = function () {
            identity[key] = input.value.trim() || null;
            // 手動補填也要進 alias 清單，並回頭把已收錄的段落重清一次。
            if (rememberAlias(key, identity[key])) {
                var cleaned = rescrubStored();
                if (cleaned) flashStatus('已回頭清掉 ' + cleaned + ' 處');
                flushPending();
            }
            save();
            updatePanel();
        };
        wrap.appendChild(input);
        return wrap;
    }

    function buildPanel() {
        panelEl = document.createElement('div');
        panelEl.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;' +
            'width:250px;padding:10px;border-radius:6px;background:rgba(16,21,26,.94);' +
            'color:#e6ebe8;font:12px/1.5 system-ui,-apple-system,"Noto Sans TC",sans-serif;' +
            'box-shadow:0 8px 28px rgba(0,0,0,.45);border:1px solid #2f3b43';

        var head = document.createElement('div');
        head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;' +
            'margin-bottom:8px;cursor:move;font-weight:700';
        head.textContent = 'UW 劇情側錄';
        var badge = document.createElement('span');
        badge.style.cssText = 'color:#d9a568';
        countEl = document.createElement('b');
        countEl.textContent = '0';
        badge.appendChild(countEl);
        badge.appendChild(document.createTextNode(' 段'));
        head.appendChild(badge);
        panelEl.appendChild(head);

        idEl = document.createElement('div');
        idEl.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:8px';
        idEl.appendChild(field('暱稱', 'nickname'));
        idEl.appendChild(field('組織', 'organization'));
        panelEl.appendChild(idEl);

        pendingEl = document.createElement('div');
        pendingEl.style.cssText = 'min-height:0;margin-bottom:6px;font-size:11px;color:#d98b68';
        panelEl.appendChild(pendingEl);

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:5px;margin-bottom:6px';
        row.appendChild(button('下載 JSON', download));
        row.appendChild(button('清空', clearAll));
        panelEl.appendChild(row);

        statusEl = document.createElement('div');
        statusEl.style.cssText = 'min-height:16px;font-size:11px;color:#8fbf9f';
        panelEl.appendChild(statusEl);

        // 拖曳
        var dragging = false, offsetX = 0, offsetY = 0;
        head.addEventListener('mousedown', function (e) {
            dragging = true;
            offsetX = e.clientX - panelEl.getBoundingClientRect().left;
            offsetY = e.clientY - panelEl.getBoundingClientRect().top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            panelEl.style.left = (e.clientX - offsetX) + 'px';
            panelEl.style.top = (e.clientY - offsetY) + 'px';
            panelEl.style.right = 'auto';
            panelEl.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', function () { dragging = false; });

        document.body.appendChild(panelEl);
    }

    load();
    if (document.body) {
        buildPanel();
    } else {
        document.addEventListener('DOMContentLoaded', buildPanel);
    }
    updatePanel();

    window.__RF_UW_CAPTURE__ = {
        plots: function () { return plots; },
        pending: function () { return pending.length; },
        identity: identity,
        aliases: aliases,
        // 萬一記錯了名字（例如手動填錯），清掉 alias 清單重來。
        // 已經替換掉的文本救不回來，只能連同 plots 一起清空重收。
        resetAliases: function () {
            aliases = { nicknames: [], organizations: [] };
            save();
            updatePanel();
            console.log('[UW] alias 清單已清空');
        },
        download: download,
        clear: clearAll
    };

    console.log('[UW] 側錄已啟動，已收錄 ' + count() + ' 段。照常玩就好，派遣 UW 會自動收。');
})();
