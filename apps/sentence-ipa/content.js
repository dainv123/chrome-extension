const ROOT_ID = 'sentence-ipa-root';
const IPA_US = 'gmw/en-US';
const IPA_UK = 'gmw/en-GB-x-rp';
const TTS = {
  us: {
    lang: 'en-US',
    label: 'US',
    // Mac Siri Nicky; fallbacks if missing
    prefer: [/^nicky$/i, /\bnicky\b/i],
  },
  uk: {
    lang: 'en-GB',
    label: 'UK',
    prefer: [/^google uk english female$/i, /google.*uk.*female/i],
  },
};
const TTS_PROVIDER = {
  system: 'system',
  azure: 'azure',
};
const VI_CHAR =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const AI_PROMPT_MAX = 1500;
const AI_URL = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/app',
};
const AI_PRESETS = [
  {
    id: 'pronounce',
    label: 'Phát âm & trọng âm',
    build: (s) =>
      `Giải thích cách phát âm, trọng âm và điểm cần lưu ý khi nói câu này (US và UK nếu khác nhau):\n\n"${s}"`,
  },
  {
    id: 'style',
    label: 'Formal / casual',
    build: (s) =>
      `Viết lại câu sau theo 3 văn phong: formal, neutral, casual. Giữ nghĩa, ngắn gọn, dùng được trong công việc:\n\n"${s}"`,
  },
  {
    id: 'examples',
    label: 'Email / họp',
    build: (s) =>
      `Cho 3 ví dụ dùng câu này (hoặc biến thể tự nhiên) trong email và họp online. Mỗi ví dụ kèm bản tiếng Việt ngắn:\n\n"${s}"`,
  },
];

const RATES = [0.75, 1, 1.25];
const FUNC_WORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'for', 'and', 'in', 'on', 'at', 'is', 'are', 'was', 'were',
  'be', 'as', 'by', 'or', 'but', 'from', 'with', 'that', 'this', 'it', 'its', 'per',
]);
const SOURCE_MAX = 2500;

let direction = 'en-vi';
let speechRate = 1;
let loopSpeech = false;
let playAccent = 'us';
let ttsProvider = TTS_PROVIDER.system;
let azureKey = '';
let azureRegion = 'eastus';
let showLinking = true;
let lastSelection = null;
let currentUtterance = null;
let currentAudio = null;
let phonemizeFn = null;
let highlightTimer = null;
let highlightFallbackTimer = null;
let stylesText = '';
let shadow = null;
let activePanel = null;
const azureAudioCache = new Map();

async function loadTtsSettings() {
  const s = await chrome.storage.local.get({
    ttsProvider: TTS_PROVIDER.system,
    azureKey: '',
    azureRegion: 'eastus',
    showLinking: true,
  });
  ttsProvider = s.ttsProvider === TTS_PROVIDER.azure ? TTS_PROVIDER.azure : TTS_PROVIDER.system;
  azureKey = s.azureKey || '';
  azureRegion = s.azureRegion || 'eastus';
  showLinking = s.showLinking !== false;
}

async function saveTtsSettings(patch) {
  await chrome.storage.local.set(patch);
  if (patch.ttsProvider != null) {
    ttsProvider =
      patch.ttsProvider === TTS_PROVIDER.azure ? TTS_PROVIDER.azure : TTS_PROVIDER.system;
  }
  if (patch.azureKey != null) azureKey = patch.azureKey;
  if (patch.azureRegion != null) azureRegion = patch.azureRegion || 'eastus';
  if (patch.showLinking != null) showLinking = Boolean(patch.showLinking);
}

async function getPhonemize() {
  if (!phonemizeFn) {
    const mod = await import(chrome.runtime.getURL('vendor/phonemizer.js'));
    phonemizeFn = mod.phonemize;
  }
  return phonemizeFn;
}

async function ensureRoot() {
  let host = document.getElementById(ROOT_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = ROOT_ID;
    document.documentElement.appendChild(host);
  }
  if (!shadow) {
    shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    stylesText = await (await fetch(chrome.runtime.getURL('styles.css'))).text();
    let style = shadow.querySelector('style[data-sipa]');
    if (!style) {
      style = document.createElement('style');
      style.dataset.sipa = '1';
      shadow.appendChild(style);
    }
    style.textContent = stylesText;
    if (!shadow.querySelector('.wrap')) {
      const wrap = document.createElement('div');
      wrap.className = 'wrap';
      shadow.appendChild(wrap);
    }
  }
  return shadow.querySelector('.wrap');
}

function wrapEl() {
  return document.getElementById(ROOT_ID)?.shadowRoot?.querySelector('.wrap');
}

/** Panel + portaled pops (word-pop / menu-pop live on .wrap, outside .panel). */
function isInsidePanelUi(e, panel) {
  const path = e.composedPath?.() || [];
  if (path.includes(panel)) return true;
  const wrap = wrapEl();
  for (const role of ['word-pop', 'menu-pop', 'copy-pop']) {
    const el = wrap?.querySelector(`[data-role="${role}"]`) || panel.querySelector(`[data-role="${role}"]`);
    if (el && path.includes(el)) return true;
  }
  return false;
}

ensureRoot();
document.addEventListener('mouseup', onMouseUp);
document.addEventListener(
  'keydown',
  (e) => {
    if (!activePanel) return;
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeAll();
      return;
    }
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      toggleListen(activePanel);
      return;
    }
    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      loopSpeech = !loopSpeech;
      activePanel.querySelector('[data-role="loop"]')?.setAttribute('aria-pressed', String(loopSpeech));
      return;
    }
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      const btn = activePanel.querySelector('[data-role="copy"]');
      const text = copyPayload(activePanel, 'en');
      if (!text || !btn) return;
      navigator.clipboard.writeText(text).then(() => {
        const prev = btn.textContent;
        btn.textContent = 'Đã sao chép';
        setTimeout(() => {
          btn.textContent = prev;
        }, 1200);
      }).catch(() => {});
    }
  },
  true,
);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'SENTENCE_IPA_OPEN') return;
  const text = cleanText(message.text);
  if (!text) return;
  openPanel(text, selectionRect() || fallbackRect());
});

function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function guessDirection(text) {
  return VI_CHAR.test(text) ? 'vi-en' : 'en-vi';
}

