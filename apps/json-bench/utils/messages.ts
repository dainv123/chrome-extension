export const JSON_BENCH = {
  CaptureSelection: 'json-bench/capture-selection',
  CapturePage: 'json-bench/capture-page',
  FillPane: 'json-bench/fill-pane',
  ImportToPane: 'json-bench/import-to-pane',
} as const;

export type Pane = 'left' | 'right';

export type CaptureRequest =
  | { type: typeof JSON_BENCH.CaptureSelection }
  | { type: typeof JSON_BENCH.CapturePage };

export type CaptureResponse =
  | { ok: true; text: string }
  | { ok: false; message: string };

export type FillPaneMessage = {
  type: typeof JSON_BENCH.FillPane;
  pane: Pane;
  text: string;
};

export type ImportToPaneMessage = {
  type: typeof JSON_BENCH.ImportToPane;
  pane: Pane;
  source: 'selection' | 'page';
};

export type ImportToPaneResponse =
  | { ok: true; text: string; pane: Pane }
  | { ok: false; message: string };

export const PENDING_FILL_KEY = 'jsonBenchPendingFill';

export type PendingFill = {
  pane: Pane;
  text: string;
};
