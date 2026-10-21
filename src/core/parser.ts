// SPDX-License-Identifier: MIT

import { isIP } from 'node:net'
import { BEGIN_MARKER, END_MARKER } from './markers.js'

export type HostsLine =
  | {
      kind: 'entry'
      raw: string
      eol: string
      ip: string
      hostnames: string[]
      /** Declared as `| undefined` rather than optional, for exactOptionalPropertyTypes. */
      comment: string | undefined
    }
  | { kind: 'comment'; raw: string; eol: string }
  | { kind: 'blank'; raw: string; eol: string }
  | { kind: 'marker'; raw: string; eol: string; marker: 'begin' | 'end' }
  | { kind: 'unknown'; raw: string; eol: string }

export interface HostsDocument {
  lines: HostsLine[]
  /** The dominant terminator, used for lines we insert. Existing lines keep their own. */
  eol: '\n' | '\r\n'
}

const LINE_RE = /([^\r\n]*)(\r\n|\n|\r|$)/g

export function parse(text: string): HostsDocument {
  const lines: HostsLine[] = []
  let crlf = 0
  let lf = 0
  LINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LINE_RE.exec(text)) !== null) {
    const raw = m[1] ?? ''
    const eol = m[2] ?? ''
    if (eol === '\r\n') crlf++
    else if (eol === '\n') lf++
    lines.push(classify(raw, eol))
    if (eol === '') break
    if (LINE_RE.lastIndex === text.length) {
      lines.push(classify('', '')) // sentinel: the file ended with a newline
      break
    }
  }
  return { lines, eol: crlf > lf ? '\r\n' : '\n' }
}

function classify(raw: string, eol: string): HostsLine {
  const trimmed = raw.trim()
  if (trimmed === '') return { kind: 'blank', raw, eol }
  if (trimmed === BEGIN_MARKER) return { kind: 'marker', raw, eol, marker: 'begin' }
  if (trimmed === END_MARKER) return { kind: 'marker', raw, eol, marker: 'end' }
  if (trimmed.startsWith('#')) return { kind: 'comment', raw, eol }

  const hash = raw.indexOf('#')
  const body = (hash === -1 ? raw : raw.slice(0, hash)).trim()
  // body is already trimmed and non-empty, so split cannot yield an empty token here.
  const tokens = body.split(/\s+/)
  const ip = tokens[0]
  if (tokens.length >= 2 && ip !== undefined && isIP(ip) !== 0) {
    const comment = hash === -1 ? undefined : raw.slice(hash + 1).trim() || undefined
    return {
      kind: 'entry',
      raw,
      eol,
      ip,
      hostnames: tokens.slice(1).map((h) => h.toLowerCase()),
      comment,
    }
  }
  return { kind: 'unknown', raw, eol }
}

/** Byte-identical inverse of parse(), because every line carries its own terminator. */
export const serialize = (doc: HostsDocument): string =>
  doc.lines.map((l) => l.raw + l.eol).join('')
