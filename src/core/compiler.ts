// SPDX-License-Identifier: MIT

import { sectionHeader } from './markers.js'
import type { HostRecord, Package } from './types.js'

/**
 * Fixed column widths. Never computed from content: dynamic alignment would reflow the whole
 * block whenever one long hostname is added, turning a small edit into a whole-block diff.
 */
const IP_COL = 15
const HOST_COL = 30

export interface Conflict {
  hostname: string
  winner: { ip: string; packageName: string }
  losers: { ip: string; packageName: string }[]
}

export interface CompileResult {
  /** The body of the managed block, without markers. */
  lines: string[]
  conflicts: Conflict[]
}

interface Candidate {
  ip: string
  hostname: string
  packageName: string
}

export function compile(
  library: readonly HostRecord[],
  packages: readonly Package[],
  activeStack: readonly string[],
): CompileResult {
  const recordById = new Map(library.map((r) => [r.id, r]))
  const packageById = new Map(packages.map((p) => [p.id, p]))

  const candidates: Candidate[] = []
  for (const pkgId of activeStack) {
    const pkg = packageById.get(pkgId)
    if (!pkg || pkg.mode !== 'managed') continue // full-file bypasses the compiler entirely
    for (const entry of pkg.entries) {
      if (!entry.enabled) continue
      const record = recordById.get(entry.recordId)
      if (!record) continue // dangling reference: ignore rather than throw
      for (const hostname of record.hostnames) {
        candidates.push({ ip: record.ip, hostname, packageName: pkg.name })
      }
    }
  }
  if (candidates.length === 0) return { lines: [], conflicts: [] }

  // Later in the stack wins, so the last candidate for a hostname is the winner.
  const winners = new Map<string, Candidate>()
  for (const c of candidates) winners.set(c.hostname, c)

  const losersByHost = new Map<string, Candidate[]>()
  for (const c of candidates) {
    const winner = winners.get(c.hostname)!
    if (c === winner) continue
    if (c.ip === winner.ip) continue // same host, same ip: a duplicate, deduped silently
    losersByHost.set(c.hostname, [...(losersByHost.get(c.hostname) ?? []), c])
  }

  const conflicts: Conflict[] = [...losersByHost].map(([hostname, losers]) => {
    const winner = winners.get(hostname)!
    return {
      hostname,
      winner: { ip: winner.ip, packageName: winner.packageName },
      losers: losers.map((l) => ({ ip: l.ip, packageName: l.packageName })),
    }
  })

  const stackNames = activeStack
    .map((id) => packageById.get(id))
    .filter((p): p is Package => p !== undefined && p.mode === 'managed')
    .map((p) => p.name)

  const lines: string[] = ['# do not edit by hand', `# stack: ${stackNames.join(', ')}`, '']

  // Winners come out grouped by package in stack order, so each package gets one heading.
  let section: string | null = null
  for (const c of candidates) {
    if (winners.get(c.hostname) !== c) continue
    if (c.packageName !== section) {
      if (section !== null) lines.push('')
      lines.push(sectionHeader(c.packageName))
      section = c.packageName
    }
    lines.push(`${c.ip.padEnd(IP_COL)} ${c.hostname.padEnd(HOST_COL)} # ${c.packageName}`.trimEnd())
    for (const l of losersByHost.get(c.hostname) ?? []) {
      lines.push(
        `# ${l.ip.padEnd(IP_COL - 2)} ${l.hostname.padEnd(HOST_COL)} # ${l.packageName} (overridden by ${c.packageName})`.trimEnd(),
      )
    }
  }

  return { lines, conflicts }
}