/** Split long text into practice-sized chunks on . ! ? ; … and long clauses. */
function splitSegments(text) {
  const raw = String(text || '').match(/[^.!?…;]+[.!?…;]+|[^.!?…;]+$/g) || [text];
  const out = [];
  for (const part of raw) {
    const t = part.trim();
    if (!t) continue;
    if (t.length <= 140 || !/,/.test(t)) {
      out.push(t);
      continue;
    }
    let buf = '';
    for (const clause of t.split(/(?<=,)\s+/)) {
      const next = buf ? `${buf} ${clause}` : clause;
      if (buf && next.length > 120) {
        out.push(buf.trim());
        buf = clause;
      } else {
        buf = next;
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.length ? out : [String(text || '').trim()].filter(Boolean);
}

function selectionRect() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  return rect;
}

function fallbackRect() {
  return { left: window.innerWidth / 2, right: window.innerWidth / 2, top: 80, bottom: 80, width: 0, height: 0 };
}

function onMouseUp(event) {
  if (event.button !== 0) return;
  if (event.target?.closest?.(`#${ROOT_ID}`)) return;
  const path = event.composedPath?.() || [];
  if (path.some((n) => n?.classList?.contains?.('panel') || n?.classList?.contains?.('fab'))) return;

  const text = cleanText(window.getSelection()?.toString());
  if (!text) {
    hideFab();
    lastSelection = null;
    return;
  }
  const rect = selectionRect();
  if (!rect) return;
  lastSelection = { text, rect };
  showFab(rect);
}

async function showFab(rect) {
  const wrap = await ensureRoot();
  hideFab();
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'fab';
  fab.innerHTML = `<span class="fab-dot"></span>Sentence IPA`;
  const top = Math.min(window.innerHeight - 48, rect.bottom + 8);
  const left = Math.min(window.innerWidth - 24, Math.max(24, rect.left + rect.width / 2));
  fab.style.top = `${Math.max(8, top)}px`;
  fab.style.left = `${left}px`;
  fab.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!lastSelection) return;
    openPanel(lastSelection.text, lastSelection.rect);
  });
  wrap.appendChild(fab);
}

function hideFab() {
  wrapEl()?.querySelector('.fab')?.remove();
}

function closeAll() {
  stopSpeech();
  activePanel = null;
  const wrap = wrapEl();
  if (wrap) wrap.replaceChildren();
}

async function openPanel(text, rect) {
  hideFab();
  stopSpeech();
  direction = guessDirection(text);

  const wrap = await ensureRoot();
  wrap.querySelector('.panel')?.remove();

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.dataset.source = text;
  panel.dataset.english = '';
  panel.dataset.speakText = '';
  panel.dataset.vi = '';
  panel._chunks = [];
  panel._allRows = [];
  panel.innerHTML = `
    <div class="head">
      <div class="top">
        <h2 class="brand" title="Kéo để di chuyển">Sentence IPA</h2>
        <div class="top-right">
          <button type="button" class="dir-badge" data-role="dir-badge" title="Đổi chiều dịch"></button>
          <div class="menu" data-role="menu">
            <button type="button" class="icon-btn" data-role="menu-btn" aria-label="Thêm" aria-haspopup="menu" aria-expanded="false" title="Thêm">⋯</button>
            <div class="menu-pop" data-role="menu-pop" role="menu" hidden>
              <button type="button" role="menuitem" data-dir="en-vi">Anh → Việt</button>
              <button type="button" role="menuitem" data-dir="vi-en">Việt → Anh</button>
              <div class="menu-sep" role="separator"></div>
              ${AI_PRESETS.map(
                (p) =>
                  `<button type="button" role="menuitem" data-ai="chatgpt" data-preset="${p.id}">${p.label} <span class="ext" aria-hidden="true">↗</span></button>`,
              ).join('')}
              <div class="menu-sep" role="separator"></div>
              <div class="menu-group">IPA</div>
              <button type="button" role="menuitem" data-role="toggle-link">Hiện nối âm</button>
              <div class="menu-sep" role="separator"></div>
              <div class="menu-group">Giọng đọc</div>
              <button type="button" role="menuitem" data-tts="system">Hệ thống (mặc định)</button>
              <button type="button" role="menuitem" data-tts="azure">Azure Neural</button>
              <div class="menu-azure" data-role="azure-settings" hidden>
                <input type="password" data-role="azure-key" placeholder="Speech key" autocomplete="off" spellcheck="false" />
                <input type="text" data-role="azure-region" placeholder="Region (eastus)" autocomplete="off" spellcheck="false" />
                <button type="button" data-role="azure-save">Lưu Azure</button>
                <button type="button" data-role="azure-help">Cách lấy key <span class="ext" aria-hidden="true">↗</span></button>
              </div>
              <div class="menu-sep" role="separator"></div>
              <button type="button" role="menuitem" data-role="guide">Hướng dẫn sử dụng <span class="ext" aria-hidden="true">↗</span></button>
            </div>
          </div>
          <button type="button" class="icon-btn" data-role="close" aria-label="Đóng" title="Esc">×</button>
        </div>
      </div>
    </div>
    <div class="toast" data-role="toast" hidden></div>
    <div class="body" data-role="body">
      <div class="chunks" data-role="chunks">
        <div class="chunk is-loading" aria-busy="true">
          <p class="en muted"><span class="skel lg"></span></p>
          <p class="ipa muted"><span class="skel md"></span></p>
          <p class="vi muted"><span class="skel sm"></span></p>
        </div>
      </div>
      <p class="trim-note" data-role="trim-note" hidden></p>
      <details class="details" data-role="details">
        <summary>Xem tất cả từ</summary>
        <div class="words" data-role="words"></div>
      </details>
    </div>
    <div class="word-pop" data-role="word-pop" hidden></div>
    <div class="controls-bar">
      <div class="copy-wrap" data-role="copy-wrap">
        <button type="button" class="btn" data-role="copy" title="Sao chép" aria-haspopup="menu" aria-expanded="false">Sao chép ▾</button>
        <div class="copy-pop" data-role="copy-pop" role="menu" hidden>
          <button type="button" role="menuitem" data-copy="en">Câu tiếng Anh</button>
          <button type="button" role="menuitem" data-copy="ipa">IPA</button>
          <button type="button" role="menuitem" data-copy="both">Cả hai</button>
        </div>
      </div>
      <button type="button" class="btn btn-primary" data-role="listen" title="Space" aria-label="Nghe">▶ Nghe</button>
      <div class="seg seg-soft" role="group" aria-label="Giọng">
        <button type="button" data-play-accent="us" aria-pressed="true">US</button>
        <button type="button" data-play-accent="uk" aria-pressed="false">UK</button>
      </div>
      <button type="button" class="btn" data-role="rate" title="Tốc độ">1×</button>
      <button type="button" class="btn btn-icon tip-host" data-role="loop" aria-pressed="false" aria-label="Lặp lại">
        <svg class="icon-loop" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
        <span class="tip" role="tooltip">Lặp lại (L)</span>
      </button>
    </div>
  `;

  placePanel(panel, rect);
  wrap.appendChild(panel);
  activePanel = panel;
  enableDrag(panel);
  panel.querySelector('[data-role="body"]').scrollTop = 0;
  await loadTtsSettings();
  syncDir(panel);
  syncTtsMenu(panel);

  panel.querySelector('[data-role="close"]').addEventListener('click', closeAll);
  wireCopyMenu(panel);
  wireMenu(panel);
  panel.querySelector('[data-role="dir-badge"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    direction = direction === 'en-vi' ? 'vi-en' : 'en-vi';
    syncDir(panel);
    stopSpeech();
    await loadPanel(panel);
  });
  panel.querySelector('[data-role="loop"]').addEventListener('click', (e) => {
    loopSpeech = !loopSpeech;
    e.currentTarget.setAttribute('aria-pressed', String(loopSpeech));
  });

  panel.querySelector('[data-role="rate"]').addEventListener('click', (e) => {
    const i = RATES.indexOf(speechRate);
    speechRate = RATES[(i + 1) % RATES.length];
    e.currentTarget.textContent = `${speechRate}×`;
  });

  panel.querySelectorAll('[data-play-accent]').forEach((btn) => {
    btn.addEventListener('click', () => {
      playAccent = btn.dataset.playAccent;
      panel.querySelectorAll('[data-play-accent]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      renderChunkIpa(panel);
    });
  });

  panel.querySelector('[data-role="listen"]').addEventListener('click', () => toggleListen(panel));

  document.addEventListener(
    'mousedown',
    function onDown(e) {
      if (!panel.isConnected) {
        document.removeEventListener('mousedown', onDown, true);
        return;
      }
      if (panel.dataset.dragging === '1') return;
      if (isInsidePanelUi(e, panel)) return;
      closeAll();
      document.removeEventListener('mousedown', onDown, true);
    },
    true,
  );

  await loadPanel(panel);
}

