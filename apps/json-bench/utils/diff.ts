import { diffLines, type Change } from 'diff';
import { formatJson } from './json';

export type DiffBuildResult =
  | { ok: true; left: string; right: string; changes: Change[] }
  | { ok: false; message: string };

export function buildFormattedDiff(leftText: string, rightText: string): DiffBuildResult {
  const left = formatJson(leftText);
  if (!left.ok) {
    return { ok: false, message: `Left: ${left.message}` };
  }
  const right = formatJson(rightText);
  if (!right.ok) {
    return { ok: false, message: `Right: ${right.message}` };
  }
  return {
    ok: true,
    left: left.formatted,
    right: right.formatted,
    changes: diffLines(left.formatted, right.formatted),
  };
}
