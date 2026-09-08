// BGM 與音效。
//
// 關鍵行為：slide 的 music 未填**等於停止音樂**（遊戲的 playMusic(false)），不是延續
// 上一首。這是重播工具最容易做錯的地方——沿用上一首會讓靜場的段落完全走味。
//
// 另一個坑是瀏覽器的自動播放政策：頁面還沒有 user activation 時 play() 會被拒絕。
// 全資料 17,204 張裡有 16,746 張帶 music，而且往往連續幾十張都是同一首，
// 所以「同一首就早退」的寫法一旦第一次 play() 失敗，後面永遠不會再試，音樂就再也不會響。
// 因此這裡改成：只要沒靜音、有音源而且是暫停狀態，就重試播放。

import { resolveAssetUrl } from './assets.js';

const music = new Audio();
music.loop = true;
music.preload = 'auto';

let currentMusicPath = null;
let muted = false;
let blocked = false; // 上一次 play() 被瀏覽器擋下
let onBlockedChange = null;

export function isMuted() {
  return muted;
}

export function isBlocked() {
  return blocked;
}

/** 播放狀態被瀏覽器擋下／恢復時通知呼叫端，好讓 UI 給提示。 */
export function setBlockedListener(fn) {
  onBlockedChange = fn;
}

function setBlocked(value) {
  if (blocked === value) return;
  blocked = value;
  onBlockedChange?.(blocked);
}

/**
 * 只要條件成立就（重新）播放。可以隨時呼叫，尤其是在使用者剛互動完的時候——
 * 那是把被自動播放政策擋下的音樂救回來的唯一時機。
 */
export async function ensurePlaying() {
  if (muted || !currentMusicPath || !music.src || !music.paused) return;
  try {
    await music.play();
    setBlocked(false);
  } catch {
    setBlocked(true);
  }
}

export function setMuted(value) {
  muted = Boolean(value);
  music.muted = muted;
  if (muted) {
    music.pause();
    setBlocked(false);
  } else {
    ensurePlaying();
  }
  return muted;
}

export function setVolume(value) {
  music.volume = Math.max(0, Math.min(1, value));
}

/** 依 slide 的 music 欄位切換 BGM；path 為空即停止。 */
export async function applyMusic(path) {
  if (!path) {
    currentMusicPath = null;
    music.pause();
    music.removeAttribute('src');
    setBlocked(false);
    return;
  }
  if (path === currentMusicPath) {
    // 同一首不重新載入，但仍要確認它真的在播——先前可能被擋下或被暫停過。
    ensurePlaying();
    return;
  }

  currentMusicPath = path;
  const url = await resolveAssetUrl(path, { kind: 'audio' });
  if (currentMusicPath !== path) return; // 探測期間又換頁了

  music.src = url;
  music.muted = muted;
  ensurePlaying();
}

/** 進場音效，播一次。 */
export async function playSoundEffect(path) {
  if (!path || muted) return;
  const url = await resolveAssetUrl(path, { kind: 'audio' });
  const sfx = new Audio(url);
  sfx.volume = music.volume;
  sfx.play().catch(() => {}); // 音效漏掉一次無所謂，不像 BGM 會整段沒聲音
}

export function stopAll() {
  currentMusicPath = null;
  music.pause();
  music.removeAttribute('src');
  setBlocked(false);
}
