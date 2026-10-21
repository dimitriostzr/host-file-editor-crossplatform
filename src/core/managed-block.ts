// SPDX-License-Identifier: MIT

import { BEGIN_MARKER, END_MARKER } from './markers.js'
import type { HostsDocument, HostsLine } from './parser.js'

export type ManagedBlockErrorCode = 'begin-without-end' | 'end-without-begin' | 'duplicate-markers'

export class ManagedBlockError extends Error {
  constructor(
    message: string,
    readonly code: ManagedBlockErrorCode,
  ) {
    super(message)
    this.name = 'ManagedBlockError'
  }
}

export function findManagedBlock(doc: HostsDocument): { begin: number; end: number } | null {
  const begins: number[] = []
  const ends: number[] = []
  doc.lines.forEach((l, i) => {
    if (l.kind !== 'marker') return
    ;(l.marker === 'begin' ? begins : ends).push(i)
  })

  if (begins.length > 1 || ends.length > 1)
    throw new ManagedBlockError(
      'hosts file contains duplicate hostserrer markers',
      'duplicate-markers',
    )

  const begin = begins[0]
  const end = ends[0]
  if (begin === undefined && end === undefined) return null
  if (begin !== undefined && end === undefined)
    throw new ManagedBlockError('BEGIN marker without a matching END marker', 'begin-without-end')
  if (begin === undefined || end === undefined)
    throw new ManagedBlockError('END marker without a matching BEGIN marker', 'end-without-begin')
  if (end < begin)
    throw new ManagedBlockError('END marker appears before BEGIN marker', 'end-without-begin')
  return { begin, end }
}

export function applyManagedBlock(
  doc: HostsDocument,
  blockLines: readonly string[],
): HostsDocument {
  const found = findManagedBlock(doc)
  const lines = [...doc.lines]

  // An empty stack removes the block AND its markers entirely, so the file returns to a
  // pristine unmanaged state rather than keeping an empty block behind.
  if (blockLines.length === 0) {
    if (!found) return doc
    let from = found.begin
    if (from > 0 && lines[from - 1]!.kind === 'blank') from-- // also drop the separator we added
    lines.splice(from, found.end - from + 1)
    return { ...doc, lines }
  }

  const body = (raw: string): HostsLine => ({ kind: 'unknown', raw, eol: doc.eol })
  const block: HostsLine[] = [
    { kind: 'marker', raw: BEGIN_MARKER, eol: doc.eol, marker: 'begin' },
    ...blockLines.map(body),
    { kind: 'marker', raw: END_MARKER, eol: doc.eol, marker: 'end' },
  ]

  if (found) {
    lines.splice(found.begin, found.end - found.begin + 1, ...block)
    return { ...doc, lines }
  }

  // Append. A sentinel (raw '', eol '') means the file ended with a newline; insert before it.
  const last = lines[lines.length - 1]
  const hasSentinel = last !== undefined && last.raw === '' && last.eol === ''
  const at = hasSentinel ? lines.length - 1 : lines.length
  // Replace rather than mutate: `lines` is a shallow copy, so assigning to `last.eol` would
  // write through to the caller's document. The diff drawer parses once and keeps that
  // document as the 'before' side, so mutating it silently corrupts what the user is shown
  // before they authorise a root write.
  if (!hasSentinel && last !== undefined) lines[lines.length - 1] = { ...last, eol: doc.eol } // file lacked a trailing newline
  const needsGap = at > 0 && lines[at - 1]!.kind !== 'blank'
  const gap: HostsLine[] = needsGap ? [{ kind: 'blank', raw: '', eol: doc.eol }] : []
  lines.splice(at, 0, ...gap, ...block)
  if (!hasSentinel) lines.push({ kind: 'blank', raw: '', eol: '' })
  return { ...doc, lines }
}
