/** Never throws. Prefer Clipboard API, then legacy execCommand. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyWithExecCommand(text);
  }
}

/**
 * Content-script safe copy. Do not call navigator.clipboard here —
 * it throws NotAllowedError when the tab is not focused (e.g. side panel open).
 */
export function copyTextInPage(text: string): boolean {
  return copyWithExecCommand(text);
}

function copyWithExecCommand(text: string): boolean {
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(el);
  el.select();
  el.setSelectionRange(0, el.value.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    el.remove();
  }
  return ok;
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
