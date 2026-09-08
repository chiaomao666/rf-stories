// 播放引擎的常數。數值全部取自 docs/story_slides_engine.md 的實測紀錄，
// 改動前請先回頭核對文件，不要憑感覺調。

/** 官方素材 CDN。本地 assets/ 找不到檔案時才 fallback 到這裡。 */
export const REMOTE_ASSET_BASE = 'https://media.komisureiya.com';

/** 本地素材根目錄（相對於 site/），底下維持與 slide 路徑一致的 images/ 與 audio/。 */
export const LOCAL_ASSET_BASE = 'assets/';

/**
 * 五個站位的位置與疊圖層級，寫死在遊戲 Story.js 的 avatarPoss。
 * 中間 c 最前，兩側往後遞減——自行重寫播放器時最容易漏掉的細節。
 */
export const AVATAR_POSITIONS = {
  a: { left: 20, zIndex: 6 },
  b: { left: 32, zIndex: 8 },
  c: { left: 50, zIndex: 9 },
  d: { left: 68, zIndex: 7 },
  e: { left: 80, zIndex: 5 },
};

export const SLOTS = ['a', 'b', 'c', 'd', 'e'];

/**
 * 立繪特效的時間參數。fade_in / swift_in 的值直接來自遊戲 Story.js 的 config.duration；
 * motion 與 horizontal_shift 在遊戲裡是沒指定 duration 的 react-spring，
 * 這裡取視覺上接近的值。
 */
export const EFFECT_DURATION = {
  fade_in: 2000,
  swift_in: 500,
  motion: 800,
  horizontal_shift: 1000,
};

/**
 * 背景轉場。遊戲的 fadein/fadeout/fadeinout-*-active 都是 opacity 1000ms ease-out
 * （值取自遊戲 index.css）；文件裡的 100ms / 1000ms 是 React CSSTransition 的 timeout，
 * 不是實際的動畫長度。fade_in 與 fade_out 都沒設時不掛 class，背景直接換。
 */
export const TRANSITION_MS = { crossfade: 1000 };

/** 打字機速度（毫秒／字）。遊戲的 Typed.js 設定是 typeSpeed: 1，近乎瞬間。 */
export const TYPE_SPEED_MS = { instant: 1, normal: 22, slow: 45 };

/** 未指定 duration 且開啟自動播放時，每張固定停留 3 秒。 */
export const AUTOPLAY_MS = 3000;

/** 開啟自動播放的瞬間，先排一個 1 秒 timer 推進第一張。 */
export const AUTOPLAY_KICKOFF_MS = 1000;

export const VARIANT_LABEL = {
  red_army: '紅軍',
  non_red_army: '非紅軍',
};
