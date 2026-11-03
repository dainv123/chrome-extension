import { AI_MODES, generateWithGemini, type AiMode } from '@repo/ai-client';
import { slugFilename } from '@repo/export';
import {
  CLIPKIT_ACTIONS,
  CLIPKIT_AI,
  CLIPKIT_UI,
  type ClipkitAiRequest,
  type ClipkitAiResponse,
  type ClipkitBriefResponse,
  type ClipkitClipRequest,
  type ClipkitClipResponse,
  type ClipkitDoneMessage,
  type ClipkitRequest,
  type ClipkitResponse,
} from '../utils/messages';
import {
  LAST_AI_RESULT_KEY,
  LAST_CLIP_RESULT_KEY,
  loadSettings,
  type LastAiResult,
  type LastClipResult,
} from '../utils/settings';

const MENU = {
  CopyPage: 'clipkit-copy-page-md',
  CopySelection: 'clipkit-copy-selection-md',
  ExportTables: 'clipkit-export-tables-csv',
  ClipAndBrief: 'clipkit-clip-and-brief',
  Summarize: 'clipkit-ai-summarize',
  ActionItems: 'clipkit-ai-action-items',
  Explain: 'clipkit-ai-explain',
} as const;

const COMMAND_CLIP_BRIEF = 'clip-and-brief';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: MENU.ClipAndBrief,
        title: 'ClipKit: Clip & Brief (copy + .md)',
        contexts: ['page', 'selection'],
      });
      chrome.contextMenus.create({
        id: MENU.CopyPage,
        title: 'ClipKit: Copy page as Markdown',
        contexts: ['page', 'selection'],
      });
      chrome.contextMenus.create({
        id: MENU.CopySelection,
        title: 'ClipKit: Copy selection as Markdown',
        contexts: ['selection'],
      });
      chrome.contextMenus.create({
        id: MENU.ExportTables,
        title: 'ClipKit: Export tables as CSV',
        contexts: ['page', 'selection'],
      });
      chrome.contextMenus.create({
        id: MENU.Summarize,
        title: 'ClipKit: Summarize selection',
        contexts: ['selection'],
      });
      chrome.contextMenus.create({
        id: MENU.ActionItems,
        title: 'ClipKit: Action items from selection',
        contexts: ['selection'],
      });
      chrome.contextMenus.create({
        id: MENU.Explain,
        title: 'ClipKit: Explain selection',
        contexts: ['selection'],
      });
    });
  });

  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

  chrome.commands.onCommand.addListener((command) => {
    if (command !== COMMAND_CLIP_BRIEF) {
      return;
    }
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) {
        void runBriefFromMenu(tab.id);
      }
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) {
      return;
    }
    switch (info.menuItemId) {
      case MENU.ClipAndBrief:
        void runBriefFromMenu(tab.id);
        break;
      case MENU.CopyPage:
        void runClipFromMenu(tab.id, { type: CLIPKIT_ACTIONS.CopyPageMarkdown }, 'Markdown');
        break;
      case MENU.CopySelection:
        void runClipFromMenu(tab.id, { type: CLIPKIT_ACTIONS.CopySelectionMarkdown }, 'Markdown');
        break;
      case MENU.ExportTables:
        void runClipFromMenu(tab.id, { type: CLIPKIT_ACTIONS.ExportTablesCsv }, 'CSV');
        break;
      case MENU.Summarize:
        void runAiFromMenu(tab.id, AI_MODES.Summarize, info.selectionText);
        break;
      case MENU.ActionItems:
        void runAiFromMenu(tab.id, AI_MODES.ActionItems, info.selectionText);
        break;
      case MENU.Explain:
        void runAiFromMenu(tab.id, AI_MODES.Explain, info.selectionText);
        break;
      default:
        break;
    }
  });

  chrome.runtime.onMessage.addListener((message: ClipkitRequest, sender, sendResponse) => {
    if (message.type === CLIPKIT_AI.Run) {
      void handleAiRequest(message, sender.tab?.id).then(sendResponse);
      return true;
    }

    if (message.type === CLIPKIT_ACTIONS.ClipAndBrief) {
      void chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (!tab?.id) {
          sendResponse({ ok: false, message: 'No active tab' } satisfies ClipkitBriefResponse);
          return;
        }
        const result = await handleClipAndBrief(tab.id);
        if (result.ok) {
          await deliverDone(tab.id, {
            type: CLIPKIT_UI.Done,
            title: 'Clip & Brief',
            text: result.text,
            toast: 'Copied + downloaded .md — paste into notes',
            filename: slugFilename(tab.title || 'clipkit-brief', 'md'),
            preview: result.summary.slice(0, 180),
          });
        } else {
          await deliverDone(tab.id, {
            type: CLIPKIT_UI.Done,
            title: 'Clip & Brief',
            text: '',
            toast: result.message,
            error: true,
          });
        }
        sendResponse(result);
      });
      return true;
    }

    const tabId = sender.tab?.id;
    if (tabId != null) {
      void runClipAction(tabId, message).then(sendResponse);
      return true;
    }

    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.id) {
        sendResponse({ ok: false, message: 'No active tab' } satisfies ClipkitResponse);
        return;
      }
      void runClipAction(tab.id, message).then(sendResponse);
    });
    return true;
  });
});

