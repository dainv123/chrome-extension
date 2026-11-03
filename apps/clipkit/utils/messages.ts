import { AI_MODES, type AiMode } from '@repo/ai-client';

export const CLIPKIT_ACTIONS = {
  CopyPageMarkdown: 'clipkit/copy-page-markdown',
  CopySelectionMarkdown: 'clipkit/copy-selection-markdown',
  ExportTablesCsv: 'clipkit/export-tables-csv',
  GetSelectionText: 'clipkit/get-selection-text',
  GetPageMarkdown: 'clipkit/get-page-markdown',
  ClipAndBrief: 'clipkit/clip-and-brief',
} as const;

export const CLIPKIT_AI = {
  Run: 'clipkit/ai-run',
} as const;

export const CLIPKIT_UI = {
  ShowCard: 'clipkit/show-card',
  Done: 'clipkit/done',
} as const;

export type ClipkitClipRequest =
  | { type: typeof CLIPKIT_ACTIONS.CopyPageMarkdown }
  | { type: typeof CLIPKIT_ACTIONS.CopySelectionMarkdown }
  | { type: typeof CLIPKIT_ACTIONS.ExportTablesCsv }
  | { type: typeof CLIPKIT_ACTIONS.GetSelectionText }
  | { type: typeof CLIPKIT_ACTIONS.GetPageMarkdown };

export type ClipkitBriefRequest = {
  type: typeof CLIPKIT_ACTIONS.ClipAndBrief;
};

export type ClipkitAiRequest = {
  type: typeof CLIPKIT_AI.Run;
  mode: AiMode;
  text?: string;
};

export type ClipkitShowCardMessage = {
  type: typeof CLIPKIT_UI.ShowCard;
  title: string;
  text: string;
};

/** On-page outcome: copy (+ optional download) + ephemeral toast. */
export type ClipkitDoneMessage = {
  type: typeof CLIPKIT_UI.Done;
  title: string;
  text: string;
  toast: string;
  filename?: string;
  preview?: string;
  error?: boolean;
};

export type ClipkitRequest = ClipkitClipRequest | ClipkitBriefRequest | ClipkitAiRequest;

export type ClipkitClipResponse =
  | { ok: true; message: string; text?: string }
  | { ok: false; message: string };

export type ClipkitBriefResponse =
  | { ok: true; message: string; text: string; summary: string; markdown: string }
  | { ok: false; message: string };

export type ClipkitAiResponse =
  | { ok: true; message: string; text: string; mode: AiMode }
  | { ok: false; message: string };

export type ClipkitResponse = ClipkitClipResponse | ClipkitBriefResponse | ClipkitAiResponse;

export function isAiMode(value: string): value is AiMode {
  return Object.values(AI_MODES).includes(value as AiMode);
}

export { AI_MODES, type AiMode };
