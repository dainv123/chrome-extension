import './style.css';
import { writeClipboard } from '@repo/extension-utils';
import {
  AI_MODES,
  CLIPKIT_ACTIONS,
  CLIPKIT_AI,
  type AiMode,
  type ClipkitAiResponse,
  type ClipkitBriefResponse,
  type ClipkitClipRequest,
  type ClipkitClipResponse,
  type ClipkitResponse,
} from '../../utils/messages';
import {
  LAST_AI_RESULT_KEY,
  LAST_CLIP_RESULT_KEY,
  type LastAiResult,
  type LastClipResult,
} from '../../utils/settings';

const MODE_LABEL: Record<AiMode, string> = {
  [AI_MODES.Summarize]: 'Summarize',
  [AI_MODES.ActionItems]: 'Action items',
  [AI_MODES.Explain]: 'Explain',
};

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.innerHTML = `
    <header class="header">
      <h1>ClipKit</h1>
      <p>Select text → bubble. Or Alt+Shift+C for Clip &amp; Brief (copy + .md file).</p>
    </header>

    <section class="section">
      <h2>Wow move</h2>
      <div class="actions">
        <button type="button" class="primary" id="clip-brief">
          Clip &amp; Brief page
        </button>
      </div>
    </section>

    <section class="section">
      <h2>Clip</h2>
      <div class="actions">
        <button type="button" data-clip="${CLIPKIT_ACTIONS.CopyPageMarkdown}">
          Copy page as Markdown
        </button>
        <button type="button" data-clip="${CLIPKIT_ACTIONS.CopySelectionMarkdown}">
          Copy selection as Markdown
        </button>
        <button type="button" data-clip="${CLIPKIT_ACTIONS.ExportTablesCsv}">
          Export tables as CSV
        </button>
      </div>
    </section>

    <section class="section">
      <h2>AI on selection</h2>
      <div class="actions">
        <button type="button" data-ai="${AI_MODES.Summarize}">Summarize</button>
        <button type="button" data-ai="${AI_MODES.ActionItems}">Action items</button>
        <button type="button" data-ai="${AI_MODES.Explain}">Explain</button>
      </div>
    </section>

    <p class="status" id="status" role="status"></p>

    <section class="section result-wrap" id="result-wrap" hidden>
      <div class="result-head">
        <h2 id="result-title">Result</h2>
        <button type="button" id="copy-result">Copy</button>
      </div>
      <pre class="result" id="result"></pre>
    </section>

    <p class="hint">
      Pain solved: result is copied (and .md downloaded on Brief). Toast auto-hides.
      Shortcut: <kbd>Alt+Shift+C</kbd>.
      <a href="#" id="open-options">Gemini API key</a>
    </p>
  `;

  const status = app.querySelector<HTMLParagraphElement>('#status');
  const resultWrap = app.querySelector<HTMLElement>('#result-wrap');
  const resultTitle = app.querySelector<HTMLElement>('#result-title');
  const result = app.querySelector<HTMLPreElement>('#result');
  const copyResult = app.querySelector<HTMLButtonElement>('#copy-result');
  const openOptions = app.querySelector<HTMLAnchorElement>('#open-options');
  const clipBrief = app.querySelector<HTMLButtonElement>('#clip-brief');

  clipBrief?.addEventListener('click', () => {
    void runBrief(status, clipBrief, resultWrap, resultTitle, result);
  });

  app.querySelectorAll<HTMLButtonElement>('button[data-clip]').forEach((button) => {
    button.addEventListener('click', () => {
      const type = button.dataset.clip as ClipkitClipRequest['type'];
      void runClip({ type }, status, button, resultWrap, resultTitle, result);
    });
  });

  app.querySelectorAll<HTMLButtonElement>('button[data-ai]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.ai as AiMode;
      void runAi(mode, status, button, resultWrap, resultTitle, result);
    });
  });

  copyResult?.addEventListener('click', () => {
    const text = result?.textContent ?? '';
    if (!text) {
      return;
    }
    void writeClipboard(text).then((ok) => {
      setStatus(status, ok ? 'Result copied' : 'Copy failed — select text in the box', ok);
    });
  });

  openOptions?.addEventListener('click', (event) => {
    event.preventDefault();
    void chrome.runtime.openOptionsPage();
  });

  chrome.runtime.onMessage.addListener(
    (message: { type?: string; title?: string } & (ClipkitAiResponse | ClipkitClipResponse)) => {
      if (message?.type === 'clipkit/ai-result') {
        showAiResponse(message as ClipkitAiResponse, status, resultWrap, resultTitle, result);
        return;
      }
      if (message?.type === 'clipkit/clip-result') {
        const clip = message as ClipkitClipResponse & { title?: string };
        if (!clip.ok || !clip.text || !resultWrap || !resultTitle || !result) {
          setStatus(status, clip.message, clip.ok);
          return;
        }
        void presentClip(clip.text, clip.title ?? 'Clip', clip.message, status, resultWrap, resultTitle, result);
      }
    },
  );

  void chrome.storage.session.get([LAST_AI_RESULT_KEY, LAST_CLIP_RESULT_KEY]).then((data) => {
    const lastAi = data[LAST_AI_RESULT_KEY] as LastAiResult | undefined;
    const lastClip = data[LAST_CLIP_RESULT_KEY] as LastClipResult | undefined;
    if (!resultWrap || !resultTitle || !result) {
      return;
    }
    if (lastAi?.text && (!lastClip || lastAi.at >= lastClip.at)) {
      showResult(MODE_LABEL[lastAi.mode as AiMode] ?? 'Result', lastAi.text, resultWrap, resultTitle, result);
      setStatus(status, 'Loaded last AI result', true);
      return;
    }
    if (lastClip?.text) {
      showResult(lastClip.title, lastClip.text, resultWrap, resultTitle, result);
      setStatus(status, 'Loaded last clip', true);
    }
  });
}