function enableDrag(panel) {
  const head = panel.querySelector('.head');
  if (!head) return;

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origL = 0;
  let origT = 0;

  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, .seg, .menu')) return;
    dragging = true;
    panel.dataset.dragging = '1';
    head.classList.add('dragging');
    head.setPointerCapture(e.pointerId);
    const box = panel.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    origL = box.left;
    origT = box.top;
    e.preventDefault();
  });

  head.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const view = viewportBox();
    const gap = 12;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    let left = origL + (e.clientX - startX);
    let top = origT + (e.clientY - startY);
    left = Math.max(view.left + gap, Math.min(left, view.left + view.width - w - gap));
    top = Math.max(view.top + gap, Math.min(top, view.top + view.height - Math.min(h, 260) - gap));
    const available = Math.max(260, view.top + view.height - gap - top);
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.maxHeight = `${Math.round(available)}px`;
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    panel.dataset.dragging = '0';
    panel.dataset.userMoved = '1';
    head.classList.remove('dragging');
    try {
      head.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);
}

function syncDir(panel) {
  const badge = panel.querySelector('[data-role="dir-badge"]');
  if (badge) badge.textContent = direction === 'vi-en' ? 'Việt → Anh' : 'Anh → Việt';
  panel.querySelectorAll('[data-dir]').forEach((btn) => {
    btn.setAttribute('aria-checked', String(btn.dataset.dir === direction));
    btn.classList.toggle('is-active', btn.dataset.dir === direction);
  });
}

function syncTtsMenu(panel) {
  const pop = panel.querySelector('[data-role="menu-pop"]') || wrapEl()?.querySelector('[data-role="menu-pop"]');
  if (!pop) return;
  pop.querySelectorAll('[data-tts]').forEach((btn) => {
    const on = btn.dataset.tts === ttsProvider;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-checked', String(on));
  });
  const linkBtn = pop.querySelector('[data-role="toggle-link"]');
  if (linkBtn) {
    linkBtn.classList.toggle('is-active', showLinking);
    linkBtn.setAttribute('aria-checked', String(showLinking));
    linkBtn.textContent = showLinking ? 'Hiện nối âm ✓' : 'Hiện nối âm';
  }
  const box = pop.querySelector('[data-role="azure-settings"]');
  if (box) {
    box.hidden = ttsProvider !== TTS_PROVIDER.azure;
    const keyEl = box.querySelector('[data-role="azure-key"]');
    const regionEl = box.querySelector('[data-role="azure-region"]');
    if (keyEl && keyEl !== pop.ownerDocument.activeElement) keyEl.value = azureKey;
    if (regionEl && regionEl !== pop.ownerDocument.activeElement) regionEl.value = azureRegion;
  }
}

function viewportBox() {
  const vv = window.visualViewport;
  return {
    top: vv?.offsetTop ?? 0,
    left: vv?.offsetLeft ?? 0,
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
  };
}

function placePanel(panel, rect) {
  if (panel.dataset.userMoved === '1') return;

  const gap = 12;
  const view = viewportBox();
  const width = Math.min(440, view.width - gap * 2);
  const minH = 240;

  // Prefer below selection; else right of selection; else clamp in viewport
  const spaceBelow = view.top + view.height - rect.bottom - gap;
  const spaceRight = view.left + view.width - rect.right - gap;

  let left;
  let top;
  let available;

  if (spaceBelow >= Math.min(minH, view.height * 0.35)) {
    top = rect.bottom + gap;
    left = view.left + Math.min(
      Math.max(rect.left, view.left + gap),
      view.left + view.width - width - gap,
    );
    available = view.top + view.height - gap - top;
  } else if (spaceRight >= width + gap) {
    left = rect.right + gap;
    top = Math.max(view.top + gap, Math.min(rect.top, view.top + view.height - minH - gap));
    available = view.top + view.height - gap - top;
  } else {
    left = view.left + view.width - width - gap;
    top = view.top + gap;
    available = view.height - gap * 2;
  }

  left = Math.max(view.left + gap, Math.min(left, view.left + view.width - width - gap));
  top = Math.max(view.top + gap, Math.min(top, view.top + view.height - gap - minH));
  available = Math.max(minH, view.top + view.height - gap - top);

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.width = `${Math.round(width)}px`;
  panel.style.maxHeight = `${Math.round(available)}px`;
}

async function loadPanel(panel) {
  await globalThis.SipaIpa.loadLexicon();
  let source = panel.dataset.source;
  const chunksHost = panel.querySelector('[data-role="chunks"]');
  const trimNote = panel.querySelector('[data-role="trim-note"]');
  const wordsHost = panel.querySelector('[data-role="words"]');
  panel._chunks = [];
  panel._allRows = [];
  panel.dataset.english = '';
  panel.dataset.speakText = '';
  panel.dataset.vi = '';
  wordsHost.replaceChildren();
  showChunksSkeleton(chunksHost, 2);
  trimNote.hidden = true;

  try {
    if (source.length > SOURCE_MAX) {
      source = source.slice(0, SOURCE_MAX);
      panel.dataset.source = source;
      trimNote.hidden = false;
      trimNote.textContent = `Đã cắt còn ${SOURCE_MAX} ký tự đầu.`;
    }

    const segs = splitSegments(source);
    showChunksSkeleton(chunksHost, Math.min(Math.max(segs.length, 1), 3));
    let pairs;
    if (direction === 'en-vi') {
      pairs = await Promise.all(
        segs.map(async (en) => {
          const response = await chrome.runtime.sendMessage({
            type: 'TRANSLATE',
            text: en,
            sl: 'en',
            tl: 'vi',
          });
          if (!response?.ok) throw new Error(response?.error || 'Translate failed');
          return { en, vi: response.translation || '' };
        }),
      );
    } else {
      pairs = await Promise.all(
        segs.map(async (vi) => {
          const response = await chrome.runtime.sendMessage({
            type: 'TRANSLATE',
            text: vi,
            sl: 'vi',
            tl: 'en',
          });
          if (!response?.ok) throw new Error(response?.error || 'Translate failed');
          return { en: response.translation || '', vi };
        }),
      );
    }

    panel.dataset.english = pairs.map((p) => p.en).filter(Boolean).join(' ');
    panel.dataset.vi = pairs.map((p) => p.vi).filter(Boolean).join(' ');
    await fillChunks(panel, pairs);
  } catch (error) {
    chunksHost.innerHTML = `<p class="error">Lỗi: ${error?.message || error}</p>
      <button type="button" class="btn" data-role="retry">Thử lại</button>`;
    chunksHost.querySelector('[data-role="retry"]')?.addEventListener('click', () => loadPanel(panel));
  } finally {
    requestAnimationFrame(() => {
      const r = selectionRect() || fallbackRect();
      placePanel(panel, r);
    });
  }
}

