export type JsonOk = { ok: true; value: unknown; formatted: string };
export type JsonErr = { ok: false; message: string };
export type JsonResult = JsonOk | JsonErr;

export function parseJson(text: string): { ok: true; value: unknown } | JsonErr {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, message: 'JSON is empty' };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON';
    return { ok: false, message };
  }
}

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep(record[key]);
        return acc;
      }, {});
  }
  return value;
}

export function formatJson(text: string, space = 2): JsonResult {
  const parsed = parseJson(text);
  if (!parsed.ok) {
    return parsed;
  }
  return {
    ok: true,
    value: parsed.value,
    formatted: `${JSON.stringify(sortKeysDeep(parsed.value), null, space)}\n`,
  };
}

export function minifyJson(text: string): JsonResult {
  const parsed = parseJson(text);
  if (!parsed.ok) {
    return parsed;
  }
  return {
    ok: true,
    value: parsed.value,
    formatted: JSON.stringify(sortKeysDeep(parsed.value)),
  };
}
