// rf_story_capture.js
// 專門側錄第一個參數以 [Story] 開頭的 Console log。
// 面板操作風格比照 uw_hook.js：計數、複製、下載、清空、收合、拖曳。
(function () {
    'use strict';

    if (window.__RF_STORY_CAPTURE_STARTED__) return;
    window.__RF_STORY_CAPTURE_STARTED__ = true;

    var captured = [];
    var methods = ['log', 'info', 'warn', 'error', 'debug'];
    var originals = {};
    var MAX_CAPTURE = 5000;
    var panelEl, countEl, statusEl;

    function stringify(value) {
        if (typeof value === 'string') return value;
        if (value instanceof Error) return value.stack || value.message;
        try {
            var seen = [];
            return JSON.stringify(value, function (key, nested) {
                if (nested && typeof nested === 'object') {
                    if (seen.indexOf(nested) !== -1) return '[Circular]';
                    seen.push(nested);
                }
                if (typeof nested === 'bigint') return String(nested) + 'n';
                if (typeof nested === 'function') return '[Function]';
                return nested;
            });
        } catch (error) {
            try { return String(value); } catch (ignored) { return '[無法轉換的資料]'; }
        }
    }

    function formatArguments(args) {
        return Array.prototype.map.call(args || [], stringify).join(' ');
    }

    function addCapture(level, args) {
        // 嚴格要求第一個參數本身以 [Story] 開頭。
        var first = args && args.length ? stringify(args[0]) : '';
        if (!/^\[Story\]/.test(first)) return false;

        captured.push({
            level: level,
            time: new Date().toLocaleTimeString(),
            message: formatArguments(args)
        });
        if (captured.length > MAX_CAPTURE) captured.splice(0, captured.length - MAX_CAPTURE);
        updatePanel();
        return true;
    }

    function formatAll() {
        return captured.map(function (item) {
            return '[Story] [時間:' + item.time + '] [' + item.level.toUpperCase() + '] ' + item.message;
        }).join('\n\n');
    }

    function updatePanel() {
        if (countEl) countEl.textContent = captured.length;
    }

    function flashStatus(message) {
        if (!statusEl) return;
        statusEl.textContent = message;
        setTimeout(function () {
            if (statusEl.textContent === message) statusEl.textContent = '';
        }, 2500);
    }

    function legacyCopy(text) {
        try {
            var textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            var ok = document.execCommand('copy');
            textarea.remove();
            return ok;
        } catch (error) {
            return false;
        }
    }

    function copyAll() {
        if (!captured.length) {
            flashStatus('目前沒有 [Story] Log');
            return;
        }
        var text = formatAll();
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                flashStatus('已複製 ' + captured.length + ' 筆 [Story] Log ✓');
            }).catch(function () {
                flashStatus(legacyCopy(text) ? '已複製 ' + captured.length + ' 筆（備援方式）✓' : '複製失敗，請改用下載');
            });
        } else {
            flashStatus(legacyCopy(text) ? '已複製 ' + captured.length + ' 筆 [Story] Log ✓' : '複製失敗，請改用下載');
        }
    }

    function downloadAll() {
        if (!captured.length) {
            flashStatus('目前沒有 [Story] Log');
            return;
        }
        var blob = new Blob([formatAll()], { type: 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'rf_story_' + Date.now() + '.txt';
        anchor.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 500);
        flashStatus('已下載 ' + captured.length + ' 筆');
    }

    function clearAll() {
        captured.length = 0;
        updatePanel();
        flashStatus('已清空 [Story] Log');
    }

    function buildPanel() {
        if (document.getElementById('rf-story-panel')) return;

        var style = document.createElement('style');
        style.textContent = `
            #rf-story-panel{
                position:fixed; right:14px; bottom:14px; z-index:2147483647;
                width:230px; font-family:ui-monospace,Menlo,Consolas,monospace;
                background:#14160f; color:#e8e4d5; border:1px solid #3a3f2c;
                border-radius:4px; box-shadow:0 4px 18px rgba(0,0,0,.5);
                font-size:12px; overflow:hidden;
            }
            #rf-story-panel .rf-head{
                background:#1c2018; padding:8px 10px; display:flex;
                align-items:center; justify-content:space-between; cursor:move;
                border-bottom:1px solid #3a3f2c;
            }
            #rf-story-panel .rf-head b{color:#d9a441; font-weight:600; font-size:11.5px;}
            #rf-story-panel .rf-body{padding:10px;}
            #rf-story-panel .rf-row{display:flex; gap:6px; margin-top:6px;}
            #rf-story-panel button{
                flex:1; background:#1f2318; color:#e8e4d5; border:1px solid #6a5322;
                border-radius:2px; padding:6px 4px; font-size:11px; cursor:pointer;
                font-family:inherit;
            }
            #rf-story-panel button:hover{background:#d9a441; color:#161810;}
            #rf-story-panel .rf-count{color:#8b9284; font-size:11px;}
            #rf-story-panel .rf-count b{color:#d9a441;}
            #rf-story-panel .rf-status{color:#6f9b5c; font-size:10.5px; margin-top:6px; min-height:14px;}
            #rf-story-panel .rf-min{cursor:pointer; color:#8b9284; font-size:13px; user-select:none;}
        `;
        document.head.appendChild(style);

        panelEl = document.createElement('div');
        panelEl.id = 'rf-story-panel';
        panelEl.innerHTML = `
            <div class="rf-head" id="rf-story-drag">
                <b>[Story] 側錄面板</b>
                <span class="rf-min" id="rf-story-min">—</span>
            </div>
            <div class="rf-body" id="rf-story-body">
                <div class="rf-count">已攔截 <b id="rf-story-count">0</b> 筆 [Story] Log</div>
                <div class="rf-row">
                    <button id="rf-story-copy">複製全部</button>
                    <button id="rf-story-download">下載 .txt</button>
                </div>
                <div class="rf-row">
                    <button id="rf-story-clear">清空</button>
                </div>
                <div class="rf-status" id="rf-story-status"></div>
            </div>
        `;
        document.body.appendChild(panelEl);

        countEl = document.getElementById('rf-story-count');
        statusEl = document.getElementById('rf-story-status');
        document.getElementById('rf-story-copy').addEventListener('click', copyAll);
        document.getElementById('rf-story-download').addEventListener('click', downloadAll);
        document.getElementById('rf-story-clear').addEventListener('click', clearAll);

        var body = document.getElementById('rf-story-body');
        var minButton = document.getElementById('rf-story-min');
        var collapsed = false;
        minButton.addEventListener('click', function () {
            collapsed = !collapsed;
            body.style.display = collapsed ? 'none' : 'block';
            minButton.textContent = collapsed ? '+' : '—';
        });

        var dragHandle = document.getElementById('rf-story-drag');
        var dragging = false, offX = 0, offY = 0;
        dragHandle.addEventListener('mousedown', function (event) {
            if (event.target.classList.contains('rf-min')) return;
            dragging = true;
            var rect = panelEl.getBoundingClientRect();
            offX = event.clientX - rect.left;
            offY = event.clientY - rect.top;
        });
        document.addEventListener('mousemove', function (event) {
            if (!dragging) return;
            panelEl.style.left = (event.clientX - offX) + 'px';
            panelEl.style.top = (event.clientY - offY) + 'px';
            panelEl.style.right = 'auto';
            panelEl.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', function () { dragging = false; });
    }

    methods.forEach(function (level) {
        originals[level] = console[level] ? console[level].bind(console) : function () {};
        console[level] = function () {
            addCapture(level, arguments);
            return originals[level].apply(console, arguments);
        };
    });

    window.RFStoryCapture = {
        started: true,
        getCaptured: function () { return captured.slice(); },
        clear: clearAll,
        copy: copyAll,
        download: downloadAll,
        stop: function () {
            methods.forEach(function (level) { console[level] = originals[level]; });
            window.__RF_STORY_CAPTURE_STARTED__ = false;
            window.RFStoryCapture.started = false;
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildPanel);
    } else {
        buildPanel();
    }

    originals.log('[RF Story Capture] started; filter: [Story]');
})();