async function buildRows(text) {
  const {
    tokenizeWordsWithBreaks,
    expandSentence,
    ipaForToken,
    pronunciationForms,
    accentsDiffer,
  } = globalThis.SipaIpa;
  const { linkSentence } = globalThis.SipaLink;
  const phonemize = await getPhonemize();
  const speak = expandSentence(text);
  const metas = tokenizeWordsWithBreaks(text);
  const rows = await Promise.all(
    metas.map(async (meta, index) => {
      const token = meta.text;
      const prev = index > 0 ? metas[index - 1].text : '';
      const [usRow, ukRow] = await Promise.all([
        ipaForToken(token, phonemize, IPA_US, 'us', prev),
        ipaForToken(token, phonemize, IPA_UK, 'uk', prev),
      ]);
      const usForms = pronunciationForms(token, 'us', usRow.ipa);
      const ukForms = pronunciationForms(token, 'uk', ukRow.ipa);
      return {
        word: token,
        speak: usRow.speak,
        breakAfter: meta.breakAfter,
        usCite: usRow.ipa,
        ukCite: ukRow.ipa,
        us: usForms.primary,
        uk: ukForms.primary,
        usLinked: usForms.primary,
        ukLinked: ukForms.primary,
        usLink: null,
        ukLink: null,
        usForms: usForms.forms,
        ukForms: ukForms.forms,
        differs: accentsDiffer(usForms.primary, ukForms.primary),
      };
    }),
  );

  // Sentence line = word IPA + boundary rules (same source as chips)
  const usOut = linkSentence(
    rows.map((r) => ({ text: r.word, ipa: r.usCite, breakAfter: r.breakAfter })),
    { accent: 'us' },
  );
  const ukOut = linkSentence(
    rows.map((r) => ({ text: r.word, ipa: r.ukCite, breakAfter: r.breakAfter })),
    { accent: 'uk' },
  );
  rows.forEach((r, i) => {
    r.usLinked = usOut[i].ipa;
    r.ukLinked = ukOut[i].ipa;
    r.usLink = usOut[i].link;
    r.ukLink = ukOut[i].link;
    // chips / table follow linked forms so line and chip stay aligned
    r.us = usOut[i].ipa;
    r.uk = ukOut[i].ipa;
    r.differs = accentsDiffer(r.usCite, r.ukCite);
  });
  return { speak, rows };
}

function showChunksSkeleton(host, count = 2) {
  const n = Math.min(Math.max(count, 1), 3);
  host.innerHTML = Array.from({ length: n }, () => `
    <div class="chunk is-loading" aria-busy="true">
      <p class="en muted"><span class="skel lg"></span></p>
      <p class="ipa muted"><span class="skel md"></span></p>
      <p class="vi muted"><span class="skel sm"></span></p>
    </div>`).join('');
}

async function fillChunks(panel, pairs) {
  const { expandSentence } = globalThis.SipaIpa;
  const host = panel.querySelector('[data-role="chunks"]');
  // keep skeleton visible while IPA builds (after translate)
  showChunksSkeleton(host, Math.min(Math.max(pairs.length, 1), 3));
  panel._chunks = [];
  panel._allRows = [];

  const built = await Promise.all(pairs.map((p) => buildRows(p.en || '')));
  panel.dataset.speakText = expandSentence(panel.dataset.english || '');

  host.replaceChildren();
  const multi = pairs.length > 1;
  pairs.forEach((pair, i) => {
    const { speak, rows } = built[i];
    panel._allRows.push(...rows);
    const chunk = document.createElement('article');
    chunk.className = multi ? 'chunk has-play' : 'chunk';
    chunk.dataset.index = String(i);

    if (multi) {
      const playCol = document.createElement('div');
      playCol.className = 'chunk-play-col';
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'btn-chunk-play';
      play.setAttribute('aria-label', `Nghe đoạn ${i + 1}`);
      play.textContent = '▶';
      play.addEventListener('click', (e) => {
        e.stopPropagation();
        playText(speak || pair.en, panel, playAccent, true, null, chunk);
      });
      playCol.appendChild(play);
      chunk.appendChild(playCol);
    }

    const body = document.createElement('div');
    body.className = 'chunk-body';

    const en = document.createElement('p');
    en.className = 'en';
    en.textContent = pair.en || '—';
    body.appendChild(en);

    const ipa = document.createElement('p');
    ipa.className = 'ipa';
    ipa.dataset.role = 'chunk-ipa';
    body.appendChild(ipa);

    const vi = document.createElement('p');
    vi.className = 'vi';
    vi.textContent = pair.vi || '';
    body.appendChild(vi);

    chunk.appendChild(body);
    host.appendChild(chunk);
    panel._chunks.push({ el: chunk, ipaEl: ipa, rows, speak: speak || pair.en, en: pair.en, vi: pair.vi });
  });

  renderChunkIpa(panel);
  syncListenLabel(panel);
  const wordsHost = panel.querySelector('[data-role="words"]');
  wordsHost.replaceChildren();
  wordsHost.appendChild(renderWordsTable(dedupeRows(panel._allRows), panel));
}

function syncListenLabel(panel) {
  const listen = panel.querySelector('[data-role="listen"]');
  if (!listen || listen.getAttribute('aria-pressed') === 'true') return;
  const multi = (panel._chunks || []).length > 1;
  listen.textContent = multi ? '▶ Nghe tất cả' : '▶ Nghe';
  listen.setAttribute('aria-label', multi ? 'Nghe tất cả' : 'Nghe');
}

function dedupeRows(rows) {
  const seen = new Set();
  const content = [];
  const func = [];
  for (const row of rows) {
    const key = row.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    (FUNC_WORDS.has(key) ? func : content).push(row);
  }
  return [...content, ...func];
}

function renderChunkIpa(panel) {
  closeWordPop(panel);
  for (const chunk of panel._chunks || []) {
    renderAlignedIpa(chunk.ipaEl, chunk.rows, playAccent, panel, chunk.el);
  }
}

function formTip(forms, word, differs, otherIpa, otherLabel) {
  if (differs && otherIpa) return `${otherLabel}: /${otherIpa}/`;
  const weak = forms?.find((f) => f.label === 'weak');
  const strong = forms?.find((f) => f.label === 'strong');
  const parts = [];
  if (weak) parts.push(`weak /${weak.ipa}/`);
  if (strong) parts.push(`strong /${strong.ipa}/`);
  return parts.length ? `${word}: ${parts.join(' · ')}` : word;
}

