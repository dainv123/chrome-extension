export const AI_MODES = {
  Summarize: 'summarize',
  ActionItems: 'action-items',
  Explain: 'explain',
} as const;

export type AiMode = (typeof AI_MODES)[keyof typeof AI_MODES];

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/** Older IDs Google removed — remap on load/save. */
export const DEPRECATED_GEMINI_MODELS: Record<string, string> = {
  'gemini-2.0-flash': DEFAULT_GEMINI_MODEL,
  'gemini-1.5-flash': DEFAULT_GEMINI_MODEL,
  'gemini-1.5-flash-latest': DEFAULT_GEMINI_MODEL,
};

export const MAX_INPUT_CHARS = 12_000;

export function resolveGeminiModel(model: string): string {
  const trimmed = model.trim() || DEFAULT_GEMINI_MODEL;
  return DEPRECATED_GEMINI_MODELS[trimmed] ?? trimmed;
}

const MODE_INSTRUCTIONS: Record<AiMode, string> = {
  [AI_MODES.Summarize]:
    'Summarize the text in at most 5 short bullets, then one sentence "So what".',
  [AI_MODES.ActionItems]:
    'Extract concrete action items as a checklist. Each item: verb + owner if mentioned + deadline if mentioned. If none, say so.',
  [AI_MODES.Explain]:
    'Explain the text simply for a smart beginner. Use short paragraphs. Define jargon briefly.',
};

export type GenerateResult =
  | { ok: true; text: string }
  | { ok: false; message: string };

export type GenerateParams = {
  apiKey: string;
  model: string;
  mode: AiMode;
  input: string;
};

export async function generateWithGemini(params: GenerateParams): Promise<GenerateResult> {
  const apiKey = params.apiKey.trim();
  if (!apiKey) {
    return { ok: false, message: 'Add your Gemini API key in ClipKit Options' };
  }

  const input = params.input.trim();
  if (!input) {
    return { ok: false, message: 'Select text on the page first' };
  }

  const clipped =
    input.length > MAX_INPUT_CHARS
      ? `${input.slice(0, MAX_INPUT_CHARS)}\n\n[Truncated for free-tier limits]`
      : input;

  const prompt = [
    'You are ClipKit, a concise reading assistant inside a browser extension.',
    'Reply in the same language as the user text.',
    'Do not invent facts that are not in the text.',
    MODE_INSTRUCTIONS[params.mode],
    '',
    '--- TEXT ---',
    clipped,
  ].join('\n');

  const model = resolveGeminiModel(params.model);
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
          // 2.5 Flash thinks by default; disable so short summaries don't burn the budget.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
  } catch {
    return { ok: false, message: 'Network error calling Gemini' };
  }

  const payload = (await response.json()) as GeminiResponse;

  if (!response.ok) {
    const message =
      payload.error?.message ??
      (response.status === 429
        ? 'Gemini free quota hit — try again later. Clip (Markdown/CSV) still works.'
        : `Gemini error (${response.status})`);
    return { ok: false, message };
  }

  const text = payload.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .filter((part) => part.length > 0)
    .join('')
    .trim();

  if (!text) {
    return { ok: false, message: 'Gemini returned an empty response' };
  }

  return { ok: true, text };
}

type GeminiResponse = {
  error?: { message?: string };
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
};
