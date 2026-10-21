import { describe, it, expect } from 'vitest'
import { compareIp, compareText, sortBy } from './sort.js'

describe('compareIp', () => {
  it('orders IPv4 numerically, not as text', () => {
    const ips = ['10.0.0.10', '10.0.0.9', '9.9.9.9', '192.168.1.1']
    expect([...ips].sort(compareIp)).toEqual(['9.9.9.9', '10.0.0.9', '10.0.0.10', '192.168.1.1'])
  })
  it('puts IPv6 after IPv4 and orders it by text', () => {
    expect(['::1', '10.0.0.1', 'fe80::1'].sort(compareIp)).toEqual(['10.0.0.1', '::1', 'fe80::1'])
  })
})

describe('sortBy', () => {
  const items = [
    { n: 'b', v: 1 },
    { n: 'a', v: 2 },
    { n: 'c', v: 1 },
  ]
  const cmp = {
    n: (a: (typeof items)[0], b: (typeof items)[0]) => compareText(a.n, b.n),
    v: (a: (typeof items)[0], b: (typeof items)[0]) => a.v - b.v,
  }
  it('returns the stored order with no sort', () => expect(sortBy(items, null, cmp)).toEqual(items))
  it('sorts ascending and descending', () => {
    expect(sortBy(items, { key: 'n', dir: 'asc' }, cmp).map((x) => x.n)).toEqual(['a', 'b', 'c'])
    expect(sortBy(items, { key: 'n', dir: 'desc' }, cmp).map((x) => x.n)).toEqual(['c', 'b', 'a'])
  })
  it('is stable for equal keys', () =>
    expect(sortBy(items, { key: 'v', dir: 'asc' }, cmp).map((x) => x.n)).toEqual(['b', 'c', 'a']))
})
