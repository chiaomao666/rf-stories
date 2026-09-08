// 劇情播放器。
//
// 依 docs/story_slides_engine.md 的「渲染順序」一節重寫（不是移植遊戲原始碼），
// 幾何與時間參數再對照 assets/vendor 裡 sourcemap 還原出的 pages/Story.js 校正過。
// 推進整個播放器的 state 只有兩個——slideIdx 與 dialogueComplete。

import {
  AUTOPLAY_KICKOFF_MS,
  AUTOPLAY_MS,
  AVATAR_POSITIONS,
  EFFECT_DURATION,
  SLOTS,
  TRANSITION_MS,
  TYPE_SPEED_MS,
} from './config.js';
import { localAssetUrl, remoteAssetUrl } from './assets.js';
import { applyMusic, ensurePlaying, playSoundEffect, stopAll } from './audio.js';
import { typeInto } from './typewriter.js';

export class StoryPlayer {
  /**
   * @param {object} refs 舞台各部位的 DOM 節點
   */
  constructor(refs) {
    this.refs = refs;
    this.slides = [];
    this.slideIdx = 0;
    this.dialogueComplete = false;
    this.autoPlay = false;
    this.typeSpeed = TYPE_SPEED_MS.normal;
    this.typing = null;
    this.pageTimer = null;
    this.lastBackground = null;
    this.activeLayer = 0; // 背景兩層交叉淡入，記住目前顯示哪一層
    this.onChange = null;

    refs.stage.addEventListener('click', () => this.handleTap());
  }

  /**
   * 載入一段劇情。
   * @param {object[]} slides
   * @param {'story_nation'|'before_attack'|'after_attack'|'uw_plot'} mode
   */
  load(slides, mode = 'before_attack') {
    // 後台把劇情設 active 卻沒編 slide 時後端會回空陣列。空陣列是 truthy，
    // 遊戲本體就是在這裡整頁崩潰過，所以這裡明確擋掉。
    this.slides = Array.isArray(slides) ? slides : [];
    this.mode = mode;
    this.slideIdx = this.startIndex(mode);
    this.lastBackground = null;
    this.refs.backgrounds.forEach((el) => {
      el.style.backgroundImage = '';
    });
    if (!this.slides.length) {
      this.renderEmpty();
      return;
    }
    this.renderSlide();
  }

  /**
   * 決定起始 index：after_attack 掃到第一個 before_attack === false 的 slide，
   * 其餘三種 mode 一律從 0 開始。
   */
  startIndex(mode) {
    if (mode !== 'after_attack') return 0;
    const idx = this.slides.findIndex((s) => s.before_attack === false);
    return idx < 0 ? 0 : idx;
  }

  get current() {
    return this.slides[this.slideIdx] || null;
  }

  renderEmpty() {
    this.refs.speaker.textContent = '';
    this.refs.dialogue.innerHTML = '這段劇情沒有任何 slide。';
    this.refs.actors.innerHTML = '';
    this.notify();
  }

  renderSlide() {
    const slide = this.current;
    if (!slide) return;

    this.clearTimers();
    this.dialogueComplete = false;

    this.applyTransitionStyle(slide);
    this.renderBackground(slide);
    this.renderPlacement(slide);
    this.renderDialogue(slide);

    applyMusic(slide.music);
    if (slide.sound_effect) playSoundEffect(slide.sound_effect);

    this.scheduleAdvance(slide);
    this.notify();
  }

  /**
   * fade_in / fade_out 兩個 bool 組成轉場 class：fadein / fadeout / fadeinout / ''。
   * 兩者皆無時遊戲不掛任何 CSSTransition class，背景是直接換的，所以這裡用 0ms。
   * 有掛的話遊戲的 *-active 一律是 opacity 1000ms ease-out。
   */
  applyTransitionStyle(slide) {
    const name =
      slide.fade_in && slide.fade_out
        ? 'fadeinout'
        : slide.fade_in
          ? 'fadein'
          : slide.fade_out
            ? 'fadeout'
            : '';
    this.refs.stage.dataset.transition = name;
    this.refs.stage.style.setProperty(
      '--transition-ms',
      `${name ? TRANSITION_MS.crossfade : 0}ms`,
    );
  }

  /**
   * 背景轉場的 key 綁 background 值而非 slideIdx——連續多張同背景的 slide
   * 不重跑轉場，這是遊戲本體的行為。
   */
  renderBackground(slide) {
    const path = slide.background || '';
    if (path === this.lastBackground) return;
    this.lastBackground = path;

    const next = (this.activeLayer + 1) % 2;
    const layer = this.refs.backgrounds[next];
    const url = path ? localAssetUrl(path) : '';

    const show = (src) => {
      layer.style.backgroundImage = src ? `url("${src}")` : '';
      this.refs.backgrounds[this.activeLayer].classList.remove('is-active');
      layer.classList.add('is-active');
      this.activeLayer = next;
    };

    if (!path) {
      show('');
      return;
    }
    const probe = new Image();
    probe.onload = () => show(url);
    probe.onerror = () => show(remoteAssetUrl(path));
    probe.src = url;
  }

