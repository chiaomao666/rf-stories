// 劇情索引：載入 index.json、篩選、渲染卡片。

import { VARIANT_LABEL } from './config.js';
import { loadJson } from './assets.js';

export const state = {
  variant: 'red_army',
  index: null,
  stories: [],
  chapter: 'all',
  keyword: '',
};

const cache = new Map();

/**
 * 排序鍵：遊戲用 cities.position 由小到大決定城鎮順序（Attackmap 的左右鍵就是依這個），
 * 探險與特別篇因此穿插在主線篇章之間，而不是全部擠在前面。
 * 舊版 index.json 沒有 position，退回章節排序，至少維持穩定。
 */
function cityOrder(row) {
  const pos = row.position;
  if (pos === null || pos === undefined) {
    return [1, 0, String(row.chapter_name || ''), row.chapter_serial || 0];
  }
  return [0, pos, '', 0];
}

function byGameOrder(a, b) {
  const ka = cityOrder(a);
  const kb = cityOrder(b);
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

/** 這份 index.json 是否帶得動遊戲順序。 */
export function hasGameOrder() {
  return (state.stories || []).some((c) => c.position !== null && c.position !== undefined);
}

export async function loadVariant(variant) {
  state.variant = variant;
  if (!cache.has(variant)) {
    cache.set(variant, loadJson(`${variant}/index.json`));
  }
  state.index = await cache.get(variant);
  state.stories = [...(state.index.cities || [])].sort(byGameOrder);
  return state.index;
}

/** 取單城完整 slides。 */
export function loadCity(variant, file) {
  return loadJson(`${variant}/${file}`);
}

export function loadNationStory(variant) {
  return loadJson(`${variant}/nation_story.json`);
}

export function chapters() {
  const names = state.stories.map((s) => s.chapter_name).filter(Boolean);
  return [...new Set(names)];
}

export function filtered() {
  const kw = state.keyword.trim().toLowerCase();
  return state.stories.filter((s) => {
    if (state.chapter !== 'all' && s.chapter_name !== state.chapter) return false;
    if (!kw) return true;
    return [s.city_name, s.chapter_name, String(s.city_id)]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(kw));
  });
}

export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

export function variantLabel(variant) {
  return VARIANT_LABEL[variant] || variant;
}

export function renderCards(container) {
  const rows = filtered();
  if (!rows.length) {
    container.innerHTML = '<div class="empty">找不到符合條件的劇情。</div>';
    return;
  }
  container.innerHTML = rows
    .map((s) => {
      const chapter = [s.chapter_name, s.chapter_number, s.chapter_serial]
        .filter((v) => v !== null && v !== undefined && v !== '')
        .join(' ');
      return `
        <article class="story-card">
          <div>
            <div class="eyebrow">CITY ${escapeHtml(s.city_id)}</div>
            <h3>${escapeHtml(s.city_name || '未命名城市')}</h3>
            <p>${escapeHtml(chapter || '（無章節資訊）')}</p>
          </div>
          <div class="card-foot">
            <span class="count">
              ${s.total} 張 · 戰前 ${s.before_attack} / 戰後 ${s.after_attack}
            </span>
            <button class="play-link" data-file="${escapeHtml(s.file)}"
                    data-city="${escapeHtml(s.city_name || '')}"
                    data-id="${escapeHtml(s.city_id)}">播放 →</button>
          </div>
        </article>`;
    })
    .join('');
}
