import { copyTextInPage, downloadTextFile } from '@repo/extension-utils';
import { CLIPKIT_UI, type ClipkitDoneMessage } from '../utils/messages';

const HOST_ID = 'clipkit-bubble-host';
const TOAST_MS = 3200;

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; font-family: "IBM Plex Sans", "Segoe UI", sans-serif; }

.bubble, .toast {
  position: fixed;
  z-index: 2147483646;
  color: #1c1917;
  background: #fffefb;
  border: 1px solid #e7e5e4;
  box-shadow: 0 12px 40px rgba(28, 25, 23, 0.16);
}

.bubble {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  transform: translateX(-50%);
  animation: clipkit-in 120ms ease-out;
}

.toast {
  right: 16px;
  bottom: 16px;
  width: min(340px, calc(100vw - 24px));
  border-radius: 14px;
  padding: 12px 14px;
  animation: clipkit-toast-in 160ms ease-out;
}

.toast.error { border-color: #fecaca; }
.toast.hiding { animation: clipkit-toast-out 180ms ease-in forwards; }

@keyframes clipkit-in {
  from { opacity: 0; transform: translateX(-50%) translateY(4px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
@keyframes clipkit-toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes clipkit-toast-out {
  to { opacity: 0; transform: translateY(6px); }
}

button {
  appearance: none;
  border: 0;
  background: transparent;
  color: #1c1917;
  border-radius: 999px;
  padding: 7px 11px;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
button:hover { background: #f5f5f4; }
button.primary { background: #0f766e; color: #f0fdfa; }
button.primary:hover { filter: brightness(1.05); }
button:disabled { opacity: 0.55; cursor: default; }

.toast-title {
  margin: 0;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.02em;
}
.toast-msg {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.35;
  color: #44403c;
}
.toast-preview {
  margin: 8px 0 0;
  max-height: 72px;
  overflow: hidden;
  white-space: pre-wrap;
  font-family: "IBM Plex Mono", Menlo, monospace;
  font-size: 11px;
  line-height: 1.4;
  color: #78716c;
}
.toast-actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
`;

type BubbleAction = 'summarize' | 'actions' | 'markdown';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    const ui = createUi();

    document.addEventListener('mouseup', () => {
      window.setTimeout(() => syncBubble(ui), 10);
    });

    document.addEventListener(
      'mousedown',
      (event) => {
        const path = event.composedPath();
        if (path.includes(ui.host)) {
          return;
        }
        ui.hideBubble();
        ui.hideToast();
      },
      true,
    );

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        ui.hideAll();
      }
    });

    chrome.runtime.onMessage.addListener((message: ClipkitDoneMessage | { type?: string }) => {
      if (message?.type === CLIPKIT_UI.Done) {
        ui.complete(message as ClipkitDoneMessage);
        return;
      }
      // Legacy show-card → treat as done toast
      if (message?.type === CLIPKIT_UI.ShowCard && 'text' in message && message.text) {
        ui.complete({
          type: CLIPKIT_UI.Done,
          title: (message as { title?: string }).title || 'ClipKit',
          text: message.text as string,
          toast: 'Copied — paste into Notion/Obsidian',
          preview: (message.text as string).slice(0, 180),
        });
      }
    });
  },
});

function createUi() {
  let host = document.getElementById(HOST_ID) as HTMLDivElement | null;
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    document.documentElement.appendChild(host);
  }

  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${STYLES}</style><div class="bubble" hidden></div><div class="toast" hidden></div>`;

  const bubble = shadow.querySelector<HTMLDivElement>('.bubble')!;
  const toast = shadow.querySelector<HTMLDivElement>('.toast')!;
  let hideTimer = 0;
  let lastText = '';

  bubble.innerHTML = `
    <button type="button" data-action="summarize" class="primary">Summarize</button>
    <button type="button" data-action="actions">Actions</button>
    <button type="button" data-action="markdown">Copy MD</button>
  `;

  bubble.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      void runBubbleAction(button.dataset.action as BubbleAction, button, {
        complete,
        setBubbleBusy,
        hideBubble,
      });
    });
  });

  function hideBubble() {
    bubble.hidden = true;
  }

  function hideToast() {
    window.clearTimeout(hideTimer);
    toast.hidden = true;
    toast.classList.remove('hiding', 'error');
  }

  function hideAll() {
    hideBubble();
    hideToast();
  }

  function setBubbleBusy(busy: boolean) {
    bubble.querySelectorAll('button').forEach((button) => {
      button.disabled = busy;
    });
  }

  function showBubble(rect: DOMRect) {
    bubble.hidden = false;
    const top = Math.max(8, rect.top + window.scrollY - 44);
    const left = rect.left + window.scrollX + rect.width / 2;
    bubble.style.top = `${top}px`;
    bubble.style.left = `${left}px`;
  }

  function scheduleHide() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      toast.classList.add('hiding');
      window.setTimeout(hideToast, 180);
    }, TOAST_MS);
  }

  function complete(message: ClipkitDoneMessage) {
    hideBubble();
    lastText = message.text;
    const copied = message.error ? false : copyTextInPage(message.text);
    if (!message.error && message.filename) {
      downloadTextFile(message.filename, message.text, 'text/markdown;charset=utf-8');
    }

    toast.hidden = false;
    toast.classList.toggle('error', Boolean(message.error));
    toast.classList.remove('hiding');
    const statusLine = message.error
      ? message.toast
      : copied
        ? message.toast
        : `${message.toast} (copy failed — use Copy)`;

    toast.innerHTML = `
      <p class="toast-title">${escapeHtml(message.title)}</p>
      <p class="toast-msg">${escapeHtml(statusLine)}</p>
      ${message.preview ? `<div class="toast-preview"></div>` : ''}
      <div class="toast-actions">
        <button type="button" data-toast="copy" class="primary">Copy</button>
        <button type="button" data-toast="dismiss">Dismiss</button>
      </div>
    `;
    const preview = toast.querySelector<HTMLDivElement>('.toast-preview');
    if (preview && message.preview) {
      preview.textContent = message.preview;
    }
    toast.querySelector<HTMLButtonElement>('button[data-toast="dismiss"]')?.addEventListener('click', hideToast);
    toast.querySelector<HTMLButtonElement>('button[data-toast="copy"]')?.addEventListener('click', () => {
      const ok = copyTextInPage(lastText);
      const msg = toast.querySelector<HTMLParagraphElement>('.toast-msg');
      if (msg) {
        msg.textContent = ok ? 'Copied again' : 'Copy failed';
      }
      scheduleHide();
    });

    if (!message.error) {
      scheduleHide();
    }
  }

  return {
    host,
    hideBubble,
    hideToast,
    hideAll,
    showBubble,
    complete,
    setBubbleBusy,
    bubble,
  };
}