function formatFormsCell(forms, primary) {
  const weak = forms?.find((f) => f.label === 'weak');
  const strong = forms?.find((f) => f.label === 'strong');
  if (weak && strong) return { main: `/${weak.ipa}/`, sub: `strong /${strong.ipa}/` };
  if (primary) return { main: `/${primary}/`, sub: '' };
  return { main: '—', sub: '' };
}

function renderWordsTable(rows, panel) {
  const table = document.createElement('div');
  table.className = 'words';
  table.setAttribute('role', 'table');

  const head = document.createElement('div');
  head.className = 'words-row words-head';
  head.setAttribute('role', 'row');
  for (const label of ['Từ', 'US', 'UK']) {
    const cell = document.createElement('div');
    cell.className = 'words-cell';
    cell.setAttribute('role', 'columnheader');
    cell.textContent = label;
    head.appendChild(cell);
  }
  table.appendChild(head);

  rows.forEach((row) => {
    const r = document.createElement('div');
    r.className = 'words-row word';
    r.setAttribute('role', 'row');
    r.dataset.speak = row.speak;

    const w = document.createElement('div');
    w.className = 'words-cell word-en';
    w.setAttribute('role', 'cell');
    w.textContent = row.word;
    r.appendChild(w);

    r.appendChild(renderWordIpaCell(row, 'us', panel, r));
    r.appendChild(renderWordIpaCell(row, 'uk', panel, r));
    table.appendChild(r);
  });
  return table;
}

function renderWordIpaCell(row, accentKey, panel, card) {
  const forms = accentKey === 'uk' ? row.ukForms : row.usForms;
  const primary = accentKey === 'uk' ? row.uk : row.us;
  const { main, sub } = formatFormsCell(forms, primary);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'words-cell word-ipa';
  btn.dataset.accent = accentKey;
  btn.setAttribute('role', 'cell');
  btn.title = formTip(forms, row.word, row.differs);

  const mainEl = document.createElement('span');
  mainEl.className = 'word-ipa-main';
  mainEl.textContent = main;
  btn.appendChild(mainEl);
  if (sub) {
    const subEl = document.createElement('span');
    subEl.className = 'word-ipa-sub';
    subEl.textContent = sub;
    btn.appendChild(subEl);
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!row.speak) return;
    playText(row.speak, panel, accentKey, false, card);
  });
  return btn;
}

function linkTooltip(row, next, link) {
  if (!next || !link) return '';
  const typeHint =
    link.type === 'r'
      ? 'linking r'
      : link.type === 'glide'
        ? 'glide'
        : link.type === 'palatal'
          ? 'palatal'
          : 'nối âm';
  return `${row.word} ${next.word} → đọc liền (${typeHint})`;
}

function appendIpaWord(host, ipa, row, forms, accentKey, panel, chunkEl) {
  const { splitInserted } = globalThis.SipaLink;
  const otherIpa = accentKey === 'uk' ? row.usCite || row.us : row.ukCite || row.uk;
  const otherLabel = accentKey === 'uk' ? 'US' : 'UK';
  const plainForms = forms || [];
  const cite = accentKey === 'uk' ? row.ukCite : row.usCite;
  const weakForm = plainForms.find((f) => f.label === 'weak');
  const baseIpa = splitInserted(ipa).base || ipa;
  const isWeak = Boolean(weakForm && baseIpa === weakForm.ipa);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `ipa-word${row.differs ? ' diff' : ''}${isWeak ? ' is-weak' : ''}`;
  btn.dataset.word = row.word;
  btn.title = formTip(plainForms, row.word, row.differs, otherIpa, otherLabel);

  if (showLinking) {
    const { insert, base } = splitInserted(ipa);
    if (insert) {
      const ins = document.createElement('span');
      ins.className = 'ipa-insert';
      ins.textContent = insert;
      btn.appendChild(ins);
    }
    btn.appendChild(document.createTextNode(base || ipa));
  } else {
    // Without linking marks: dictionary / weak primary (no glide / linking-r inserts)
    const plain = weakForm?.ipa || cite || ipa;
    btn.textContent = plain;
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openWordPop(panel, row, btn, chunkEl);
  });
  host.appendChild(btn);
}

function linkChains(rows, accentKey) {
  const items = rows.map((row, i) => {
    const link = accentKey === 'uk' ? row.ukLink : row.usLink;
    const linked = accentKey === 'uk' ? row.ukLinked || row.uk : row.usLinked || row.us;
    return { row, i, link: showLinking ? link : null, linked };
  });
  const chains = [];
  let cur = [];
  items.forEach((item) => {
    cur.push(item);
    if (!item.link) {
      chains.push(cur);
      cur = [];
    }
  });
  if (cur.length) chains.push(cur);
  return chains;
}

function renderAlignedIpa(host, rows, accentKey, panel, chunkEl) {
  host.className = 'ipa';
  host.replaceChildren();
  const chains = linkChains(rows, accentKey);

  chains.forEach((chain, ci) => {
    const wrap = document.createElement('span');
    wrap.className = chain.length > 1 && showLinking ? 'lk' : 'lk lk-one';

    chain.forEach((item, j) => {
      const forms = accentKey === 'uk' ? item.row.ukForms : item.row.usForms;
      if (!item.linked && !(item.row.ukCite || item.row.usCite)) return;
      appendIpaWord(wrap, item.linked || item.row.usCite, item.row, forms, accentKey, panel, chunkEl);
      if (j < chain.length - 1 && item.link?.glyph) {
        const sep = document.createElement('span');
        sep.className = 'ipa-link';
        sep.textContent = item.link.glyph;
        sep.title = linkTooltip(item.row, chain[j + 1]?.row, item.link);
        wrap.appendChild(sep);
      }
    });

    host.appendChild(wrap);
    if (ci < chains.length - 1) {
      const gap = document.createElement('span');
      gap.className = 'ipa-gap';
      gap.setAttribute('aria-hidden', 'true');
      host.appendChild(gap);
    }
  });
}

function closeWordPop(panel) {
  const pop = panel?.querySelector?.('[data-role="word-pop"]') || wrapEl()?.querySelector?.('[data-role="word-pop"]');
  if (!pop) return;
  pop.hidden = true;
  pop.replaceChildren();
  pop.classList.remove('word-pop-fixed');
  pop.style.top = '';
  pop.style.left = '';
  // park back on panel for next open
  if (panel && pop.parentElement !== panel) panel.appendChild(pop);
}

function placeWordPop(anchor, pop) {
  const wrap = wrapEl();
  if (wrap && pop.parentElement !== wrap) wrap.appendChild(pop);
  pop.classList.add('word-pop-fixed');
  pop.hidden = false;
  pop.style.top = '0px';
  pop.style.left = '0px';

  const gap = 6;
  const pad = 8;
  const a = anchor.getBoundingClientRect();
  const popW = pop.offsetWidth;
  const popH = pop.offsetHeight;
  let top = a.bottom + gap;
  let left = a.left;
  if (top + popH > window.innerHeight - pad) top = a.top - popH - gap;
  if (left + popW > window.innerWidth - pad) left = window.innerWidth - popW - pad;
  top = Math.max(pad, Math.min(top, window.innerHeight - popH - pad));
  left = Math.max(pad, Math.min(left, window.innerWidth - popW - pad));
  pop.style.top = `${Math.round(top)}px`;
  pop.style.left = `${Math.round(left)}px`;
}