async function runBriefFromMenu(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const result = await handleClipAndBrief(tabId);
  chrome.runtime.sendMessage({ type: 'clipkit/clip-result', ...result, title: 'Clip & Brief' }).catch(() => undefined);
  if (result.ok) {
    await deliverDone(tabId, {
      type: CLIPKIT_UI.Done,
      title: 'Clip & Brief',
      text: result.text,
      toast: 'Copied + downloaded .md — paste into Notion/Obsidian',
      filename: slugFilename(tab.title || 'clipkit-brief', 'md'),
      preview: result.summary.slice(0, 180),
    });
    return;
  }
  await deliverDone(tabId, {
    type: CLIPKIT_UI.Done,
    title: 'Clip & Brief',
    text: '',
    toast: result.message,
    error: true,
  });
}

async function handleClipAndBrief(tabId: number): Promise<ClipkitBriefResponse> {
  const page = await runClipAction(tabId, { type: CLIPKIT_ACTIONS.GetPageMarkdown });
  if (!page.ok || !page.text) {
    return { ok: false, message: page.message };
  }

  const settings = await loadSettings();
  const summary = await generateWithGemini({
    apiKey: settings.apiKey,
    model: settings.model,
    mode: AI_MODES.Summarize,
    input: page.text,
  });
  if (!summary.ok) {
    return { ok: false, message: summary.message };
  }

  const text = `## Brief\n\n${summary.text}\n\n---\n\n${page.text}`;
  const last: LastClipResult = { title: 'Clip & Brief', text, at: Date.now() };
  await chrome.storage.session.set({ [LAST_CLIP_RESULT_KEY]: last });
  await chrome.storage.session.set({
    [LAST_AI_RESULT_KEY]: {
      mode: AI_MODES.Summarize,
      text: summary.text,
      at: Date.now(),
    } satisfies LastAiResult,
  });

  return {
    ok: true,
    message: 'Clip & Brief ready',
    text,
    summary: summary.text,
    markdown: page.text,
  };
}

async function runClipFromMenu(
  tabId: number,
  request: ClipkitClipRequest,
  title: string,
): Promise<void> {
  const result = await runClipAction(tabId, request);
  if (result.ok && result.text) {
    const last: LastClipResult = { title, text: result.text, at: Date.now() };
    await chrome.storage.session.set({ [LAST_CLIP_RESULT_KEY]: last });
    await deliverDone(tabId, {
      type: CLIPKIT_UI.Done,
      title,
      text: result.text,
      toast: title === 'CSV' ? 'CSV copied (+ download if saved)' : 'Copied — paste into notes',
      preview: result.text.slice(0, 160),
    });
  } else {
    await deliverDone(tabId, {
      type: CLIPKIT_UI.Done,
      title,
      text: '',
      toast: result.message,
      error: true,
    });
  }
  chrome.runtime
    .sendMessage({ type: 'clipkit/clip-result', ...result, title })
    .catch(() => undefined);
}

async function runAiFromMenu(
  tabId: number,
  mode: AiMode,
  selectionText: string | undefined,
): Promise<void> {
  const result = await handleAiRequest({ type: CLIPKIT_AI.Run, mode, text: selectionText }, tabId);
  chrome.runtime.sendMessage({ type: 'clipkit/ai-result', ...result }).catch(() => undefined);
  if (result.ok) {
    await deliverDone(tabId, {
      type: CLIPKIT_UI.Done,
      title: titleForMode(mode),
      text: result.text,
      toast: 'Copied — paste anywhere',
      preview: result.text.slice(0, 160),
    });
    return;
  }
  await deliverDone(tabId, {
    type: CLIPKIT_UI.Done,
    title: titleForMode(mode),
    text: '',
    toast: result.message,
    error: true,
  });
}

function titleForMode(mode: AiMode): string {
  switch (mode) {
    case AI_MODES.Summarize:
      return 'Summarize';
    case AI_MODES.ActionItems:
      return 'Actions';
    case AI_MODES.Explain:
      return 'Explain';
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

async function handleAiRequest(
  request: ClipkitAiRequest,
  tabId?: number,
): Promise<ClipkitAiResponse> {
  let text = request.text?.trim() ?? '';
  if (!text && tabId != null) {
    const captured = await runClipAction(tabId, { type: CLIPKIT_ACTIONS.GetSelectionText });
    if (!captured.ok || !captured.text) {
      return { ok: false, message: captured.message };
    }
    text = captured.text;
  }

  const settings = await loadSettings();
  const generated = await generateWithGemini({
    apiKey: settings.apiKey,
    model: settings.model,
    mode: request.mode,
    input: text,
  });

  if (!generated.ok) {
    return { ok: false, message: generated.message };
  }

  const last: LastAiResult = {
    mode: request.mode,
    text: generated.text,
    at: Date.now(),
  };
  await chrome.storage.session.set({ [LAST_AI_RESULT_KEY]: last });

  return {
    ok: true,
    message: 'AI result ready',
    text: generated.text,
    mode: request.mode,
  };
}

async function deliverDone(tabId: number, message: ClipkitDoneMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Restricted pages (chrome://, Web Store, etc.)
  }
}

async function runClipAction(
  tabId: number,
  request: ClipkitClipRequest,
): Promise<ClipkitClipResponse> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['clipkit-page.js'],
    });
    return await chrome.tabs.sendMessage(tabId, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run ClipKit on this page';
    return { ok: false, message };
  }
}
