// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from 'react'
import { FileText, X } from 'lucide-react'
import type { ImportTextResult } from '../env.js'
import { cn } from '../lib/cn.js'
import { Button, ErrorText, Field, IconButton, Input, useDimmedWindowControls } from './ui.js'

/** Beyond this a pasted text is held as a file rather than shown in the text box. */
const INLINE_LIMIT = 200_000

const countLines = (s: string): number => (s === '' ? 0 : s.split('\n').length)

/**
 * Bring in lines from another hosts file or a blocklist, pasted or from a file. They become a
 * new package, switched off, so nothing is written until the user switches it on and applies.
 */
export function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: (r: Extract<ImportTextResult, { ok: true }>, packageName: string) => void
}) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [name, setName] = useState(`Imported ${new Date().toISOString().slice(0, 10)}`)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  useDimmedWindowControls()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const source = file?.text ?? text
  const lines = countLines(source.trimEnd())

  const load = async (f: File) => {
    setError(null)
    if (f.size > 64_000_000) {
      setError('That file is larger than 64 MB.')
      return
    }
    setFile({ name: f.name, text: await f.text() })
    if (name.startsWith('Imported ')) setName(f.name.replace(/\.(txt|hosts)$/i, ''))
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await window.hostserrer.importText({ text: source, packageName: name })
      if (r.ok) onImported(r, name.trim())
      else setError(r.message)
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
        aria-labelledby="import-title"
        className="flex max-h-full w-full max-w-[640px] flex-col rounded-lg border bg-background shadow-2xl"
      >
        <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
          <h2 id="import-title" className="text-[13px] font-semibold">
            Import hosts lines
          </h2>
          <IconButton className="ml-auto" aria-label="Close" onClick={onClose} disabled={busy}>
            <X className="size-4" />
          </IconButton>
        </div>

        <div className="space-y-3 overflow-y-auto px-4 py-3">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Paste lines from another hosts file or a blocklist in hosts format, or drop a file here.
            They become a new package, switched off, so nothing changes until you switch it on and
            apply.
          </p>

          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              const f = e.dataTransfer.files[0]
              if (f) void load(f)
            }}
            className={cn('rounded-md', dragging && 'outline-2 outline-ring outline-dashed')}
          >
            {file ? (
              <div className="flex h-40 items-center justify-center gap-3 rounded-md border bg-secondary/40 text-[13px]">
                <FileText className="size-5 text-muted-foreground" aria-hidden="true" />
                <div>
                  <div className="font-medium">{file.name}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {lines.toLocaleString()} line{lines === 1 ? '' : 's'}
                  </div>
                </div>
                <Button variant="ghost" className="h-7" onClick={() => setFile(null)}>
                  Clear
                </Button>
              </div>
            ) : (
              <textarea
                autoFocus
                value={text}
                onChange={(e) => {
                  const v = e.target.value
                  // A huge paste is held like a file: a multi-megabyte controlled text box lags.
                  if (v.length > INLINE_LIMIT) {
                    setFile({ name: 'Pasted text', text: v })
                    setText('')
                  } else setText(v)
                }}
                spellCheck={false}
                placeholder={
                  '0.0.0.0        ads.example.com\n10.0.4.12      api.acme.test   # staging'
                }
                className="h-40 w-full resize-none rounded-md border border-input bg-background p-2.5 font-mono text-[12.5px] placeholder:text-muted-foreground/60 focus-visible:outline-2 focus-visible:outline-ring"
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" className="h-7" onClick={() => picker.current?.click()}>
              Choose a file…
            </Button>
            <input
              ref={picker}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void load(f)
                e.target.value = ''
              }}
            />
            {!file && lines > 0 && (
              <span className="text-[12px] text-muted-foreground">
                {lines.toLocaleString()} line{lines === 1 ? '' : 's'}
              </span>
            )}
          </div>

          <Field
            label="Package name"
            hint="Records already in your library are reused, not duplicated. Commented-out lines come in switched off."
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <ErrorText>{error}</ErrorText>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={busy || lines === 0 || !name.trim()}
          >
            {busy ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </div>
    </div>
  )
}
