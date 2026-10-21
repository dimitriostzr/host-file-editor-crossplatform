// SPDX-License-Identifier: MIT

export type DiffKind = 'same' | 'add' | 'remove'
export interface DiffLine {
  kind: DiffKind
  text: string
}

/**
 * Above this many cells (changed lines before × changed lines after) the LCS table is skipped
 * and the changed region is shown as removed-then-added. 4M cells is about 30 MB and well under
 * a second; a whole-file rewrite of a blocklist would otherwise need gigabytes.
 */
const MAX_TABLE_CELLS = 4_000_000

/**
 * Line diff via longest common subsequence, run only on the region that differs. Lines that
 * match at the start and end are taken as they are first, and since apply only touches the
 * managed block and a few shadowed lines, the region left over is small even when the file is
 * a blocklist tens of thousands of lines long.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = toLines(before)
  const b = toLines(after)

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const out: DiffLine[] = []
  for (let k = 0; k < start; k++) out.push({ kind: 'same', text: a[k]! })
  diffMiddle(a.slice(start, endA), b.slice(start, endB), out)
  for (let k = endA; k < a.length; k++) out.push({ kind: 'same', text: a[k]! })
  return out
}

function diffMiddle(a: readonly string[], b: readonly string[], out: DiffLine[]): void {
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0 || n * m > MAX_TABLE_CELLS) {
    for (const text of a) out.push({ kind: 'remove', text })
    for (const text of b) out.push({ kind: 'add', text })
    return
  }

  // One flat typed array instead of n + 1 row arrays: same table, a fraction of the memory.
  const w = m + 1
  const lcs = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * w + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * w + j + 1]! + 1
          : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!)

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! })
      i++
      j++
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) {
      out.push({ kind: 'remove', text: a[i]! })
      i++
    } else {
      out.push({ kind: 'add', text: b[j]! })
      j++
    }
  }
  while (i < n) out.push({ kind: 'remove', text: a[i++]! })
  while (j < m) out.push({ kind: 'add', text: b[j++]! })
}

/** A file that ends with a newline has no extra empty line after it. */
const toLines = (text: string): string[] => {
  if (text === '') return []
  const lines = text.split(/\r\n|\n|\r/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

export const countChanges = (d: readonly DiffLine[]): { added: number; removed: number } => {
  let added = 0
  let removed = 0
  for (const l of d) {
    if (l.kind === 'add') added++
    else if (l.kind === 'remove') removed++
  }
  return { added, removed }
}