function openWordPop(panel, row, anchor, chunkEl) {
  const pop = panel.querySelector('[data-role="word-pop"]') || wrapEl()?.querySelector('[data-role="word-pop"]');
  closeWordPop(panel);
  if (!pop) return;
  if (pop.parentElement !== panel) panel.appendChild(pop);

  const title = document.createElement('div');
  title.className = 'word-pop-en';
  title.textContent = row.word;
  pop.appendChild(title);

  for (const accent of ['us', 'uk']) {
    // Popover shows citation IPA (no glide / linking-r inserts)
    const ipa = accent === 'uk' ? row.ukCite || row.uk : row.usCite || row.us;
    const forms = accent === 'uk' ? row.ukForms : row.usForms;
    const weak = forms?.find((f) => f.label === 'weak');
    const strong = forms?.find((f) => f.label === 'strong');
    const block = document.createElement('div');
    block.className = 'word-pop-accent';

    const head = document.createElement('div');
    head.className = 'word-pop-line';
    const lab = document.createElement('span');
    lab.className = 'word-pop-lab';
    lab.textContent = accent.toUpperCase();
    head.appendChild(lab);
    block.appendChild(head);

    const appendForm = (tag, value, withPlay) => {
      const line = document.createElement('div');
      line.className = 'word-pop-form';
      if (tag) {
        const t = document.createElement('span');
        t.className = 'word-pop-tag';
        t.textContent = tag;
        line.appendChild(t);
      }
      const v = document.createElement('span');
      v.className = 'word-pop-val';
      v.textContent = value;
      line.appendChild(v);
      if (withPlay) {
        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'btn-chunk-play';
        play.setAttribute('aria-label', `Nghe ${accent.toUpperCase()}`);
        play.title = 'Nghe từ';
        play.textContent = '▶';
        play.addEventListener('click', (e) => {
          e.stopPropagation();
          playText(row.speak || row.word, panel, accent, false, null, chunkEl);
        });
        line.appendChild(play);
      }
      block.appendChild(line);
    };
    if (weak || strong) {
      if (weak) appendForm('weak', `/${weak.ipa}/`, false);
      if (strong) appendForm('strong', `/${strong.ipa}/`, true);
    } else {
      appendForm('', ipa ? `/${ipa}/` : '—', true);
    }
    pop.appendChild(block);
  }

  placeWordPop(anchor, pop);

  document.addEventListener(
    'mousedown',
    function onPopOut(e) {
      if (!panel.isConnected) {
        document.removeEventListener('mousedown', onPopOut, true);
        return;
      }
      const path = e.composedPath?.() || [];
      if (path.includes(pop) || path.includes(anchor)) return;
      closeWordPop(panel);
      document.removeEventListener('mousedown', onPopOut, true);
    },
    true,
  );
}

function panelIpaText(panel) {
  return (panel._chunks || [])
    .map((c) =>
      (c.rows || [])
        .map((r) => (playAccent === 'uk' ? r.uk : r.us))
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean)
    .join('\n');
}

function copyPayload(panel, kind) {
  const en = panel.dataset.english || '';
  const ipa = panelIpaText(panel);
  if (kind === 'ipa') return ipa;
  if (kind === 'both') return [en, ipa].filter(Boolean).join('\n');
  return en;
}

function wireCopyMenu(panel) {
  const wrap = panel.querySelector('[data-role="copy-wrap"]');
  const btn = panel.querySelector('[data-role="copy"]');
  const pop = panel.querySelector('[data-role="copy-pop"]');
  if (!wrap || !btn || !pop) return;

  const closeCopy = () => {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });

  pop.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-copy]');
    if (!item) return;
    e.stopPropagation();
    closeCopy();
    const text = copyPayload(panel, item.dataset.copy);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const prev = btn.textContent;
      btn.textContent = 'Đã sao chép';
      setTimeout(() => {
        btn.textContent = prev;
      }, 1200);
    } catch {
      // ignore
    }
  });

  document.addEventListener(
    'mousedown',
    function onCopyOut(e) {
      if (!panel.isConnected) {
        document.removeEventListener('mousedown', onCopyOut, true);
        return;
      }
      const path = e.composedPath?.() || [];
      if (path.includes(wrap)) return;
      closeCopy();
    },
    true,
  );
}

function placeMenuPop(btn, pop) {
  const wrap = wrapEl();
  if (wrap && pop.parentElement !== wrap) wrap.appendChild(pop);
  pop.classList.add('menu-pop-fixed');
  pop.hidden = false;
  pop.style.top = '0px';
  pop.style.left = '0px';

  const gap = 6;
  const pad = 8;
  const a = btn.getBoundingClientRect();
  const popW = pop.offsetWidth;
  const popH = pop.offsetHeight;
  let top = a.bottom + gap;
  let left = a.right - popW;
  if (top + popH > window.innerHeight - pad) {
    top = a.top - popH - gap;
  }
  top = Math.max(pad, Math.min(top, window.innerHeight - popH - pad));
  left = Math.max(pad, Math.min(left, window.innerWidth - popW - pad));
  pop.style.top = `${Math.round(top)}px`;
  pop.style.left = `${Math.round(left)}px`;
}

function wireMenu(panel) {
  const menu = panel.querySelector('[data-role="menu"]');
  const btn = panel.querySelector('[data-role="menu-btn"]');
  const pop = panel.querySelector('[data-role="menu-pop"]');

  const closeMenu = () => {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    pop.classList.remove('menu-pop-fixed');
    pop.style.top = '';
    pop.style.left = '';
    if (menu && pop.parentElement !== menu) menu.appendChild(pop);
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!pop.hidden) {
      closeMenu();
      return;
    }
    syncTtsMenu(panel);
    btn.setAttribute('aria-expanded', 'true');
    placeMenuPop(btn, pop);
  });

  pop.addEventListener('mousedown', (e) => {
    if (e.target.closest('[data-role="azure-settings"]')) e.stopPropagation();
  });

  pop.addEventListener('click', async (e) => {
    if (e.target.closest('[data-role="toggle-link"]')) {
      e.stopPropagation();
      await saveTtsSettings({ showLinking: !showLinking });
      syncTtsMenu(panel);
      renderChunkIpa(panel);
      showToast(panel, showLinking ? 'Hiện nối âm' : 'Ẩn nối âm');
      return;
    }
    const ttsBtn = e.target.closest('[data-tts]');
    if (ttsBtn) {
      e.stopPropagation();
      await saveTtsSettings({ ttsProvider: ttsBtn.dataset.tts });
      syncTtsMenu(panel);
      if (ttsBtn.dataset.tts === TTS_PROVIDER.azure && !azureKey) {
        showToast(panel, 'Dán Azure Speech key rồi Lưu');
        placeMenuPop(btn, pop);
        return;
      }
      showToast(
        panel,
        ttsProvider === TTS_PROVIDER.azure ? 'Giọng: Azure Neural' : 'Giọng: hệ thống',
      );
      return;
    }
    if (e.target.closest('[data-role="azure-save"]')) {
      e.stopPropagation();
      const key = pop.querySelector('[data-role="azure-key"]')?.value?.trim() || '';
      const region = pop.querySelector('[data-role="azure-region"]')?.value?.trim() || 'eastus';
      await saveTtsSettings({ azureKey: key, azureRegion: region, ttsProvider: TTS_PROVIDER.azure });
      azureAudioCache.clear();
      syncTtsMenu(panel);
      showToast(panel, key ? 'Đã lưu Azure key' : 'Chưa có key');
      return;
    }
    if (e.target.closest('[data-role="azure-help"]')) {
      e.stopPropagation();
      closeMenu();
      openExternal(`${chrome.runtime.getURL('guide.html')}#azure-key`);
      return;
    }
    if (e.target.closest('[data-role="azure-settings"]')) return;

    const dirBtn = e.target.closest('[data-dir]');
    if (dirBtn) {
      closeMenu();
      direction = dirBtn.dataset.dir;
      syncDir(panel);
      stopSpeech();
      await loadPanel(panel);
      return;
    }
    const item = e.target.closest('[data-ai], [data-role="guide"]');
    if (!item) return;
    closeMenu();
    if (item.dataset.role === 'guide') {
      openExternal(chrome.runtime.getURL('guide.html'));
      return;
    }
    await askAI(panel, item.dataset.ai, item.dataset.preset);
  });

  document.addEventListener(
    'mousedown',
    function onMenuOut(e) {
      if (!panel.isConnected) {
        document.removeEventListener('mousedown', onMenuOut, true);
        return;
      }
      const path = e.composedPath?.() || [];
      if (path.includes(menu) || path.includes(pop) || path.includes(btn)) return;
      closeMenu();
    },
    true,
  );
}

