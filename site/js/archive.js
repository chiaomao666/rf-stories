// 劇情索引：載入 index.json、篩選、渲染卡片。

import { VARIANT_LABEL } from './config.js';
import { loadJson } from './assets.js';

export const state = {
  variant: 'red_army',
  index: null,
  stories: [],
  nationIndex: null,
  uwIndex: null,
  uwKeyword: '',
  uwLevel: 'all',
  uwCity: 'all',
  chapter: 'all',
  keyword: '',
};

const cache = new Map();

// UW 的 site_name 是劇情名稱；城市名稱依 citymap.js 的 city ID 字典。
const UW_CITY_NAMES = {
  1: "臺北",
  2: "新北",
  3: "基隆",
  4: "馬祖",
  5: "苗栗",
  6: "臺中",
  7: "南投",
  8: "彰化",
  9: "百靈廟",
  10: "雲林",
  11: "嘉義",
  12: "臺南",
  13: "高雄",
  14: "巴彥淖爾",
  15: "宜蘭",
  16: "花蓮",
  17: "臺東",
  18: "札幌",
  19: "屏東",
  20: "馬尼拉",
  21: "佬沃",
  22: "河內",
  23: "胡志明市",
  24: "雅加達",
  25: "新加坡",
  26: "吉隆坡",
  27: "曼谷",
  28: "美斯樂",
  29: "孟賽",
  30: "邦康",
  31: "老街",
  32: "密支那",
  33: "達杭丹",
  34: "鄂爾多斯",
  35: "賀猛",
  36: "仰光",
  37: "維多利亞城",
  38: "柴灣",
  39: "赤柱",
  40: "九龍城",
  41: "油尖旺",
  42: "深水埗",
  43: "黃大仙",
  44: "觀塘",
  45: "西貢",
  46: "沙田",
  47: "上粉沙打",
  48: "大埔",
  49: "元朗",
  50: "屯門",
  51: "荃灣",
  52: "葵青",
  53: "湛茂",
  54: "赤鱲角",
  55: "澳門",
  56: "深圳",
  57: "廣州",
  58: "梅州",
  59: "潮州",
  60: "桂林",
  61: "南寧",
  62: "海口",
  63: "仙臺",
  64: "東京",
  65: "大阪",
  66: "福岡",
  67: "沖繩",
  68: "清津",
  69: "平壤",
  70: "首爾",
  71: "釜山",
  72: "南薩哈林斯克",
  73: "共青城",
  74: "伯力",
  75: "海參崴",
  76: "海蘭泡",
  77: "黑河",
  78: "佳木斯",
  79: "牡丹江",
  80: "延邊",
  81: "齊齊哈爾",
  82: "大慶",
  83: "哈爾濱",
  84: "吉林",
  85: "興安",
  86: "白城",
  87: "長春",
  88: "通遼",
  89: "瀋陽",
  90: "鞍山",
  91: "大連",
  92: "丹東",
  93: "阜新",
  94: "朝陽",
  95: "赤峰",
  96: "承德",
  97: "赤塔",
  98: "烏蘭烏德",
  99: "伊爾庫茨克",
  100: "亞巴坎",
  101: "新西伯利亞",
  102: "鄂木斯克",
  103: "彼得羅巴甫爾",
  104: "巴爾瑙爾",
  105: "莫斯科",
  106: "喬巴山",
  107: "賽音山達",
  108: "達蘭扎德嘎德",
  109: "巴彥洪戈爾",
  110: "烏蘭巴托",
  111: "達爾汗",
  112: "額爾登特",
  113: "木倫",
  114: "克孜勒",
  115: "阿爾泰",
  116: "科布多",
  117: "烏列蓋",
  118: "戈爾諾阿爾泰斯克",
  119: "呼倫貝爾",
  120: "錫林郭勒",
  121: "張家口",
  122: "烏蘭察布",
  123: "呼和浩特",
  124: "包頭",
  276: "三亞",
  277: "廈門",
  278: "福州",
  279: "溫州",
  280: "杭州",
  281: "上海",
  282: "合肥",
  283: "南京",
  284: "武漢",
  285: "南昌",
  286: "長沙",
  287: "南陽",
  288: "鄭州",
  289: "徐州",
  290: "濟南",
  291: "青島",
  292: "天津",
  293: "北京",
  294: "石家莊",
  295: "太原",
  296: "延安",
  297: "西安",
  298: "銀川",
  299: "蘭州",
  300: "西寧",
  301: "重慶",
  302: "成都",
  303: "貴陽",
  304: "昆明",
  305: "德宏",
  306: "西雙版納",
  307: "桃園",
  308: "新竹",
  472: "金門",
  473: "澎湖",
  474: "東沙",
  475: "額濟納",
  476: "烏海",
  477: "艾利斯塔",
  478: "阿特勞",
  479: "阿克托別",
  480: "卡拉干達",
  481: "埃基巴斯圖茲",
  482: "巴甫洛達爾",
  483: "阿斯塔納",
  484: "鐵米爾套",
  485: "科克舍套",
  486: "塞米伊",
  487: "齋桑",
  488: "阿克鬥卡",
  489: "阿亞古茲",
  490: "塔爾迪庫爾干",
  491: "巴爾喀什",
  492: "厄斯克門",
  493: "扎爾肯特",
  494: "楚城",
  495: "春賈",
  496: "比斯凱克",
  497: "塔什干",
  498: "費扎巴德",
  499: "喀布爾",
  500: "希姆肯特",
  501: "杜尚貝",
  502: "阿拉木圖",
  503: "塔拉茲",
  504: "杜拜",
  505: "拉瓦爾品第",
  506: "米蘭沙阿",
  507: "伊斯坦堡",
  508: "哈密",
  509: "伊德利卜",
  510: "吉爾吉特",
  511: "敦煌",
  512: "霍斯特",
  513: "阿勒坡",
  514: "奎屯",
  515: "伊寧",
  516: "可可托海",
  517: "阿勒泰",
  518: "博爾塔拉",
  519: "塔城",
  520: "克拉瑪依",
  521: "奇臺",
  522: "吐魯番",
  523: "烏魯木齊",
  524: "喀什",
  525: "阿克蘇",
  526: "昌吉",
  527: "英吉沙",
  528: "巴音郭楞",
  529: "克孜勒蘇",
  530: "若羌",
  531: "庫爾勒",
  532: "庫車",
  533: "烏什",
  534: "和田",
  535: "莎車",
  536: "邁恩巴德",
  537: "博卡拉",
  538: "拜拉庫比",
  539: "德拉敦",
  540: "達蘭薩拉",
  541: "德里",
  542: "昌德拉吉里",
  543: "班達拉",
  544: "列城",
  545: "穆恩德戈德",
  546: "那曲",
  547: "林芝",
  548: "緹祖",
  549: "阿里",
  550: "日喀則",
  551: "拉薩",
  552: "哲古",
  553: "拉旺格拉",
  554: "辛布",
  555: "昌都",
  556: "達旺",
  557: "加德滿都",
  558: "玉樹",
  559: "果洛",
  560: "海北",
  561: "黃南",
  562: "格爾木",
  563: "海南",
  564: "天祝",
  565: "甘南",
  566: "華盛頓",
  567: "紐約",
  568: "阿壩",
  569: "甘孜",
  570: "木里",
  571: "迪慶",
  572: "倫敦",
  573: "多倫多",
  574: "卡加利",
  575: "雅安",
  576: "雪梨",
  577: "洛杉磯",
  578: "奧克蘭",
  579: "舊金山",
  580: "溫哥華",
  581: "日內瓦",
  582: "慕尼黑",
  583: "巴黎",
  594: "世界之塔"
};

