// SPDX-License-Identifier: MIT

import { findManagedBlock } from './managed-block.js'
import { parse, type HostsDocument, type HostsLine } from './parser.js'

/**
 * Prefix for a line hostserrer commented out because the managed block covers it. The original
 * line follows verbatim, so it can be put back byte-for-byte. This is a released file format,
 * like the markers: changing it orphans lines already commented on disk.
 */
export const MOVED_PREFIX = '# hostserrer moved: '

export interface ReconcileResult {
  doc: HostsDocument
  /** Raw lines commented out by this pass. */
  moved: string[]
  /** Raw lines put back by this pass. */
  restored: string[]
}

/** Every hostname the block resolves, taken from the compiled block body. */
export function coveredHostnames(blockLines: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const l of parse(blockLines.join('\n')).lines)
    if (l.kind === 'entry') for (const h of l.hostnames) out.add(h)
  return out
}

/**
 * Resolvers take the first line that matches a hostname, so a plain entry above the managed
 * block silently defeats whatever the block says about that hostname. This pass comments out
 * such lines — only entries whose every hostname the block covers, and only outside the block —
 * and puts back any line it commented earlier once the block no longer covers it. Switching
 * every package off therefore returns the file to exactly what it was.
 *
 * Pass an empty `covered` set to restore everything and comment out nothing.
 */
export function reconcileShadowedLines(
  doc: HostsDocument,
  covered: ReadonlySet<string>,
): ReconcileResult {
  const block = findManagedBlock(doc)
  const inside = (i: number) => block !== null && i >= block.begin && i <= block.end
  const moved: string[] = []
  const restored: string[] = []

  const lines = doc.lines.map((l, i): HostsLine => {
    if (inside(i)) return l
    if (l.kind === 'entry' && l.hostnames.every((h) => covered.has(h))) {
      moved.push(l.raw)
      return { kind: 'comment', raw: MOVED_PREFIX + l.raw, eol: l.eol }
    }
    if (l.kind === 'comment' && l.raw.startsWith(MOVED_PREFIX)) {
      const original = l.raw.slice(MOVED_PREFIX.length)
      const back = parse(original).lines[0]
      // Still fully covered: stays commented. Anything else — including a line that no longer
      // parses as an entry — goes back as it was, since we only ever comment out entries.
      if (back?.kind === 'entry' && back.hostnames.every((h) => covered.has(h))) return l
      restored.push(original)
      return { ...(back ?? { kind: 'unknown', raw: original }), raw: original, eol: l.eol }
    }
    return l
  })

  return { doc: { ...doc, lines }, moved, restored }
}
