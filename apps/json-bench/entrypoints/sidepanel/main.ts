import './style.css';
import { buildFormattedDiff } from '../../utils/diff';
import { formatJson, minifyJson } from '../../utils/json';

type Command =
  | 'format-left'
  | 'format-right'
  | 'minify-left'
  | 'minify-right'
  | 'diff'
  | 'swap'
  | 'clear';

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.innerHTML = `
    <header class="header">
      <h1>JSON Bench</h1>
      <p>Format, minify, and diff two JSON payloads.</p>
    </header>

    <div class="toolbar">
      <button type="button" data-cmd="format-left">Format left</button>
      <button type="button" data-cmd="format-right">Format right</button>
      <button type="button" data-cmd="minify-left">Minify left</button>
      <button type="button" data-cmd="minify-right">Minify right</button>
      <button type="button" class="primary" data-cmd="diff">Diff</button>
      <button type="button" data-cmd="swap">Swap</button>
      <button type="button" data-cmd="clear">Clear</button>
    </div>

    <div class="panes">
      <label class="pane">
        <span>Left</span>
        <textarea id="left" spellcheck="false" placeholder='{"a":1}'></textarea>
      </label>
      <label class="pane">
        <span>Right</span>
        <textarea id="right" spellcheck="false" placeholder='{"a":2}'></textarea>
      </label>
    </div>

    <p class="status" id="status" role="status"></p>
    <pre class="diff" id="diff" hidden></pre>
  `;

  const left = app.querySelector<HTMLTextAreaElement>('#left');
  const right = app.querySelector<HTMLTextAreaElement>('#right');
  const status = app.querySelector<HTMLParagraphElement>('#status');
  const diffOut = app.querySelector<HTMLPreElement>('#diff');

  app.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!left || !right || !status || !diffOut) {
        return;
      }
      handleCommand(button.dataset.cmd as Command, left, right, status, diffOut);
    });
  });
}

function handleCommand(
  cmd: Command,
  left: HTMLTextAreaElement,
  right: HTMLTextAreaElement,
  status: HTMLParagraphElement,
  diffOut: HTMLPreElement,
): void {
  switch (cmd) {
    case 'format-left':
      applyTransform(left, status, formatJson, 'Left formatted');
      hideDiff(diffOut);
      break;
    case 'format-right':
      applyTransform(right, status, formatJson, 'Right formatted');
      hideDiff(diffOut);
      break;
    case 'minify-left':
      applyTransform(left, status, minifyJson, 'Left minified');
      hideDiff(diffOut);
      break;
    case 'minify-right':
      applyTransform(right, status, minifyJson, 'Right minified');
      hideDiff(diffOut);
      break;
    case 'diff': {
      const result = buildFormattedDiff(left.value, right.value);
      if (!result.ok) {
        setStatus(status, result.message, false);
        hideDiff(diffOut);
        return;
      }
      left.value = result.left;
      right.value = result.right;
      renderDiff(diffOut, result.changes);
      const changed = result.changes.some((part) => part.added || part.removed);
      setStatus(status, changed ? 'Diff ready' : 'No differences', true);
      break;
    }
    case 'swap': {
      const tmp = left.value;
      left.value = right.value;
      right.value = tmp;
      setStatus(status, 'Swapped left and right');
      hideDiff(diffOut);
      break;
    }
    case 'clear':
      left.value = '';
      right.value = '';
      setStatus(status, 'Cleared');
      hideDiff(diffOut);
      break;
    default: {
      const _exhaustive: never = cmd;
      return _exhaustive;
    }
  }
}

function applyTransform(
  target: HTMLTextAreaElement,
  status: HTMLParagraphElement,
  transform: (text: string) => { ok: true; formatted: string } | { ok: false; message: string },
  successMessage: string,
): void {
  const result = transform(target.value);
  if (!result.ok) {
    setStatus(status, result.message, false);
    return;
  }
  target.value = result.formatted;
  setStatus(status, successMessage, true);
}

function renderDiff(
  diffOut: HTMLPreElement,
  changes: { value: string; added?: boolean; removed?: boolean }[],
): void {
  diffOut.replaceChildren();
  for (const part of changes) {
    const lines = part.value.split('\n');
    // split keeps a trailing empty from final newline — skip empty last fragment
    const lastIndex = lines.length - 1;
    lines.forEach((line, index) => {
      if (index === lastIndex && line === '') {
        return;
      }
      const row = document.createElement('div');
      row.className = 'diff-line';
      if (part.added) {
        row.classList.add('added');
        row.textContent = `+ ${line}`;
      } else if (part.removed) {
        row.classList.add('removed');
        row.textContent = `- ${line}`;
      } else {
        row.textContent = `  ${line}`;
      }
      diffOut.appendChild(row);
    });
  }
  diffOut.hidden = false;
}

function hideDiff(diffOut: HTMLPreElement): void {
  diffOut.hidden = true;
  diffOut.replaceChildren();
}

function setStatus(status: HTMLParagraphElement, message: string, ok?: boolean): void {
  status.textContent = message;
  status.dataset.tone = ok == null ? 'neutral' : ok ? 'ok' : 'error';
}
