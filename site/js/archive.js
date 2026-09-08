// 劇情索引：載入 index.json、篩選、渲染卡片。

import { VARIANT_LABEL } from './config.js';
import { loadJson } from './assets.js';

export const state = {
  variant: 'red_army',
  index: null,
  stories: [],
  uwIndex: null,
  uwKeyword: '',
  uwLevel: 'all',
  uwCity: 'all',
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

/**
 * 陣營劇情是**陣營的屬性**，九個陣營各一套，與主線的紅軍／非紅軍版本無關，
 * 所以獨立放在 data/nation_story/ 底下以陣營 id 為主鍵。
 */
export function loadNationIndex() {
  return loadJson('nation_story/index.json');
}

export function loadNationStory(nationId) {
  return loadJson(`nation_story/nation_${nationId}.json`);
}

export async function loadUwIndex() {
  if (!cache.has('uw_index')) cache.set('uw_index', loadJson('uw_plots/index.json'));
  state.uwIndex = await cache.get('uw_index');
  return state.uwIndex;
}

export function loadUwPlot(file) {
  return loadJson(`uw_plots/${file}`);
}

export function uwLevels() {
  return ['1', '2', '3', '4', '5'];
}

export function uwCities() {
  return [...new Set((state.uwIndex?.plots || []).map((p) => String(p.city_id)).filter(Boolean))].sort(
    (a, b) => Number(a) - Number(b),
  );
}

export function groupedUwPlots() {
  const groups = new Map();
  for (const plot of state.uwIndex?.plots || []) {
    const key = `${plot.site_id}:${plot.site_name || ''}:${plot.city_id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        site_id: plot.site_id,
        site_name: plot.site_name,
        city_id: plot.city_id,
        plots: [],
      });
    }
    groups.get(key).plots.push(plot);
  }
  return [...groups.values()].sort((a, b) => Number(a.site_id) - Number(b.site_id));
}

export function filteredUw() {
  const keyword = state.uwKeyword.trim().toLowerCase();
  return groupedUwPlots().filter((group) => {
    if (state.uwLevel !== 'all' && !group.plots.some((plot) => String(plot.level) === state.uwLevel)) return false;
    if (state.uwCity !== 'all' && String(group.city_id) !== state.uwCity) return false;
    if (!keyword) return true;
    const values = [group.site_name, group.site_id, group.city_id];
    for (const plot of group.plots) values.push(plot.site_plot_id, plot.level, plot.file);
    return values
      .filter((value) => value !== null && value !== undefined)
      .some((value) => String(value).toLowerCase().includes(keyword));
  });
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
    return [s.city_name, s.title, s.chapter_name, String(s.city_id)]
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

export function uwCityName(cityId) {
  const city = state.index?.cities?.find((item) => String(item.city_id) === String(cityId));
  if (city?.city_name) return city.city_name;
  if (String(cityId) === '37') return '維多利亞城';
  return `CITY ${cityId}`;
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
      // title 是這一章的標題（例如「集會遊行法」），跟城市名是兩回事。
      const title = s.title ? `<p class="story-title">${escapeHtml(s.title)}</p>` : '';
      return `
        <article class="story-card">
          <div>
            <div class="eyebrow">CITY ${escapeHtml(s.city_id)}</div>
            <h3>${escapeHtml(s.city_name || '未命名城市')}</h3>
            ${title}
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

export function renderUwCards(container) {
  const rows = filteredUw();
  if (!rows.length) {
    container.innerHTML = '<div class="empty">找不到符合條件的 UW 地點。</div>';
    return;
  }
  container.innerHTML = rows
    .map((group) => {
      const byLevel = new Map(group.plots.map((plot) => [String(plot.level), plot]));
      const plotIds = group.plots.map((plot) => plot.site_plot_id).sort((a, b) => Number(a) - Number(b));
      const total = group.plots.reduce((sum, plot) => sum + Number(plot.total || 0), 0);
      const dialogue = group.plots.reduce((sum, plot) => sum + Number(plot.with_dialogue || 0), 0);
      const levels = [1, 2, 3, 4, 5]
        .map((level) => {
          const plot = byLevel.get(String(level));
          const attrs = plot
            ? `data-file="${escapeHtml(plot.file)}" data-level="${level}"`
            : 'disabled aria-disabled="true"';
          return `<button class="level-btn uw-play-link${plot ? '' : ' is-unavailable'}" ${attrs}>Level ${level}</button>`;
        })
        .join('');
      return `
        <article class="story-card uw-card">
          <div>
            <div class="eyebrow">UW · 劇情名稱</div>
            <h3>${escapeHtml(group.site_name || '未命名劇情')}</h3>
            <p>劇情段落 ${plotIds.map(escapeHtml).join(' / ')} · 地點：${escapeHtml(uwCityName(group.city_id))}（CITY ${escapeHtml(group.city_id)}）</p>
          </div>
          <div class="uw-levels" aria-label="${escapeHtml(group.site_name || '')} 劇情等級">${levels}</div>
          <div class="card-foot">
            <span class="count">${total} 張 · 對白 ${dialogue} · ${group.plots.length} 個等級</span>
            <span class="uw-level-hint">選擇等級後播放</span>
          </div>
        </article>`;
    })
    .join('');
}
