// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useState } from 'react'
import { cn } from '../lib/cn.js'
import type { DiffLine } from '../lib/diff.js'
import { ShowMore } from './ui.js'

/** Rows rendered at first. Switching on a blocklist adds tens of thousands of lines. */
const DIFF_PAGE = 1500

export type DiffLayout = 'unified' | 'split'

const SIGIL: Record<DiffLine['kind'], string> = { add: '+', remove: '-', same: ' ' }
const TONE: Record<DiffLine['kind'], string> = {
  add: 'bg-diff-add-bg text-diff-add',
  remove: 'bg-diff-remove-bg text-diff-remove',
  same: 'text-muted-foreground',
}

interface Row {
  line: DiffLine
  /** Line number in the file on disk; null for an added line. */
  before: number | null
  /** Line number in the file after apply; null for a removed line. */
  after: number | null
}

/**
 * Diff of the file on disk against what apply would write. The user reads this to decide
 * whether to authorise a write to a root-owned file, so every changed line is shown in full
 * with its line number. Unified stacks removals above additions; split puts the file as it is
 * on the left and as it will be on the right, the way a file-compare tool does.
 */
export function DiffView({
  diff,
  layout,
  wholeFile,
}: {
  diff: readonly DiffLine[]
  layout: DiffLayout
  /** Show every line instead of two lines of context around each change. */
  wholeFile: boolean
}) {
  const shown = useMemo(() => {
    const rows = number(diff)
    return wholeFile ? rows : collapse(rows)
  }, [diff, wholeFile])
  const pairs = useMemo(() => (layout === 'split' ? pair(shown) : null), [layout, shown])
  const [limit, setLimit] = useState(DIFF_PAGE)
  useEffect(() => setLimit(DIFF_PAGE), [diff, wholeFile, layout])
  const total = pairs ? pairs.length : shown.length

  return (
    <div className={cn('font-mono leading-[1.6]', pairs ? 'text-[12px]' : 'text-[12.5px]')}>
      {pairs ? <Split pairs={pairs.slice(0, limit)} /> : <Unified rows={shown.slice(0, limit)} />}
      <div className="font-sans">
        <ShowMore
          shown={Math.min(limit, total)}
          total={total}
          step={DIFF_PAGE * 4}
          onMore={() => setLimit((l) => l + DIFF_PAGE * 4)}
        />
      </div>
    </div>
  )
}

function Unified({ rows }: { rows: readonly (Row | null)[] }) {
  return (
    <>
      {rows.map((row, i) =>
        row === null ? (
          <Gap key={`gap-${i}`} />
        ) : (
          <div key={i} className={cn('flex whitespace-pre', TONE[row.line.kind])}>
            <Gutter n={row.before} />
            <Gutter n={row.after} />
            <Sigil kind={row.line.kind} />
            <code className="flex-1 pr-4">{row.line.text || ' '}</code>
          </div>
        ),
      )}
    </>
  )
}

function Split({ pairs }: { pairs: readonly (Pair | null)[] }) {
  return (
    <>
      {pairs.map((p, i) =>
        p === null ? (
          <Gap key={`gap-${i}`} />
        ) : (
          <div key={i} className="flex">
            <Side row={p.left} side="before" />
            <Side row={p.right} side="after" />
          </div>
        ),
      )}
    </>
  )
}

/** One half of a split row. Long lines wrap so the two halves stay level with each other. */
function Side({ row, side }: { row: Row | null; side: 'before' | 'after' }) {
  return (
    <div
      className={cn(
        'flex w-1/2 min-w-0',
        side === 'after' && 'border-l',
        row ? TONE[row.line.kind] : 'bg-secondary/60',
      )}
    >
      <Gutter n={row ? row[side] : null} />
      <Sigil kind={row?.line.kind ?? 'same'} />
      <code className="min-w-0 flex-1 pr-3 break-words whitespace-pre-wrap">
        {row ? row.line.text || ' ' : ' '}
      </code>
    </div>
  )
}

function Gap() {
  return (
    <div className="border-y border-dashed px-4 py-1 text-center text-muted-foreground/50 select-none">
      ⋯
    </div>
  )
}

function Gutter({ n }: { n: number | null }) {
  return (
    <span
      aria-hidden="true"
      className="w-10 shrink-0 pr-2 text-right text-[11px] text-muted-foreground/50 select-none"
    >
      {n ?? ''}
    </span>
  )
}

function Sigil({ kind }: { kind: DiffLine['kind'] }) {
  return (
    <span aria-hidden="true" className="w-5 shrink-0 text-center select-none">
      {SIGIL[kind]}
    </span>
  )
}

function number(diff: readonly DiffLine[]): Row[] {
  let before = 0
  let after = 0
  return diff.map((line) => {
    if (line.kind !== 'add') before++
    if (line.kind !== 'remove') after++
    return {
      line,
      before: line.kind === 'add' ? null : before,
      after: line.kind === 'remove' ? null : after,
    }
  })
}

/** Keep two lines of context around each change; elide the rest. */
function collapse(rows: readonly Row[]): (Row | null)[] {
  const keep = new Set<number>()
  rows.forEach((r, i) => {
    if (r.line.kind === 'same') return
    for (let j = Math.max(0, i - 2); j <= Math.min(rows.length - 1, i + 2); j++) keep.add(j)
  })
  const out: (Row | null)[] = []
  let gap = false
  rows.forEach((r, i) => {
    if (keep.has(i)) {
      out.push(r)
      gap = false
    } else if (!gap) {
      out.push(null)
      gap = true
    }
  })
  return out
}

interface Pair {
  left: Row | null
  right: Row | null
}

/**
 * Line the two sides up. An unchanged line sits on both sides; within a run of changes the
 * n-th removal sits beside the n-th addition, and whichever side runs out is left blank.
 */
function pair(rows: readonly (Row | null)[]): (Pair | null)[] {
  const out: (Pair | null)[] = []
  let removes: Row[] = []
  let adds: Row[] = []
  const flush = () => {
    for (let k = 0; k < Math.max(removes.length, adds.length); k++)
      out.push({ left: removes[k] ?? null, right: adds[k] ?? null })
    removes = []
    adds = []
  }
  for (const r of rows) {
    if (r === null) {
      flush()
      out.push(null)
    } else if (r.line.kind === 'same') {
      flush()
      out.push({ left: r, right: r })
    } else if (r.line.kind === 'remove') removes.push(r)
    else adds.push(r)
  }
  flush()
  return out
}
