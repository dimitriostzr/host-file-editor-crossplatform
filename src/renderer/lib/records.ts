// SPDX-License-Identifier: MIT

import type { HostRecordDto } from '../env.js'

/** Case-insensitive match on IP, any hostname or the note. An empty query matches everything. */
export function matchesQuery(r: HostRecordDto, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    r.ip.toLowerCase().includes(q) ||
    r.hostnames.some((h) => h.toLowerCase().includes(q)) ||
    (r.comment?.toLowerCase().includes(q) ?? false)
  )
}
