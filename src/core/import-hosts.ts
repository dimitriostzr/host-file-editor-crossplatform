// SPDX-License-Identifier: MIT

import { randomUUID } from 'node:crypto'
import { parse, type HostsLine } from './parser.js'
import { MOVED_PREFIX } from './shadowed.js'
import { HostRecordSchema } from './types.js'
import type { HostRecord } from './types.js'

/**
 * Entries the operating system depends on. Never imported: if `127.0.0.1 localhost` lived in a
 * package, deactivating that package would remove localhost from the machine.
 */
export const SYSTEM_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  'localhost.localdomain',
  'broadcasthost',
  'ip6-localhost',
  'ip6-loopback',
  'ip6-localnet',
  'ip6-mcastprefix',
  'ip6-allnodes',
  'ip6-allrouters',
  'ip6-allhosts',
])

export interface ImportRejection {
  line: string
  reason: string
}

export interface ImportResult {
  records: HostRecord[]
  /**
   * Ids of records that came from commented-out lines (`# 1.2.3.4 a.test`). They belong in
   * the library, switched off, so a mapping the user parked with a `#` is not lost.
   */
  disabled: string[]
  /** Entry lines skipped because every hostname on them was a system name. */
  skippedSystem: number
  /** Entry lines skipped because they sat inside our own managed block. */
  skippedManaged: number
  /** Lines that parsed as entries but failed record validation. Reported, never silent. */
  rejected: ImportRejection[]
}

export function extractRecords(hostsText: string, now: Date = new Date()): ImportResult {
  const stamp = now.toISOString()
  const records: HostRecord[] = []
  const disabled: string[] = []
  const rejected: ImportRejection[] = []
  let skippedSystem = 0
  let skippedManaged = 0
  let insideManaged = false

  for (const raw of parse(hostsText).lines) {
    if (raw.kind === 'marker') {
      insideManaged = raw.marker === 'begin'
      continue
    }
    const commented = raw.kind === 'comment' ? uncomment(raw) : null
    const line = commented ?? raw
    if (line.kind !== 'entry') continue
    if (insideManaged) {
      skippedManaged++
      continue
    }

    // Normalise the trailing root dot before the system check, or `localhost.` slips through.
    const normalised = line.hostnames.map((h) => h.replace(/\.$/, ''))
    const hostnames = normalised.filter((h) => !SYSTEM_HOSTNAMES.has(h))
    if (hostnames.length === 0) {
      skippedSystem++
      continue
    }
    // A commented line naming a system host is prose ("# 127.0.0.1 localhost is loopback") or
    // a parked system entry. Either way it is not a record.
    if (commented && hostnames.length !== normalised.length) continue

    // Validate every candidate. The schema is stricter than a hosts file in three ways, and an
    // unvalidated record reaching library.json would fail the whole file on the next launch,
    // costing the user their entire library. Rejects are reported, never dropped silently.
    const parsed = HostRecordSchema.safeParse({
      id: randomUUID(),
      ip: line.ip,
      hostnames,
      ...(line.comment === undefined ? {} : { comment: line.comment }),
      tags: [],
      createdAt: stamp,
      updatedAt: stamp,
    })
    if (parsed.success) {
      records.push(parsed.data)
      if (commented) disabled.push(parsed.data.id)
    } else
      rejected.push({
        line: line.raw,
        reason: parsed.error.issues[0]?.message ?? 'invalid record',
      })
  }

  return { records, disabled, skippedSystem, skippedManaged, rejected }
}

/**
 * `# 1.2.3.4 a.test` is an entry someone switched off by hand. Strip one leading `#` and see
 * whether an entry is left. Lines hostserrer itself commented out are skipped: their records
 * are already in the library, and the line goes back when its package is switched off.
 */
function uncomment(line: HostsLine): HostsLine | null {
  if (line.raw.startsWith(MOVED_PREFIX)) return null
  const body = line.raw.replace(/^\s*#\s?/, '')
  const parsed = parse(body).lines[0]
  return parsed?.kind === 'entry' ? { ...parsed, raw: line.raw } : null
}
