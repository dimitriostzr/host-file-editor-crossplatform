// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from 'react'
import { Columns2, Rows3, X } from 'lucide-react'
import type { ConflictDto, WriteResult } from '../env.js'
import { countChanges, type DiffLine } from '../lib/diff.js'
import { cn } from '../lib/cn.js'
import { Button, Checkbox, IconButton, useDimmedWindowControls } from './ui.js'
import { DiffView, type DiffLayout } from './DiffView.js'

interface Props {
  hostsPath: string
  diff: readonly DiffLine[]
  conflicts: readonly ConflictDto[]
  /** Plain lines above the block that the block covers. */
  shadowed: number
  commentShadowed: boolean
  onToggleShadowed: () => void
  onApply: () => Promise<WriteResult>
  onClose: () => void
}

/**
 * The last thing the user sees before the password prompt. It shows exactly what apply will
 * write, so the decision to authorise a root write is made on evidence, not on trust.
 */
/** Remembered for the session so reopening the preview keeps the layout the user chose. */
let lastLayout: DiffLayout = 'unified'

export function ApplyPreview({
  hostsPath,
  diff,
  conflicts,
  shadowed,
  commentShadowed,
  onToggleShadowed,
  onApply,
  onClose,
}: Props) {
  const [wholeFile, setWholeFile] = useState(false)
  const [layout, setLayoutState] = useState<DiffLayout>(lastLayout)
  const setLayout = (l: DiffLayout) => {
    lastLayout = l
    setLayoutState(l)
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const { added, removed } = countChanges(diff)
  const nothing = added + removed === 0

  useDimmedWindowControls()
  useEffect(() => panel.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await onApply()
      if (r.ok) onClose()
      else setError(r.cancelled ? 'Cancelled. Nothing was written.' : (r.message ?? 'Write failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="apply-preview-title"
        tabIndex={-1}
        className={cn(
          'flex max-h-full w-full flex-col rounded-lg border bg-background shadow-2xl outline-none',
          // Side by side needs the room: two hosts lines next to each other.
          layout === 'split' ? 'max-w-[1400px]' : 'max-w-[960px]',
        )}
      >
        <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
          <div className="min-w-0">
            <h2 id="apply-preview-title" className="text-[13px] font-semibold">
              Preview changes
            </h2>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{hostsPath}</p>
          </div>
          <span className="ml-auto font-mono text-[12px]">
            <span className="text-diff-add">+{added.toLocaleString()}</span>{' '}
            <span className="text-diff-remove">−{removed.toLocaleString()}</span>
          </span>
          <IconButton aria-label="Close" onClick={onClose} disabled={busy}>
            <X className="size-4" />
          </IconButton>
        </div>

        {conflicts.length > 0 && (
          <div className="shrink-0 border-b px-4 py-2 text-[12px]">
            <p className="mb-1 font-medium">
              {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'} resolved by stack order
            </p>
            {conflicts.map((c) => (
              <div key={c.hostname} className="text-muted-foreground">
                <span className="font-mono text-foreground">{c.hostname}</span> resolves to{' '}
                <span className="font-mono text-foreground">{c.winner.ip}</span> from{' '}
                {c.winner.packageName}, overriding {c.losers.map((l) => l.packageName).join(', ')}
              </div>
            ))}
          </div>
        )}

        {shadowed > 0 && (
          <label className="flex shrink-0 cursor-pointer items-start gap-2.5 border-b px-4 py-2.5 text-[12px]">
            <span className="pt-0.5">
              <Checkbox checked={commentShadowed} onChange={onToggleShadowed} />
            </span>
            <span>
              <span className="font-medium">
                Comment out {shadowed} line{shadowed === 1 ? '' : 's'} above the block that it
                already covers.
              </span>{' '}
              <span className="text-muted-foreground">
                Resolvers use the first match, so those lines would otherwise override the block.
                They are put back, unchanged, as soon as the block stops covering them.
              </span>
            </span>
          </label>
        )}

        <div className="min-h-0 flex-1 overflow-auto py-1">
          {nothing ? (
            <p className="px-4 py-10 text-center text-[12px] text-muted-foreground">
              The file already matches the active stack. Nothing to apply.
            </p>
          ) : (
            <DiffView diff={diff} layout={layout} wholeFile={wholeFile} />
          )}
        </div>

        <div className="flex h-12 shrink-0 items-center gap-3 border-t px-4">
          <Segmented
            label="Layout"
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'unified', label: 'Unified', icon: <Rows3 className="size-3.5" /> },
              { value: 'split', label: 'Side by side', icon: <Columns2 className="size-3.5" /> },
            ]}
          />
          <Segmented
            label="Scope"
            value={wholeFile ? 'whole' : 'changes'}
            onChange={(v) => setWholeFile(v === 'whole')}
            options={[
              { value: 'changes', label: 'Changes only' },
              { value: 'whole', label: 'Whole file' },
            ]}
          />
          {error && <span className="text-[12px] text-destructive">{error}</span>}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void apply()} disabled={busy || nothing}>
              {busy ? 'Working…' : 'Apply to hosts file'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; icon?: React.ReactNode }[]
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-[12px] text-muted-foreground',
            'transition-colors hover:text-foreground',
            value === o.value && 'bg-secondary text-foreground',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}
