// 素材與資料的路徑解析。
//
// slide 內的路徑一律是絕對相對路徑（/images/... 與 /audio/...），對應遊戲的
// validImageSrc：本地素材優先，載不到才回退 CDN。詳見 docs/story_slides_engine.md
// 的「素材網址解析」一節。

import { LOCAL_ASSET_BASE, REMOTE_ASSET_BASE } from './config.js';

/** 本地素材網址：/images/slide/x.png → assets/images/slide/x.png */
export function localAssetUrl(path) {
  if (!path) return '';
  const clean = String(path).replace(/^\/+/, '');
  return new URL(LOCAL_ASSET_BASE + clean, document.baseURI).href;
}

/** CDN 網址。 */
export function remoteAssetUrl(path) {
  if (!path) return '';
  return REMOTE_ASSET_BASE + (path.startsWith('/') ? path : '/' + path);
}

const probeCache = new Map();

/**
 * 回傳實際可用的素材網址：先試本地，失敗才用 CDN。
 * 每個路徑只探測一次，結果快取起來。
 */
export function resolveAssetUrl(path, { kind = 'image' } = {}) {
  if (!path) return Promise.resolve('');
  if (probeCache.has(path)) return probeCache.get(path);

  const local = localAssetUrl(path);
  const remote = remoteAssetUrl(path);
  const probe = new Promise((resolve) => {
    if (kind === 'image') {
      const img = new Image();
      img.onload = () => resolve(local);
      img.onerror = () => resolve(remote);
      img.src = local;
      return;
    }
    // 音訊不預載整個檔案，用 HEAD 判斷本地有沒有這個檔就好。
    fetch(local, { method: 'HEAD' })
      .then((res) => resolve(res.ok ? local : remote))
      .catch(() => resolve(remote));
  });
  probeCache.set(path, probe);
  return probe;
}

/**
 * 找出劇情 JSON 的根目錄。
 *
 * 版控裡只有一份 data/：部署時由 GitHub Actions 複製進站台根目錄，
 * 本機從 repo 根目錄起 server 時則位在上一層。兩種都要能跑，所以在這裡探測。
 */
let dataBasePromise = null;
export function resolveDataBase() {
  if (dataBasePromise) return dataBasePromise;
  const candidates = ['data/', '../data/'];
  dataBasePromise = (async () => {
    for (const base of candidates) {
      try {
        const res = await fetch(base + 'red_army/index.json', { method: 'HEAD' });
        if (res.ok) return base;
      } catch {
        // 換下一個候選路徑
      }
    }
    throw new Error('找不到劇情資料目錄（試過 data/ 與 ../data/）');
  })();
  return dataBasePromise;
}

export async function loadJson(relativePath) {
  const base = await resolveDataBase();
  const res = await fetch(base + relativePath, { cache: 'no-store' });
  if (!res.ok) throw new Error(`載入 ${relativePath} 失敗：HTTP ${res.status}`);
  return res.json();
}