function isSpeechPlaying() {
  if (speechSynthesis?.speaking) return true;
  return Boolean(currentAudio && !currentAudio.paused);
}

function toggleListen(panel) {
  const listen = panel.querySelector('[data-role="listen"]');
  if (isSpeechPlaying() && listen?.getAttribute('aria-pressed') === 'true') {
    stopSpeech();
    resetPlayButtons(panel);
    return;
  }
  const speak = panel.dataset.speakText || panel.dataset.english;
  if (!speak) return;
  playText(speak, panel, playAccent, true);
}

async function askAI(panel, service, presetId) {
  const sentence = panel.dataset.english || panel.dataset.speakText || '';
  if (!sentence) return;
  const preset = AI_PRESETS.find((p) => p.id === presetId);
  if (!preset) return;

  // shortcut: clip at AI_PROMPT_MAX so long URLs don't break; bump if a provider raises limits
  const prompt = preset.build(sentence).slice(0, AI_PROMPT_MAX);
  let copied = false;
  try {
    await navigator.clipboard.writeText(prompt);
    copied = true;
  } catch {
    // clipboard may be blocked; still open with ?q= when possible
  }

  let url = AI_URL[service];
  if (service === 'chatgpt') {
    url = `${AI_URL.chatgpt}?q=${encodeURIComponent(prompt)}`;
  }
  openExternal(url);
  showToast(
    panel,
    copied ? 'Đã copy prompt — dán vào ô chat nếu cần' : 'Đã mở AI — paste có thể bị chặn',
  );
}

function openExternal(url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.click();
}

function showToast(panel, message) {
  const toast = panel.querySelector('[data-role="toast"]');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.hidden = true;
  }, 2200);
}

function resetPlayButtons(panel) {
  const listen = panel.querySelector('[data-role="listen"]');
  if (listen) {
    listen.setAttribute('aria-pressed', 'false');
    syncListenLabel(panel);
  }
  clearHighlight(panel);
}

function clearHighlight(panel) {
  panel.querySelectorAll('.word.active, .ipa-word.active, .chunk.playing').forEach((el) => {
    el.classList.remove('active', 'playing');
  });
  clearHighlightTimers();
}

function clearHighlightTimers() {
  if (highlightFallbackTimer) {
    clearTimeout(highlightFallbackTimer);
    highlightFallbackTimer = null;
  }
  if (!highlightTimer) return;
  if (Array.isArray(highlightTimer)) {
    highlightTimer.forEach((id) => clearTimeout(id));
  } else {
    clearInterval(highlightTimer);
  }
  highlightTimer = null;
}

function rowsForPlay(panel, chunkEl) {
  if (chunkEl) {
    const c = (panel._chunks || []).find((x) => x.el === chunkEl);
    return c?.rows || [];
  }
  return (panel._chunks || []).flatMap((c) => c.rows || []);
}

function chipSpeakParts(row) {
  const s = String(row.speak || row.word || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!s) return [row.word || ''].filter(Boolean);
  return s.split(' ').filter(Boolean);
}

function rowHasChip(row) {
  return Boolean(row?.usLinked || row?.us || row?.usCite || row?.ukLinked || row?.uk || row?.ukCite);
}

/**
 * One speak string + char ranges → chip index (row index in `rows`).
 * TTS onboundary.charIndex lands inside a range → that chip stays lit even if the
 * engine splits/merges syllables inside the same spoken word.
 */
function buildSpeakPlan(rows) {
  const pieces = [];
  let text = '';
  let lastSpeak = '';
  rows.forEach((row, chipIdx) => {
    let words = chipSpeakParts(row);
    if (!words.length) return;
    const joined = words.join(' ');
    if (/dollars$/i.test(lastSpeak) && /dollars$/i.test(joined)) return;
    for (const w of words) {
      if (text) text += ' ';
      const start = text.length;
      text += w;
      pieces.push({ start, end: text.length, chipIdx });
    }
    lastSpeak = joined;
  });
  return { text, pieces };
}

function chipAtChar(pieces, charIndex) {
  if (!pieces.length) return 0;
  const i = Math.max(0, charIndex);
  let lo = 0;
  let hi = pieces.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pieces[mid].start <= i) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return pieces[ans].chipIdx;
}

function playText(text, panel, accentKey, highlightWords, activeEl, chunkEl) {
  const rows = highlightWords ? rowsForPlay(panel, chunkEl) : [];
  const plan = highlightWords && rows.length ? buildSpeakPlan(rows) : null;
  const speak = plan?.text || text;
  if (ttsProvider === TTS_PROVIDER.azure) {
    playAzureText(speak, panel, accentKey, highlightWords, activeEl, chunkEl, rows, plan);
    return;
  }
  playSystemText(speak, panel, accentKey, highlightWords, activeEl, chunkEl, rows, plan);
}

function markListenPlaying(panel, chunkEl) {
  const listen = panel.querySelector('[data-role="listen"]');
  if (chunkEl) {
    panel.querySelectorAll('.chunk').forEach((c) => c.classList.remove('playing'));
    chunkEl.classList.add('playing');
  }
  if (listen) {
    listen.setAttribute('aria-pressed', 'true');
    listen.innerHTML = '■ Dừng';
  }
}

