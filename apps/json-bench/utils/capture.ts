import { formatJson } from './json';

export type CaptureResult =
  | { ok: true; text: string }
  | { ok: false; message: string };

/** Prefer valid JSON; otherwise return trimmed raw text for the panel to show parse errors. */
export function normalizeCapturedText(raw: string): CaptureResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: 'Nothing to capture' };
  }
  const formatted = formatJson(trimmed);
  if (formatted.ok) {
    return { ok: true, text: formatted.formatted };
  }
  const extracted = extractFirstJsonSlice(trimmed);
  if (extracted) {
    const again = formatJson(extracted);
    if (again.ok) {
      return { ok: true, text: again.formatted };
    }
  }
  return { ok: true, text: trimmed };
}

export function captureSelectionText(): CaptureResult {
  const selection = window.getSelection()?.toString() ?? '';
  return normalizeCapturedText(selection);
}

export function capturePageJson(): CaptureResult {
  const candidates: string[] = [];

  for (const el of document.querySelectorAll(
    'pre, code, script[type="application/json"], script[type="application/ld+json"]',
  )) {
    const text = el.textContent?.trim();
    if (text) {
      candidates.push(text);
    }
  }

  const bodyText = document.body?.innerText?.trim();
  if (bodyText) {
    candidates.push(bodyText);
  }

  for (const candidate of candidates) {
    const result = normalizeCapturedText(candidate);
    if (result.ok && formatJson(result.text).ok) {
      return result;
    }
  }

  if (candidates[0]) {
    return normalizeCapturedText(candidates[0]);
  }
  return { ok: false, message: 'No JSON found on this page' };
}

function extractFirstJsonSlice(text: string): string | null {
  const startObject = text.indexOf('{');
  const startArray = text.indexOf('[');
  let start = -1;
  if (startObject === -1) {
    start = startArray;
  } else if (startArray === -1) {
    start = startObject;
  } else {
    start = Math.min(startObject, startArray);
  }
  if (start === -1) {
    return null;
  }

  const opener = text[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === opener) {
      depth += 1;
    } else if (ch === closer) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}
