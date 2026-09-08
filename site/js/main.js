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
    `${archive.variantLabel(idx.variant)}版本 · 更新於 ${String(idx.fetched_at || '').slice(0, 10)} · ${order}`;
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

$('#playNation').addEventListener('click', async () => {
  try {
    const doc = await archive.loadNationStory(archive.state.variant);
    openPlayer({
      title: `陣營劇情｜${doc.nation?.name || archive.variantLabel(archive.state.variant)}`,
      meta: `story_nation · ${doc.counts?.total ?? doc.slides.length} 張`,
      slides: doc.slides || [],
      mode: 'story_nation',
      defaultPhase: 'all',
    });
  } catch (err) {
    toast(String(err.message || err));
  }
});

$('#importFile').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const doc = JSON.parse(reader.result);
      const slides = doc.slides || (Array.isArray(doc) ? doc : []);
      if (!slides.length) throw new Error('這個檔案裡沒有 slides');
      openPlayer({
        title: doc.city_name || doc.site_name || file.name,
        meta: `匯入檔案 · ${slides.length} 張`,
        slides,
        // UW 劇情的 before_attack 是無意義的殘值，一律從 0 開始、不切段。
        mode: doc.site_plot_id ? 'uw_plot' : 'before_attack',
        defaultPhase: 'all',
      });
    } catch (err) {
      toast(`匯入失敗：${err.message}`);
    }
  };
  reader.readAsText(file, 'utf-8');
  e.target.value = '';
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
switchVariant($('#variant').value);
