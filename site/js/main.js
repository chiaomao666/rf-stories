// 首頁與播放器的接線。

import { TYPE_SPEED_MS } from './config.js';
import * as archive from './archive.js';
import { isMuted, setBlockedListener, setMuted, setVolume } from './audio.js';
import { StoryPlayer } from './story.js';

const $ = (sel) => document.querySelector(sel);

const player = new StoryPlayer({
  stage: $('#stage'),
  backgrounds: [...document.querySelectorAll('.bg-layer')],
  actors: $('#actors'),
  speaker: $('#speaker'),
  dialogue: $('#dialogue'),
});

let currentStory = null; // { title, meta, slides }

// ---- 首頁 -----------------------------------------------------------------

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2400);
}

function renderStats() {
  const idx = archive.state.index;
  if (!idx) return;
  const totals = (idx.cities || []).reduce(
    (acc, c) => {
      acc.slides += c.total || 0;
      acc.dialogues += c.with_dialogue || 0;
      return acc;
    },
    { slides: 0, dialogues: 0 },
  );
  $('#statCities').textContent = idx.cities_with_story ?? (idx.cities || []).length;
  $('#statSlides').textContent = totals.slides.toLocaleString('zh-TW');
  $('#statDialogues').textContent = totals.dialogues.toLocaleString('zh-TW');
  const order = archive.hasGameOrder()
    ? '遊戲順序'
    : '章節順序（這份資料沒有 position，重跑 fetch_main_story.py 可取得遊戲順序）';
  $('#loadedNote').textContent =
    `${archive.variantLabel(idx.variant)}版本 · 更新於 ${archive.formatUtc8(idx.fetched_at)}（UTC+8） · ${order}`;
}

function fillChapters() {
  const select = $('#chapter');
  const options = ['<option value="all">所有篇章</option>'].concat(
    archive.chapters().map((c) => `<option value="${archive.escapeHtml(c)}">${archive.escapeHtml(c)}</option>`),
  );
  select.innerHTML = options.join('');
  select.value = 'all';
  archive.state.chapter = 'all';
}

async function switchVariant(variant) {
  $('#loadedNote').textContent = '正在載入資料…';
  try {
    await archive.loadVariant(variant);
    fillChapters();
    renderStats();
    archive.renderCards($('#storyGrid'));
  } catch (err) {
    $('#loadedNote').textContent = String(err.message || err);
    $('#storyGrid').innerHTML = `<div class="empty">${archive.escapeHtml(err.message || err)}</div>`;
  }
}

// ---- 播放器 ---------------------------------------------------------------

/** 依段落切出要播的 slides。 */
function sliceByPhase(slides, phase) {
  if (phase === 'before') return slides.filter((s) => s.before_attack);
  if (phase === 'after') return slides.filter((s) => !s.before_attack);
  return slides;
}

function openPlayer(story) {
  currentStory = story;
  $('#playerTitle').textContent = story.title;
  $('#playerMeta').textContent = story.meta;
  const phaseSelect = $('#phase');
  phaseSelect.value = story.defaultPhase || 'all';
  phaseSelect.disabled = !isAttackStory(story.mode || 'before_attack');
  $('#player').hidden = false;
  document.body.classList.add('is-playing');
  applyPhase();
}

function applyPhase() {
  if (!currentStory) return;
  const mode = currentStory.mode || 'before_attack';
  // 只有攻城劇情能切段：陣營劇情沒有 before_attack，UW 的 before_attack 是殘值。
  const phase = isAttackStory(mode) ? $('#phase').value : 'all';
  const slides = sliceByPhase(currentStory.slides, phase);
  // phase 不是 all 時已經自己切好段，交給引擎一律從 0 開始，避免二次跳段。
  player.load(slides, phase === 'all' ? mode : mode === 'after_attack' ? 'before_attack' : mode);
}

function isAttackStory(mode) {
  return mode === 'before_attack' || mode === 'after_attack';
}

function closePlayer() {
  player.stop();
  $('#player').hidden = true;
  document.body.classList.remove('is-playing');
  currentStory = null;
}

