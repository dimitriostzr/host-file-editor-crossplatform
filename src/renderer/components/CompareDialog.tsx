// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { WriteResult } from '../env.js'
import { countChanges, diffLines } from '../lib/diff.js'
import { Button, ErrorText, IconButton, useDimmedWindowControls } from './ui.js'
import { DiffView } from './DiffView.js'

/**
 * What writing `after` over the file as it is (`before`) would change, with the action that
 * does it. Used for restoring a backup.
 */
export function CompareDialog({
  title,
  subtitle,
  before,
  after,
  actionLabel,
  onAction,
  onClose,
}: {
  title: string
  subtitle: string
  before: string
  after: string
  actionLabel: string
  onAction: () => Promise<WriteResult>
  onClose: () => void
}) {
  const [wholeFile, setWholeFile] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const diff = useMemo(() => diffLines(before, after), [before, after])
  const { added, removed } = countChanges(diff)
  useDimmedWindowControls()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const act = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await onAction()
      if (r.ok) onClose()
      else setError(r.cancelled ? 'Cancelled. Nothing was written.' : (r.message ?? 'Failed'))
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-title"
        className="flex max-h-full w-full max-w-[960px] flex-col rounded-lg border bg-background shadow-2xl"
      >
        <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
          <div className="min-w-0">
            <h2 id="compare-title" className="text-[13px] font-semibold">
              {title}
            </h2>
            <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
          </div>
          <span className="ml-auto font-mono text-[12px]">
            <span className="text-diff-add">+{added.toLocaleString()}</span>{' '}
            <span className="text-diff-remove">−{removed.toLocaleString()}</span>
          </span>
          <IconButton aria-label="Close" onClick={onClose} disabled={busy}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {added + removed === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
              This backup is identical to the file as it is now.
            </p>
          ) : (
            <DiffView diff={diff} layout="unified" wholeFile={wholeFile} />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t px-4 py-3">
          <Button variant="ghost" className="h-7" onClick={() => setWholeFile((w) => !w)}>
            {wholeFile ? 'Changes only' : 'Whole file'}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <ErrorText>{error}</ErrorText>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void act()}
              disabled={busy || added + removed === 0}
            >
              {busy ? 'Working…' : actionLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
