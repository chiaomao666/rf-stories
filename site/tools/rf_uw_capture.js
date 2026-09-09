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
// ⚠️ 劇情文本會帶你的暱稱與組織名。這支腳本在**匯出時**才做去識別化，
// 身分辨識不出來時會擋下匯出——帶身分的文本等同散佈帳號身分。
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
    var identity = { nickname: null, organization: null };
    var panelEl, countEl, statusEl, idEl;

    // ---- 儲存 -------------------------------------------------------------

    function load() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            var saved = JSON.parse(raw);
            plots = saved.plots || {};
            identity = saved.identity || identity;
        } catch (error) {
            console.warn('[UW] 讀取既有紀錄失敗，從空的開始', error);
        }
    }

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ plots: plots, identity: identity }));
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

    // ---- 去識別化 ---------------------------------------------------------

    // 先換長的：組織名若包含暱稱，先換短的會把長的切碎。
    function substitutions() {
        var subs = [];
        if (identity.nickname) subs.push([identity.nickname, PLACEHOLDER]);
        if (identity.organization) subs.push([identity.organization, ORG_PLACEHOLDER]);
        return subs.sort(function (a, b) { return b[0].length - a[0].length; });
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

    // ---- 側錄 -------------------------------------------------------------

    function rememberIdentity(obj) {
        if (!obj || typeof obj !== 'object') return;
        var profile = obj.profile && typeof obj.profile === 'object' ? obj.profile : obj;
        var changed = false;
        if (profile.nickname && identity.nickname !== profile.nickname) {
            identity.nickname = profile.nickname;
            changed = true;
        }
        if (profile.organization && identity.organization !== profile.organization) {
            identity.organization = profile.organization;
            changed = true;
        }
        if (changed) {
            save();
            updatePanel();
            console.log('[UW] 記住身分：', identity);
        }
    }

    function capture(response) {
        var id = response.site_plot_id;
        if (id === undefined || id === null) return;
        var key = contentKey(response);
        if (plots[key]) {
            flashStatus('site_plot_id=' + id + ' 的相同結果已收過，略過');
            return;
        }
        plots[key] = {
            fetched_at: new Date().toISOString(),
            site_id: response.site_id,
            site_name: response.site_name,
            site_plot_id: id,
            level: response.level,
            city_id: response.city_id,
            preloads: response.preloads || [],
            slides: response.slides
        };
        save();
        updatePanel();
        flashStatus('收到「' + (response.site_name || '?') + '」' + response.slides.length + ' 張 ✓');
        console.log('[UW] 收錄 site_plot_id=' + id + ' 的新結果', plots[key]);
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

    function buildExport() {
        var subs = substitutions();
        var records = Object.keys(plots).map(function (key) {
            var plot = plots[key];
            var result = scrubSlides(plot.slides);
            return {
                fetched_at: plot.fetched_at,
                site_id: plot.site_id,
                site_name: plot.site_name,
                site_plot_id: plot.site_plot_id,
                level: plot.level,
                city_id: plot.city_id,
                anonymized: subs.length > 0,
                counts: {
                    total: result.slides.length,
                    with_dialogue: result.slides.filter(function (s) { return s.dialogue; }).length
                },
                preloads: plot.preloads,
                slides: result.slides
            };
        });
        return {
            source: 'rf_uw_capture.js',
            exported_at: new Date().toISOString(),
            anonymized: subs.length > 0,
            plots: records
        };
    }

    function download() {
        if (!count()) {
            flashStatus('目前沒有收到任何 UW 劇情');
            return;
        }
        if (!identity.nickname && !identity.organization) {
            flashStatus('還沒辨識出你的暱稱／組織，先在下方填好再匯出');
            return;
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
        input.oninput = function () {
            identity[key] = input.value.trim() || null;
            save();
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
        identity: identity,
        download: download,
        clear: clearAll
    };

    console.log('[UW] 側錄已啟動，已收錄 ' + count() + ' 段。照常玩就好，派遣 UW 會自動收。');
})();