player.onChange = (p) => {
  const total = p.slides.length;
  const pos = total ? p.slideIdx + 1 : 0;
  $('#counter').textContent = `${pos} / ${total}`;
  $('#bar').style.width = total ? `${(pos / total) * 100}%` : '0';
  renderLog(p);
};

player.onFinish = () => toast('這段劇情播完了。');

function renderLog(p) {
  const panel = $('#logPanel');
  if (panel.hidden) return;
  // 遊戲的 LOG 只列 index <= 目前、且 dialogue 非空者，並自動捲到底。
  const rows = p.slides.slice(0, p.slideIdx + 1).filter((s) => s.dialogue);
  $('#logCont').innerHTML = rows
    .map(
      (s) =>
        `<div class="log-item"><b>${archive.escapeHtml(s.speaker || '')}</b><span>${s.dialogue}</span></div>`,
    )
    .join('');
  panel.scrollTop = panel.scrollHeight;
}

// ---- 事件 -----------------------------------------------------------------

$('#variant').addEventListener('change', (e) => switchVariant(e.target.value));
$('#chapter').addEventListener('change', (e) => {
  archive.state.chapter = e.target.value;
  archive.renderCards($('#storyGrid'));
});
$('#search').addEventListener('input', (e) => {
  archive.state.keyword = e.target.value;
  archive.renderCards($('#storyGrid'));
});

$('#uwSearch').addEventListener('input', (e) => {
  archive.state.uwKeyword = e.target.value;
  renderUwFilterResults();
});

$('#uwLevel').addEventListener('change', (e) => {
  archive.state.uwLevel = e.target.value;
  renderUwFilterResults();
});

$('#uwCity').addEventListener('change', (e) => {
  archive.state.uwCity = e.target.value;
  renderUwFilterResults();
});

$('#storyGrid').addEventListener('click', async (e) => {
  const btn = e.target.closest('.play-link');
  if (!btn) return;
  try {
    const doc = await archive.loadCity(archive.state.variant, btn.dataset.file);
    openPlayer({
      title: doc.title
        ? `${doc.title}｜${doc.city_name || btn.dataset.city}`
        : `${doc.city_name || btn.dataset.city}（city ${doc.city_id}）`,
      meta: `${archive.variantLabel(archive.state.variant)}版本 · ${doc.counts?.total ?? doc.slides.length} 張`,
      slides: doc.slides || [],
      mode: 'before_attack',
      defaultPhase: 'all',
    });
  } catch (err) {
    toast(String(err.message || err));
  }
});

$('#uwGrid').addEventListener('click', async (e) => {
  const btn = e.target.closest('.uw-play-link');
  if (!btn) return;
  try {
    if (btn.disabled) return;
    const doc = await archive.loadUwPlot(btn.dataset.file);
    openPlayer({
      title: `UW 劇情｜${doc.site_name || '未命名劇情'} · Level ${doc.level ?? btn.dataset.level ?? '—'}`,
      meta: `${archive.uwLocation(doc.city_id)} · 劇情段落 ${doc.site_plot_id ?? '—'} · ${doc.counts?.total ?? doc.slides?.length ?? 0} 張 · 收錄於 ${archive.formatUtc8(doc.fetched_at)}（UTC+8）`,
      slides: doc.slides || [],
      mode: 'uw_plot',
      defaultPhase: 'all',
    });
  } catch (err) {
    toast(String(err.message || err));
  }
});

// 陣營劇情與主線變體無關，九個陣營各一套，清單直接讀 nation_story/index.json。
async function fillNations() {
  const select = $('#nationStory');
  try {
    const idx = await archive.loadNationIndex();
    const options = (idx.nations || []).map(
      (n) =>
        `<option value="${n.id}">${archive.escapeHtml(n.name || `陣營 ${n.id}`)}（${n.total} 張）</option>`,
    );
    select.innerHTML = `<option value="">陣營劇情…（${options.length}/9）</option>` + options.join('');
  } catch {
    select.innerHTML = '<option value="">陣營劇情（讀取失敗）</option>';
  }
}