  /** 走訪 placement 的五個站位，figure 為 null 者跳過。 */
  renderPlacement(slide) {
    const placement = slide.placement || {};
    this.refs.actors.innerHTML = '';

    for (const slot of SLOTS) {
      const cfg = placement[slot];
      if (!cfg || !cfg.figure) continue;

      const pos = AVATAR_POSITIONS[slot];
      // 結構照遊戲的 Character：posBox（站位、滿版裁切）→ actorImgBox（置中放大）→ img
      const posBox = document.createElement('div');
      posBox.className = 'pos-box';
      posBox.dataset.slot = slot;
      posBox.style.left = `${pos.left}%`;
      posBox.style.zIndex = String(pos.zIndex);

      const imgBox = document.createElement('div');
      imgBox.className = 'actor-img-box';

      const img = document.createElement('img');
      img.className = 'actor-img';
      img.alt = '';
      img.src = localAssetUrl(cfg.figure);
      img.dataset.remote = remoteAssetUrl(cfg.figure);
      img.onerror = () => {
        img.onerror = null;
        img.src = img.dataset.remote;
      };
      // 立繪 GIF 與靜態故事角色圖構圖不同，遊戲對兩層都另外套 .gif。
      if (cfg.figure.toLowerCase().endsWith('gif')) {
        imgBox.classList.add('is-gif');
        img.classList.add('is-gif');
      }
      if (cfg.color_filter) img.classList.add(`filter_${cfg.color_filter}`);

      imgBox.appendChild(img);
      posBox.appendChild(imgBox);
      this.refs.actors.appendChild(posBox);
      this.applyEffect(posBox, img, cfg);
    }
  }

  applyEffect(holder, img, cfg) {
    switch (cfg.effect) {
      case 'fade_in':
        img.style.setProperty('--effect-ms', `${EFFECT_DURATION.fade_in}ms`);
        img.classList.add('effect-fade');
        break;
      case 'swift_in':
        img.style.setProperty('--effect-ms', `${EFFECT_DURATION.swift_in}ms`);
        img.classList.add('effect-fade');
        break;
      case 'half_transparent':
        img.classList.add('effect-half');
        break;
      case 'motion':
        img.style.setProperty('--effect-ms', `${EFFECT_DURATION.motion}ms`);
        img.classList.add('effect-motion');
        break;
      case 'horizontal_shift': {
        const to = AVATAR_POSITIONS[cfg.shift_to];
        if (!to) break;
        // 遊戲是對外層容器補間 left 與 zIndex。zIndex 無法平滑補間，
        // 直接切到目標值，位移交給 transition。
        holder.style.setProperty('--shift-ms', `${EFFECT_DURATION.horizontal_shift}ms`);
        holder.classList.add('effect-shift');
        requestAnimationFrame(() => {
          holder.style.left = `${to.left}%`;
          holder.style.zIndex = String(to.zIndex);
        });
        break;
      }
      default:
        break; // null：直接出現
    }
  }

  renderDialogue(slide) {
    // speaker 為 null 時遊戲就是留白，不會印「旁白」字樣。
    this.refs.speaker.textContent = slide.speaker || '';
    this.refs.dialogue.classList.toggle('dialogue_color', Boolean(slide.dialogue_color));

    this.typing?.cancel();
    if (!slide.dialogue) {
      this.refs.dialogue.innerHTML = '';
      this.dialogueComplete = true;
      return;
    }
    this.typing = typeInto(this.refs.dialogue, slide.dialogue, this.typeSpeed, () => {
      this.dialogueComplete = true;
      this.notify();
    });
  }

  /**
   * 有 duration → 到時自動翻頁；否則開啟自動播放才固定停 3 秒；都沒有就等點擊。
   */
  scheduleAdvance(slide) {
    if (slide.duration != null) {
      this.pageTimer = setTimeout(() => this.next(), slide.duration * 1000);
      return;
    }
    if (this.autoPlay) {
      this.pageTimer = setTimeout(() => this.next(), AUTOPLAY_MS);
    }
  }

  /**
   * 全螢幕感應區：第一下補完打字、第二下才翻頁。
   * 但若該張有 duration，點擊永遠只做「補完打字」，不提前翻頁。
   */
  handleTap() {
    // 點擊是貨真價實的 user activation，被自動播放政策擋下的 BGM 只有在這種時機救得回來。
    ensurePlaying();
    if (!this.current) return;
    if (!this.dialogueComplete) {
      this.typing?.complete();
      return;
    }
    if (this.current.duration != null) return;
    this.next();
  }

  next() {
    if (this.slideIdx >= this.slides.length - 1) {
      this.clearTimers();
      this.onFinish?.();
      return;
    }
    this.slideIdx += 1;
    this.renderSlide();
  }

  prev() {
    if (this.slideIdx <= 0) return;
    this.slideIdx -= 1;
    this.renderSlide();
  }

  seek(index) {
    if (index < 0 || index >= this.slides.length) return;
    this.slideIdx = index;
    this.renderSlide();
  }

  toggleAutoPlay() {
    this.autoPlay = !this.autoPlay;
    this.clearTimers();
    if (this.autoPlay) {
      // 開啟瞬間先排一個 1 秒 timer 推進第一張，之後才是每張 3 秒。
      this.pageTimer = setTimeout(() => this.next(), AUTOPLAY_KICKOFF_MS);
    } else if (this.current) {
      this.scheduleAdvance(this.current);
    }
    this.notify();
    return this.autoPlay;
  }

  setTypeSpeed(ms) {
    this.typeSpeed = ms;
  }

  clearTimers() {
    clearTimeout(this.pageTimer);
    this.pageTimer = null;
  }

  stop() {
    this.clearTimers();
    this.typing?.cancel();
    stopAll();
  }

  notify() {
    this.onChange?.(this);
  }
}
