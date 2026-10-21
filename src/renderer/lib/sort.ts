// SPDX-License-Identifier: MIT

import { useState } from 'react'

export type SortDir = 'asc' | 'desc'
export interface SortState<K extends string> {
  key: K
  dir: SortDir
}

/** Click cycles a column through ascending, descending, and back to the stored order. */
export function useSort<K extends string>() {
  const [sort, setSort] = useState<SortState<K> | null>(null)
  const toggle = (key: K) =>
    setSort((s) =>
      s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null,
    )
  const dirOf = (key: K): SortDir | null => (sort?.key === key ? sort.dir : null)
  return { sort, toggle, dirOf }
}

export function sortBy<T, K extends string>(
  items: readonly T[],
  sort: SortState<K> | null,
  comparators: Record<K, (a: T, b: T) => number>,
): T[] {
  if (!sort) return [...items]
  const cmp = comparators[sort.key]
  const sign = sort.dir === 'asc' ? 1 : -1
  // Array.prototype.sort is stable, so equal keys keep the stored order.
  return [...items].sort((a, b) => sign * cmp(a, b))
}

export const compareText = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

export const compareBool = (a: boolean, b: boolean): number => Number(a) - Number(b)

/** IPv4 numerically by octet, IPv6 after it by text, so 10.0.0.9 sorts before 10.0.0.10. */
export function compareIp(a: string, b: string): number {
  const ka = ipKey(a)
  const kb = ipKey(b)
  if (ka === null || kb === null) return ka === kb ? compareText(a, b) : ka === null ? 1 : -1
  for (let i = 0; i < 4; i++) {
    const d = ka[i]! - kb[i]!
    if (d !== 0) return d
  }
  return 0
}

const ipKey = (ip: string): number[] | null => {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map(Number)
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : null
}
