export const QUIET_ACTIONS = {
  Toggle: 'quiet/toggle',
} as const;

export type QuietRequest = { type: typeof QUIET_ACTIONS.Toggle };

export type QuietResponse =
  | { ok: true; open: boolean; message: string }
  | { ok: false; message: string };