async function fillUwPlots() {
  const note = $('#uwLoadedNote');
  try {
    const idx = await archive.loadUwIndex();
    const levelSelect = $('#uwLevel');
    levelSelect.innerHTML = '<option value="all">所有等級</option>' + archive.uwLevels()
      .map((level) => `<option value="${archive.escapeHtml(level)}">Level ${archive.escapeHtml(level)}</option>`)
      .join('');
    const citySelect = $('#uwCity');
    citySelect.innerHTML = '<option value="all">所有城市</option>' + archive.uwCities()
      .map((city) => `<option value="${archive.escapeHtml(city)}">${archive.escapeHtml(archive.uwCityName(city))}（ID：${archive.escapeHtml(city)}）</option>`)
      .join('');
    archive.renderUwCards($('#uwGrid'));
    note.textContent = `${archive.groupedUwPlots().length} 個地點 · ${idx.plots_total ?? idx.plots?.length ?? 0} 段 · ${idx.slides_total ?? 0} 張 slides · 更新於 ${archive.formatUtc8(archive.latestFetchedAt(idx.plots || []))}（UTC+8）`;
  } catch (err) {
    note.textContent = '尚未載入 UW 資料';
    $('#uwGrid').innerHTML = `<div class="empty">${archive.escapeHtml(err.message || err)}</div>`;
  }
}

function renderUwFilterResults() {
  archive.renderUwCards($('#uwGrid'));
  const total = archive.groupedUwPlots().length;
  const shown = archive.filteredUw().length;
  $('#uwLoadedNote').textContent = `顯示 ${shown} / ${total} 個 UW 地點`;
}

$('#nationStory').addEventListener('change', async (e) => {
  const id = e.target.value;
  e.target.selectedIndex = 0;
  if (!id) return;
  try {
    const doc = await archive.loadNationStory(id);
    openPlayer({
      title: `陣營劇情｜${doc.nation?.name || `陣營 ${id}`}`,
      meta: `story_nation · ${doc.counts?.total ?? doc.slides.length} 張`,
      slides: doc.slides || [],
      mode: 'story_nation',
      defaultPhase: 'all',
    });
  } catch (err) {
    toast(String(err.message || err));
  }
});

$('#phase').addEventListener('change', applyPhase);
$('#closePlayer').addEventListener('click', closePlayer);
$('#prevSlide').addEventListener('click', () => player.prev());
$('#nextSlide').addEventListener('click', () => player.next());

$('#autoPlay').addEventListener('click', (e) => {
  const on = player.toggleAutoPlay();
  e.currentTarget.classList.toggle('is-on', on);
  e.currentTarget.textContent = on ? '⏸ 自動播放中' : '▶ 自動播放';
});

$('#typeSpeed').addEventListener('change', (e) => {
  player.setTypeSpeed(TYPE_SPEED_MS[e.target.value] ?? TYPE_SPEED_MS.normal);
});

function renderSoundButton() {
  const btn = $('#soundToggle');
  const muted = isMuted();
  btn.textContent = muted ? '🔇 音效關' : '🔊 音效開';
  btn.classList.toggle('is-on', !muted);
}

$('#soundToggle').addEventListener('click', () => {
  setMuted(!isMuted());
  renderSoundButton();
});

// 瀏覽器在頁面還沒有 user activation 前會拒絕 play()。與其無聲失敗，
// 不如講清楚——點畫面任何一處就會恢復。
setBlockedListener((blocked) => {
  if (blocked) toast('瀏覽器擋下了自動播放，點一下畫面即可開始播放音樂。');
});

$('#volume').addEventListener('input', (e) => setVolume(Number(e.target.value)));

$('#logToggle').addEventListener('click', (e) => {
  const panel = $('#logPanel');
  panel.hidden = !panel.hidden;
  e.currentTarget.classList.toggle('is-on', !panel.hidden);
  renderLog(player);
});

document.addEventListener('keydown', (e) => {
  if ($('#player').hidden) return;
  if (e.key === 'Escape') closePlayer();
  if (e.key === 'ArrowRight' || e.key === ' ') {
    e.preventDefault();
    player.handleTap();
  }
  if (e.key === 'ArrowLeft') player.prev();
});

// ---- 啟動 -----------------------------------------------------------------

setVolume(Number($('#volume').value));
renderSoundButton();
fillNations();
fillUwPlots();
switchVariant($('#variant').value);