function syncBubble(ui: ReturnType<typeof createUi>) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    ui.hideBubble();
    return;
  }

  const text = selection.toString().trim();
  if (text.length < 8) {
    ui.hideBubble();
    return;
  }

  const anchor = selection.anchorNode?.parentElement;
  if (anchor && isEditable(anchor)) {
    ui.hideBubble();
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width < 2 && rect.height < 2) {
    ui.hideBubble();
    return;
  }

  ui.showBubble(rect);
}

async function runBubbleAction(
  action: BubbleAction,
  button: HTMLButtonElement,
  ui: {
    complete: (message: ClipkitDoneMessage) => void;
    setBubbleBusy: (busy: boolean) => void;
    hideBubble: () => void;
  },
): Promise<void> {
  const selection = window.getSelection()?.toString().trim() ?? '';
  if (!selection) {
    ui.complete({
      type: CLIPKIT_UI.Done,
      title: 'ClipKit',
      text: '',
      toast: 'Select text first',
      error: true,
    });
    return;
  }

  ui.setBubbleBusy(true);
  const label = button.textContent;
  button.textContent = '…';

  try {
    if (action === 'markdown') {
      const response = (await chrome.runtime.sendMessage({
        type: 'clipkit/copy-selection-markdown',
      })) as { ok: boolean; message: string; text?: string };
      if (!response.ok || !response.text) {
        ui.complete({
          type: CLIPKIT_UI.Done,
          title: 'Markdown',
          text: '',
          toast: response.message,
          error: true,
        });
        return;
      }
      ui.complete({
        type: CLIPKIT_UI.Done,
        title: 'Markdown',
        text: response.text,
        toast: 'Copied — paste into notes',
        preview: response.text.slice(0, 160),
      });
      return;
    }

    const mode = action === 'summarize' ? 'summarize' : 'action-items';
    const response = (await chrome.runtime.sendMessage({
      type: 'clipkit/ai-run',
      mode,
      text: selection,
    })) as { ok: boolean; message: string; text?: string };
    if (!response.ok || !response.text) {
      ui.complete({
        type: CLIPKIT_UI.Done,
        title: action === 'summarize' ? 'Summarize' : 'Actions',
        text: '',
        toast: response.message,
        error: true,
      });
      return;
    }
    ui.complete({
      type: CLIPKIT_UI.Done,
      title: action === 'summarize' ? 'Summarize' : 'Actions',
      text: response.text,
      toast: 'Copied — paste anywhere',
      preview: response.text.slice(0, 160),
    });
  } catch (error) {
    ui.complete({
      type: CLIPKIT_UI.Done,
      title: 'ClipKit',
      text: '',
      toast: error instanceof Error ? error.message : 'Something went wrong',
      error: true,
    });
  } finally {
    ui.setBubbleBusy(false);
    button.textContent = label;
  }
}

function isEditable(el: Element): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return true;
  }
  return Boolean(el.closest('input, textarea, [contenteditable="true"]'));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
