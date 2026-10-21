// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { HostRecordDto } from '../env.js'
import { Button, ErrorText, IconButton, Input } from './ui.js'

const splitHosts = (s: string): string[] => s.split(/[\s,]+/).filter(Boolean)

export interface RecordFormValues {
  ip: string
  hostnames: string[]
  comment?: string
}

/**
 * Add or edit a record, laid out as a table row so the fields line up with the columns. The
 * library's table has a "Used in" column after the note; a package's table has its switch
 * column first. Both are five columns wide.
 *
 * Validation is live and comes from the same validator that saves, so what the form says
 * matches what the app will do — and a stale error can never outlive the input that caused it.
 */
export function RecordFormRow({
  layout,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  layout: 'library' | 'package'
  initial?: HostRecordDto
  submitLabel: string
  onSubmit: (v: RecordFormValues) => Promise<{ ok: boolean; message?: string }>
  onCancel: () => void
}) {
  const [ip, setIp] = useState(initial?.ip ?? '')
  const [hosts, setHosts] = useState(initial?.hostnames.join(' ') ?? '')
  const [comment, setComment] = useState(initial?.comment ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const payload = (): RecordFormValues => ({
    ip: ip.trim(),
    hostnames: splitHosts(hosts),
    ...(comment.trim() ? { comment: comment.trim() } : {}),
  })
  const complete = ip.trim() !== '' && hosts.trim() !== ''

  useEffect(() => {
    if (!complete) {
      setError(null)
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      const r = await window.hostserrer.validateRecord(payload())
      if (!cancelled) setError(r.ok ? null : r.message)
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ip, hosts, comment])

  const submit = async () => {
    if (!complete || error) return
    setSaving(true)
    const r = await onSubmit(payload())
    if (!r.ok) setError(r.message ?? 'Could not save')
    setSaving(false)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void submit()
    if (e.key === 'Escape') onCancel()
  }

  return (
    <>
      <tr className="bg-secondary/40">
        {layout === 'package' && <td />}
        <td className={layout === 'library' ? 'px-4 py-2 align-top' : 'px-2 py-2 align-top'}>
          <Input
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            onKeyDown={onKey}
            placeholder="10.0.4.12"
            autoFocus
            className="font-mono"
            aria-label="IP address"
            aria-invalid={!!error}
          />
        </td>
        <td className="px-2 py-2 align-top">
          <Input
            value={hosts}
            onChange={(e) => setHosts(e.target.value)}
            onKeyDown={onKey}
            placeholder="api.acme.test auth.acme.test"
            className="font-mono"
            aria-label="Hostnames"
          />
        </td>
        <td className="px-2 py-2 align-top">
          <Input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={onKey}
            placeholder="Optional note"
            aria-label="Note"
          />
        </td>
        {layout === 'library' && <td />}
        <td className="px-2 py-2 text-right align-top">
          <span className="inline-flex gap-1">
            <Button
              variant="primary"
              onClick={() => void submit()}
              disabled={saving || !complete || !!error}
            >
              {submitLabel}
            </Button>
            <IconButton aria-label="Cancel" title="Cancel" onClick={onCancel}>
              <X className="size-4" />
            </IconButton>
          </span>
        </td>
      </tr>
      <tr className="bg-secondary/40">
        <td colSpan={5} className="px-4 pb-2">
          {error ? (
            <ErrorText>{error}</ErrorText>
          ) : (
            <span className="text-[11px] text-muted-foreground/80">
              Several hostnames can share one line — separate them with spaces.
            </span>
          )}
        </td>
      </tr>
    </>
  )
}