async function runBrief(
  status: HTMLParagraphElement | null,
  button: HTMLButtonElement,
  resultWrap: HTMLElement | null,
  resultTitle: HTMLElement | null,
  result: HTMLPreElement | null,
): Promise<void> {
  button.disabled = true;
  setStatus(status, 'Clipping & briefing…');
  try {
    const response = (await chrome.runtime.sendMessage({
      type: CLIPKIT_ACTIONS.ClipAndBrief,
    })) as ClipkitBriefResponse;
    if (!response.ok) {
      setStatus(status, response.message, false);
      return;
    }
    await presentClip(
      response.text,
      'Clip & Brief',
      response.message,
      status,
      resultWrap,
      resultTitle,
      result,
    );
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : 'Brief failed', false);
  } finally {
    button.disabled = false;
  }
}

async function runClip(
  request: ClipkitClipRequest,
  status: HTMLParagraphElement | null,
  button: HTMLButtonElement,
  resultWrap: HTMLElement | null,
  resultTitle: HTMLElement | null,
  result: HTMLPreElement | null,
): Promise<void> {
  button.disabled = true;
  setStatus(status, 'Working…');
  try {
    const response = (await chrome.runtime.sendMessage(request)) as ClipkitResponse;
    if (!response.ok || !('text' in response) || !response.text) {
      setStatus(status, response.message, response.ok);
      return;
    }
    const title =
      request.type === CLIPKIT_ACTIONS.ExportTablesCsv ? 'CSV' : 'Markdown';
    await presentClip(
      response.text,
      title,
      response.message,
      status,
      resultWrap,
      resultTitle,
      result,
    );
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : 'Something went wrong', false);
  } finally {
    button.disabled = false;
  }
}

async function presentClip(
  text: string,
  title: string,
  fallbackMessage: string,
  status: HTMLParagraphElement | null,
  resultWrap: HTMLElement | null,
  resultTitle: HTMLElement | null,
  result: HTMLPreElement | null,
): Promise<void> {
  if (resultWrap && resultTitle && result) {
    showResult(title, text, resultWrap, resultTitle, result);
  }
  const copied = await writeClipboard(text);
  setStatus(
    status,
    copied ? `${title} copied` : `${fallbackMessage} — press Copy`,
    true,
  );
}

async function runAi(
  mode: AiMode,
  status: HTMLParagraphElement | null,
  button: HTMLButtonElement,
  resultWrap: HTMLElement | null,
  resultTitle: HTMLElement | null,
  result: HTMLPreElement | null,
): Promise<void> {
  button.disabled = true;
  setStatus(status, 'Asking Gemini…');
  try {
    const response = (await chrome.runtime.sendMessage({
      type: CLIPKIT_AI.Run,
      mode,
    })) as ClipkitAiResponse;
    showAiResponse(response, status, resultWrap, resultTitle, result);
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : 'AI failed', false);
  } finally {
    button.disabled = false;
  }
}

function showAiResponse(
  response: ClipkitAiResponse,
  status: HTMLParagraphElement | null,
  resultWrap: HTMLElement | null,
  resultTitle: HTMLElement | null,
  result: HTMLPreElement | null,
): void {
  if (!response.ok) {
    setStatus(status, response.message, false);
    return;
  }
  if (resultWrap && resultTitle && result) {
    showResult(MODE_LABEL[response.mode] ?? 'Result', response.text, resultWrap, resultTitle, result);
  }
  setStatus(status, response.message, true);
}

function showResult(
  title: string,
  text: string,
  resultWrap: HTMLElement,
  resultTitle: HTMLElement,
  result: HTMLPreElement,
): void {
  resultTitle.textContent = title;
  result.textContent = text;
  resultWrap.hidden = false;
}

function setStatus(
  status: HTMLParagraphElement | null,
  message: string,
  ok?: boolean,
): void {
  if (!status) {
    return;
  }
  status.textContent = message;
  status.dataset.tone = ok == null ? 'neutral' : ok ? 'ok' : 'error';
}
