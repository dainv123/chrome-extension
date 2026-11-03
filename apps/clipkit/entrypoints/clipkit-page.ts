import { tablesToCsv, slugFilename } from '@repo/export';
import {
  documentToMarkdown,
  extractTables,
  selectionToMarkdown,
} from '@repo/extract';
import { copyTextInPage, downloadTextFile } from '@repo/extension-utils';
import {
  CLIPKIT_ACTIONS,
  CLIPKIT_AI,
  CLIPKIT_UI,
  type ClipkitClipRequest,
  type ClipkitClipResponse,
  type ClipkitRequest,
} from '../utils/messages';

const LOADED_FLAG = '__clipkitPageScriptLoaded__';

export default defineUnlistedScript(() => {
  const w = window as Window & { [LOADED_FLAG]?: boolean };
  if (w[LOADED_FLAG]) {
    return;
  }
  w[LOADED_FLAG] = true;

  chrome.runtime.onMessage.addListener((message: ClipkitRequest | { type: string }, _sender, sendResponse) => {
    if (
      message.type === CLIPKIT_AI.Run ||
      message.type === CLIPKIT_ACTIONS.ClipAndBrief ||
      message.type === CLIPKIT_UI.ShowCard ||
      message.type === CLIPKIT_UI.Done
    ) {
      return;
    }
    sendResponse(handleClipMessage(message as ClipkitClipRequest));
    return true;
  });
});

function handleClipMessage(message: ClipkitClipRequest): ClipkitClipResponse {
  switch (message.type) {
    case CLIPKIT_ACTIONS.CopyPageMarkdown: {
      const markdown = documentToMarkdown(document);
      const copied = copyTextInPage(markdown);
      return {
        ok: true,
        message: copied ? 'Page copied as Markdown' : 'Markdown ready — use Copy in side panel',
        text: markdown,
      };
    }
    case CLIPKIT_ACTIONS.CopySelectionMarkdown: {
      const markdown = selectionToMarkdown();
      if (!markdown) {
        return { ok: false, message: 'Select text first' };
      }
      const copied = copyTextInPage(markdown);
      return {
        ok: true,
        message: copied
          ? 'Selection copied as Markdown'
          : 'Markdown ready — use Copy in side panel',
        text: markdown,
      };
    }
    case CLIPKIT_ACTIONS.ExportTablesCsv: {
      const tables = extractTables(document);
      if (tables.length === 0) {
        return { ok: false, message: 'No tables found on this page' };
      }
      const csv = tablesToCsv(tables);
      const filename = slugFilename(document.title || 'tables', 'csv');
      downloadTextFile(filename, csv, 'text/csv;charset=utf-8');
      const copied = copyTextInPage(csv);
      return {
        ok: true,
        message: copied
          ? `Exported ${tables.length} table${tables.length === 1 ? '' : 's'} to CSV`
          : `CSV downloaded — use Copy in side panel if needed`,
        text: csv,
      };
    }
    case CLIPKIT_ACTIONS.GetSelectionText: {
      const text = window.getSelection()?.toString().trim() ?? '';
      if (!text) {
        return { ok: false, message: 'Select text first' };
      }
      return { ok: true, message: 'Selection captured', text };
    }
    case CLIPKIT_ACTIONS.GetPageMarkdown: {
      const markdown = documentToMarkdown(document);
      if (!markdown.trim()) {
        return { ok: false, message: 'No readable content on this page' };
      }
      return { ok: true, message: 'Page markdown ready', text: markdown };
    }
    default: {
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
}
