// 保留標記的打字機。
//
// dialogue 是 HTML，而且用的是自訂標籤（實測只有 <b9>，另有 <br> / <i> / <b>）。
// 直接對字串做 slice 會把標籤切成兩半，所以先解析成 DOM，再逐字揭露文字節點。

/**
 * @param {HTMLElement} target 要吐字的容器
 * @param {string} html dialogue 的原始 HTML
 * @param {number} speedMs 每字毫秒數
 * @param {() => void} onComplete 打完時的 callback
 * @returns {{ complete: () => void, cancel: () => void }}
 */
export function typeInto(target, html, speedMs, onComplete) {
  target.innerHTML = html || '';

  const textNodes = [];
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    textNodes.push({ node, full: node.nodeValue });
  }

  const total = textNodes.reduce((sum, t) => sum + t.full.length, 0);
  if (!total) {
    onComplete?.();
    return { complete() {}, cancel() {} };
  }

  // 先清空文字但保留元素結構，這樣 <br> 造成的換行從一開始就佔好位置，
  // 不會在打字過程中把整段對白往下推。
  textNodes.forEach((t) => {
    t.node.nodeValue = '';
  });

  let shown = 0;
  let timer = null;
  let done = false;

  function render() {
    let remaining = shown;
    for (const t of textNodes) {
      if (remaining <= 0) {
        t.node.nodeValue = '';
        continue;
      }
      t.node.nodeValue = t.full.slice(0, remaining);
      remaining -= t.full.length;
    }
  }

  function finish() {
    if (done) return;
    done = true;
    clearInterval(timer);
    shown = total;
    render();
    onComplete?.();
  }

  timer = setInterval(() => {
    shown += 1;
    if (shown >= total) {
      finish();
      return;
    }
    render();
  }, Math.max(1, speedMs));

  return {
    complete: finish,
    cancel() {
      done = true;
      clearInterval(timer);
    },
  };
}