const NATION_SITE_NAMES = new Set(['暗巷']);

const UW_NATION_NAMES = {
  677: "香港",
  686: "臺灣",
  687: "藏國",
  688: "蒙古",
  689: "紅軍",
  719: "哈薩克",
  720: "維吾爾",
  721: "反賊聯盟",
  722: "滿洲",
};

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
export async function loadNationIndex() {
  if (!cache.has('nation_index')) cache.set('nation_index', loadJson('nation_story/index.json'));
  state.nationIndex = await cache.get('nation_index');
  return state.nationIndex;
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
    // 暗巷跟陣營劇情一樣是「每個陣營一版」，site_id 就是陣營，合併成同一張卡。
    const key = isNationSite(plot.site_name)
      ? `nation:${plot.site_name}`
      : `${plot.site_id}:${plot.site_name || ''}:${plot.city_id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        site_id: plot.site_id,
        site_name: plot.site_name,
        city_id: plot.city_id,
        byNation: isNationSite(plot.site_name),
        site_ids: [],
        city_ids: [],
        plots: [],
      });
    }
    const group = groups.get(key);
    group.plots.push(plot);
    if (!group.site_ids.includes(plot.site_id)) group.site_ids.push(plot.site_id);
    if (!group.city_ids.includes(plot.city_id)) group.city_ids.push(plot.city_id);
  }
  // 暗巷這類「每陣營一版」的地點排在最前面，其餘依 site_id。
  return [...groups.values()].sort(
    (a, b) => Number(b.byNation) - Number(a.byNation) || Number(a.site_id) - Number(b.site_id),
  );
}

/** 這個 UW 地點是否「每個陣營一版」。 */
function isNationSite(siteName) {
  return NATION_SITE_NAMES.has(siteName);
}

export function nationSiteName(siteId) {
  return UW_NATION_NAMES[String(siteId ?? '').trim()] || `陣營 ${siteId ?? '未知'}`;
}

export function filteredUw() {
  const keyword = state.uwKeyword.trim().toLowerCase();
  return groupedUwPlots().filter((group) => {
    if (state.uwLevel !== 'all' && !group.plots.some((plot) => String(plot.level) === state.uwLevel)) return false;
    if (state.uwCity !== 'all' && !group.city_ids.some((id) => String(id) === state.uwCity)) return false;
    if (!keyword) return true;
    const numericValues = [
      ...group.site_ids,
      ...group.city_ids,
      ...group.plots.flatMap((plot) => [plot.site_plot_id, plot.level]),
    ];
    // A numeric query represents an ID or level. Match it exactly so `40`
    // does not also return city 540 (or an incidental number in a filename).
    if (/^\d+$/.test(keyword)) {
      return numericValues.some((value) => String(value) === keyword);
    }
    const values = [group.site_name, ...group.site_ids, ...group.city_ids];
    // `file` includes a content-hash suffix, so it is deliberately not searchable.
    for (const plot of group.plots) values.push(plot.site_plot_id, plot.level);
    if (group.byNation) values.push(...group.site_ids.map(nationSiteName));
    values.push(...group.city_ids.map(uwCityName));
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

export function formatUtc8(value) {
  if (!value) return '時間未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '時間未知';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(/\//g, '-');
}

export function latestFetchedAt(rows) {
  return rows
    .map((row) => row.fetched_at)
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
}

export function variantLabel(variant) {
  return VARIANT_LABEL[variant] || variant;
}

export function uwCityName(cityId) {
  const normalizedId = String(cityId ?? '').trim();
  const capturedName = state.uwIndex?.plots?.find(
    (plot) => String(plot.city_id) === normalizedId && plot.city_name && plot.city_name !== '-',
  )?.city_name;
  return UW_CITY_NAMES[normalizedId] || capturedName || `城市${normalizedId || '未知'}`;
}

export function uwLocation(cityId) {
  return `地點：${uwCityName(cityId)}（ID：${cityId ?? '—'}）`;
}

/**
 * 陣營劇情卡：九個陣營合併成一張卡，按鈕就是各陣營。
 * 它是陣營的屬性、不隸屬任何城市，所以不受篇章與關鍵字篩選影響，固定排在最前。
 */
export function nationCardHtml() {
  const nations = state.nationIndex?.nations || [];
  if (!nations.length) return '';
  const total = nations.reduce((sum, n) => sum + Number(n.total || 0), 0);
  const buttons = nations
    .map(
      (n) => `<button class="level-btn nation-play-link" data-nation-id="${escapeHtml(n.id)}"
                data-nation-name="${escapeHtml(n.name || '')}"
                title="${escapeHtml(n.name || `陣營 ${n.id}`)}：${escapeHtml(n.total)} 張">${escapeHtml(
        n.name || `陣營 ${n.id}`,
      )}</button>`,
    )
    .join('');
  return `
    <article class="story-card nation-card">
      <div>
        <div class="eyebrow">NATION STORY</div>
        <h3>陣營劇情</h3>
        <p>九個陣營各一套，與主線的紅軍／非紅軍版本無關。</p>
      </div>
      <div class="uw-levels" aria-label="陣營劇情">${buttons}</div>
      <div class="card-foot">
        <span class="count">${nations.length} 個陣營 · 共 ${total} 張</span>
        <span class="uw-level-hint">選擇陣營後播放</span>
      </div>
    </article>`;
}

export function renderCards(container) {
  const rows = filtered();
  const nationCard = nationCardHtml();
  if (!rows.length) {
    container.innerHTML = nationCard + '<div class="empty">找不到符合條件的劇情。</div>';
    return;
  }
  container.innerHTML = nationCard + rows
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
            <h3>${escapeHtml(s.city_name || `城市${s.city_id ?? '未知'}`)}</h3>
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
    .map((group) => (group.byNation ? nationSiteCardHtml(group) : siteCardHtml(group)))
    .join('');
}

/** 一般 UW 地點：按鈕是 Level × 結果。 */
function siteCardHtml(group) {
  const plots = [...group.plots].sort((a, b) => {
    const level = Number(a.level) - Number(b.level);
    return level || Number(a.site_plot_id) - Number(b.site_plot_id);
  });
  const resultNumbers = new Map();
  const levels = plots
    .map((plot) => {
      const level = String(plot.level ?? '—');
      const resultNumber = (resultNumbers.get(level) || 0) + 1;
      resultNumbers.set(level, resultNumber);
      return uwButtonHtml(plot, `Level ${escapeHtml(level)} · 結果 ${resultNumber}`);
    })
    .join('');
  return uwCardShell({
    eyebrow: `siteID:${escapeHtml(group.site_id)}`,
    title: escapeHtml(group.site_name || '未命名劇情'),
    subtitle: escapeHtml(uwLocation(group.city_id)),
    buttons: levels,
    group,
    unit: '個結果',
    hint: '選擇等級後播放',
  });
}

/** 暗巷這類地點每個陣營一版，合併成一張卡，按鈕就是陣營。 */
function nationSiteCardHtml(group) {
  const plots = [...group.plots].sort((a, b) => Number(a.site_id) - Number(b.site_id));
  const buttons = plots
    .map((plot) => uwButtonHtml(plot, escapeHtml(nationSiteName(plot.site_id)), nationSiteName(plot.site_id)))
    .join('');
  const places = plots
    .map((plot) => `${nationSiteName(plot.site_id)}（${uwCityName(plot.city_id)}）`)
    .join('、');
  return uwCardShell({
    eyebrow: `siteID:${escapeHtml(group.site_ids.join(' / '))}`,
    title: escapeHtml(group.site_name || '未命名劇情'),
    subtitle: `地點：${escapeHtml(places)}`,
    buttons,
    group,
    unit: '個陣營',
    hint: '選擇陣營後播放',
    cardClass: ' by-nation',
  });
}

function uwButtonHtml(plot, label, nationName) {
  const nationAttr = nationName ? ` data-nation-name="${escapeHtml(nationName)}"` : '';
  return `<button class="level-btn uw-play-link" data-file="${escapeHtml(plot.file)}"
            data-level="${escapeHtml(plot.level ?? '')}" data-plot-id="${escapeHtml(plot.site_plot_id)}"${nationAttr}
            title="site_plot_id ${escapeHtml(plot.site_plot_id)}">${label}</button>`;
}

function uwCardShell({ eyebrow, title, subtitle, buttons, group, unit, hint, cardClass = '' }) {
  const total = group.plots.reduce((sum, plot) => sum + Number(plot.total || 0), 0);
  const dialogue = group.plots.reduce((sum, plot) => sum + Number(plot.with_dialogue || 0), 0);
  return `
    <article class="story-card uw-card${cardClass}">
      <div>
        <div class="eyebrow">${eyebrow}</div>
        <h3>${title}</h3>
        <p>${subtitle}</p>
      </div>
      <div class="uw-levels" aria-label="${title} 劇情段落">${buttons}</div>
      <div class="card-foot">
        <span class="count">${total} 張 · 對白 ${dialogue} · ${group.plots.length} ${unit}</span>
        <span class="uw-level-hint">${hint}</span>
      </div>
    </article>`;
}