function playSystemText(text, panel, accentKey, highlightWords, activeEl, chunkEl, rows = [], plan = null) {
  if (!window.speechSynthesis) return;

  stopSpeech();
  resetPlayButtons(panel);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = TTS[accentKey].lang;
  utterance.rate = speechRate;
  const voice = pickVoice(accentKey);
  if (voice) utterance.voice = voice;

  const finish = () => {
    if (loopSpeech && !activeEl) {
      playText(text, panel, accentKey, highlightWords, null, chunkEl);
      return;
    }
    resetPlayButtons(panel);
    currentUtterance = null;
  };

  utterance.onend = finish;
  utterance.onerror = () => {
    resetPlayButtons(panel);
    currentUtterance = null;
  };

  markListenPlaying(panel, chunkEl);
  if (highlightWords) setupWordHighlight(panel, utterance, chunkEl, rows, plan);

  currentUtterance = utterance;
  speechSynthesis.speak(utterance);
}

async function playAzureText(text, panel, accentKey, highlightWords, activeEl, chunkEl, rows = [], plan = null) {
  if (!azureKey) {
    showToast(panel, 'Chọn Azure trong ⋯ và nhập Speech key');
    return;
  }

  stopSpeech();
  resetPlayButtons(panel);
  markListenPlaying(panel, chunkEl);

  const cacheKey = `${azureRegion}|${accentKey}|${speechRate}|${text}`;
  try {
    let base64 = azureAudioCache.get(cacheKey);
    if (!base64) {
      const res = await chrome.runtime.sendMessage({
        type: 'AZURE_TTS',
        text,
        accent: accentKey,
        rate: speechRate,
      });
      if (!res?.ok) throw new Error(res?.error || 'Azure TTS failed');
      base64 = res.base64;
      azureAudioCache.set(cacheKey, base64);
    }

    const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
    currentAudio = audio;
    if (highlightWords) {
      const startHighlight = () => {
        const durationMs = Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration * 1000
          : null;
        setupWordHighlight(panel, null, chunkEl, rows, plan, durationMs);
      };
      if (audio.readyState >= 1) startHighlight();
      else audio.addEventListener('loadedmetadata', startHighlight, { once: true });
    }

    audio.onended = () => {
      if (currentAudio !== audio) return;
      currentAudio = null;
      if (loopSpeech && !activeEl) {
        playText(text, panel, accentKey, highlightWords, null, chunkEl);
        return;
      }
      resetPlayButtons(panel);
    };
    audio.onerror = () => {
      if (currentAudio === audio) currentAudio = null;
      resetPlayButtons(panel);
      showToast(panel, 'Không phát được audio Azure');
    };
    await audio.play();
  } catch (err) {
    resetPlayButtons(panel);
    showToast(panel, String(err?.message || err).slice(0, 80));
  }
}

function setupWordHighlight(panel, utterance, chunkEl, rows = [], plan = null, durationMs = null) {
  clearHighlightTimers();

  const rowList = rows.length ? rows : rowsForPlay(panel, chunkEl);
  const tokens = chunkEl
    ? [...chunkEl.querySelectorAll('.ipa-word')]
    : (panel._chunks || []).flatMap((c) => [...c.ipaEl.querySelectorAll('.ipa-word')]);

  if (!tokens.length || !rowList.length) return;

  const speakPlan = plan?.pieces?.length ? plan : buildSpeakPlan(rowList);
  // DOM chips follow only rows that rendered IPA — map row index → token
  const chipRows = rowList.map((row, i) => i).filter((i) => rowHasChip(rowList[i]));
  const tokenByRow = new Map();
  chipRows.forEach((rowIdx, j) => {
    if (tokens[j]) tokenByRow.set(rowIdx, tokens[j]);
  });

  const weights = rowList.map((_, chipIdx) =>
    Math.max(1, speakPlan.pieces.filter((p) => p.chipIdx === chipIdx).length),
  );
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const totalMs =
    durationMs && durationMs > 0
      ? durationMs
      : Math.max(900, (totalWeight / Math.max(speechRate, 0.5)) * 380);
  const holds = weights.map((w) => (w / totalWeight) * totalMs);

  const activate = (chipIdx) => {
    const el = tokenByRow.get(chipIdx) || tokens[Math.min(chipIdx, tokens.length - 1)];
    tokens.forEach((t) => t.classList.toggle('active', t === el));
    if (!chunkEl) {
      panel.querySelectorAll('.chunk.playing').forEach((c) => c.classList.remove('playing'));
      el?.closest('.chunk')?.classList.add('playing');
    }
  };

  let usedBoundary = false;
  if (utterance) {
    utterance.onboundary = (event) => {
      // Some engines omit name; only skip explicit non-word boundaries
      if (event.name && event.name !== 'word') return;
      usedBoundary = true;
      clearHighlightTimers();
      activate(chipAtChar(speakPlan.pieces, event.charIndex));
    };
  }

  const armFallback = () => {
    if (usedBoundary || highlightTimer) return;
    const timerIds = [];
    highlightTimer = timerIds;
    const order = chipRows.length ? chipRows : tokens.map((_, i) => i);
    activate(order[0] ?? 0);
    let t = 0;
    for (let i = 1; i < order.length; i++) {
      t += holds[order[i - 1]] || totalMs / order.length;
      const chip = order[i];
      timerIds.push(
        setTimeout(() => {
          if (usedBoundary) return;
          activate(chip);
        }, t),
      );
    }
  };

  // Local voices usually emit boundaries; cloud voices often need timed fallback
  if (utterance) {
    highlightFallbackTimer = setTimeout(armFallback, 450);
  } else {
    armFallback();
  }
}

function listSpeechVoices() {
  if (!window.speechSynthesis) return [];
  const voices = speechSynthesis.getVoices();
  if (voices.length) return voices;
  // Chrome often returns [] until voiceschanged
  speechSynthesis.addEventListener('voiceschanged', () => speechSynthesis.getVoices(), { once: true });
  return speechSynthesis.getVoices();
}

function pickVoice(accentKey) {
  const cfg = TTS[accentKey] || TTS.us;
  const lang = cfg.lang;
  const all = listSpeechVoices();
  const voices = all.filter(
    (v) => v.lang === lang || v.lang?.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()),
  );
  if (!voices.length) return null;

  for (const re of cfg.prefer || []) {
    const hit = voices.find((v) => re.test(v.name));
    if (hit) return hit;
  }

  // Prefer matching region first, then reasonable female/neural fallbacks
  const score = (v) => {
    let s = 0;
    if (v.lang === lang) s += 8;
    if (accentKey === 'uk' && /en-GB/i.test(v.lang)) s += 4;
    if (accentKey === 'us' && /en-US/i.test(v.lang)) s += 4;
    if (/female|samantha|karen|moira|zira|susan|serena/i.test(v.name)) s += 3;
    if (/natural|premium|enhanced|neural|siri/i.test(v.name)) s += 2;
    if (v.localService) s += 1;
    if (/google|microsoft/i.test(v.name)) s += 1;
    return s;
  };
  return [...voices].sort((a, b) => score(b) - score(a))[0];
}

if (typeof speechSynthesis !== 'undefined') {
  listSpeechVoices();
  speechSynthesis.addEventListener?.('voiceschanged', listSpeechVoices);
}

function stopSpeech() {
  if (activePanel) clearHighlight(activePanel);
  if (window.speechSynthesis) speechSynthesis.cancel();
  currentUtterance = null;
  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
}
