// BGM 與音效。
//
// 關鍵行為：slide 的 music 未填**等於停止音樂**（playMusic(false)），不是延續上一首。
// 這是重播工具最容易做錯的地方——沿用上一首會讓靜場的段落完全走味。

import { resolveAssetUrl } from './assets.js';

const music = new Audio();
music.loop = true;

let currentMusicPath = null;
let muted = true; // 瀏覽器不允許未經互動就播音，預設靜音，由使用者按鈕開啟

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = Boolean(value);
  music.muted = muted;
  if (muted) {
    music.pause();
  } else if (currentMusicPath) {
    music.play().catch(() => {});
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
    return;
  }
  if (path === currentMusicPath) return;

  currentMusicPath = path;
  const url = await resolveAssetUrl(path, { kind: 'audio' });
  if (currentMusicPath !== path) return; // 探測期間又換頁了

  music.src = url;
  music.muted = muted;
  if (!muted) music.play().catch(() => {});
}

/** 進場音效，播一次。 */
export async function playSoundEffect(path) {
  if (!path || muted) return;
  const url = await resolveAssetUrl(path, { kind: 'audio' });
  const sfx = new Audio(url);
  sfx.volume = music.volume;
  sfx.play().catch(() => {});
}

export function stopAll() {
  currentMusicPath = null;
  music.pause();
  music.removeAttribute('src');
}
