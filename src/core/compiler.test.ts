import { describe, it, expect } from 'vitest'
import { compile } from './compiler.js'
import type { HostRecord, Package } from './types.js'

const ts = '2026-01-01T00:00:00.000Z'
const rec = (id: string, ip: string, ...hostnames: string[]): HostRecord =>
  ({ id, ip, hostnames, tags: [], createdAt: ts, updatedAt: ts }) as HostRecord
const pkg = (id: string, name: string, ...entries: [string, boolean][]): Package =>
  ({
    id,
    name,
    mode: 'managed',
    entries: entries.map(([recordId, enabled]) => ({ recordId, enabled })),
  }) as Package

describe('compile', () => {
  it('returns nothing for an empty stack', () =>
    expect(compile([], [], [])).toEqual({ lines: [], conflicts: [] }))

  it('skips disabled entries', () =>
    expect(
      compile([rec('r1', '1.2.3.4', 'a.test')], [pkg('p1', 'P', ['r1', false])], ['p1']).lines,
    ).toEqual([]))

  it('emits in stack order, one hostname per line', () => {
    const lib = [
      rec('r1', '127.0.0.1', 'ads.tracker.com'),
      rec('r2', '10.0.4.12', 'api.acme.test', 'auth.acme.test'),
    ]
    const pkgs = [
      pkg('p1', 'base-blocklist', ['r1', true]),
      pkg('p2', 'acme-staging', ['r2', true]),
    ]
    const { lines, conflicts } = compile(lib, pkgs, ['p1', 'p2'])
    expect(conflicts).toEqual([])
    expect(lines).toEqual([
      '# do not edit by hand',
      '# stack: base-blocklist, acme-staging',
      '',
      '# --- base-blocklist ---',
      '127.0.0.1       ads.tracker.com                # base-blocklist',
      '',
      '# --- acme-staging ---',
      '10.0.4.12       api.acme.test                  # acme-staging',
      '10.0.4.12       auth.acme.test                 # acme-staging',
    ])
  })

  it('later package wins and the loser is commented with attribution', () => {
    const lib = [rec('r1', '127.0.0.1', 'api.acme.test'), rec('r2', '10.0.4.12', 'api.acme.test')]
    const pkgs = [
      pkg('p1', 'base-blocklist', ['r1', true]),
      pkg('p2', 'acme-staging', ['r2', true]),
    ]
    const { lines, conflicts } = compile(lib, pkgs, ['p1', 'p2'])
    expect(lines.slice(3)).toEqual([
      '# --- acme-staging ---',
      '10.0.4.12       api.acme.test                  # acme-staging',
      '# 127.0.0.1     api.acme.test                  # base-blocklist (overridden by acme-staging)',
    ])
    expect(conflicts).toEqual([
      {
        hostname: 'api.acme.test',
        winner: { ip: '10.0.4.12', packageName: 'acme-staging' },
        losers: [{ ip: '127.0.0.1', packageName: 'base-blocklist' }],
      },
    ])
  })

  it('reordering the stack flips the winner', () => {
    const lib = [rec('r1', '127.0.0.1', 'api.acme.test'), rec('r2', '10.0.4.12', 'api.acme.test')]
    const pkgs = [
      pkg('p1', 'base-blocklist', ['r1', true]),
      pkg('p2', 'acme-staging', ['r2', true]),
    ]
    expect(compile(lib, pkgs, ['p2', 'p1']).conflicts[0]!.winner).toEqual({
      ip: '127.0.0.1',
      packageName: 'base-blocklist',
    })
  })

  it('same hostname AND same ip is a duplicate, not a conflict', () => {
    const lib = [rec('r1', '10.0.4.12', 'api.acme.test'), rec('r2', '10.0.4.12', 'api.acme.test')]
    const { lines, conflicts } = compile(
      lib,
      [pkg('p1', 'A', ['r1', true]), pkg('p2', 'B', ['r2', true])],
      ['p1', 'p2'],
    )
    expect(conflicts).toEqual([])
    expect(lines.slice(3)).toEqual([
      '# --- B ---',
      '10.0.4.12       api.acme.test                  # B',
    ])
  })

  it('ignores full-file packages found in the stack', () => {
    const full = {
      id: 'p2',
      name: 'F',
      mode: 'full-file',
      rawContent: 'x',
    } as unknown as Package
    const { lines } = compile(
      [rec('r1', '1.2.3.4', 'a.test')],
      [pkg('p1', 'A', ['r1', true]), full],
      ['p1', 'p2'],
    )
    expect(lines[1]).toBe('# stack: A')
  })

  it('ignores dangling record references instead of throwing', () =>
    expect(compile([], [pkg('p1', 'A', ['missing', true])], ['p1']).lines).toEqual([]))

  it('ignores a package id that is not in the stack', () => {
    const lib = [rec('r1', '1.2.3.4', 'a.test')]
    expect(compile(lib, [pkg('p1', 'A', ['r1', true])], []).lines).toEqual([])
  })

  it('ignores a stack id with no matching package', () =>
    expect(compile([], [], ['ghost']).lines).toEqual([]))

  it('is deterministic across calls', () => {
    const lib = [rec('r1', '127.0.0.1', 'a.test'), rec('r2', '10.0.4.12', 'a.test', 'b.test')]
    const pkgs = [pkg('p1', 'A', ['r1', true]), pkg('p2', 'B', ['r2', true])]
    expect(compile(lib, pkgs, ['p1', 'p2'])).toEqual(compile(lib, pkgs, ['p1', 'p2']))
  })

  it('an over-long IPv6 address does not shift the other lines', () => {
    const lib = [
      rec('r1', '2001:db8:85a3:8d3:1319:8a2e:370:7348', 'long.test'),
      rec('r2', '1.2.3.4', 'short.test'),
    ]
    const { lines } = compile(lib, [pkg('p1', 'A', ['r1', true], ['r2', true])], ['p1'])
    expect(lines[5]).toBe('1.2.3.4         short.test                     # A')
  })

  it('records several losers for one hostname', () => {
    const lib = [
      rec('r1', '1.1.1.1', 'x.test'),
      rec('r2', '2.2.2.2', 'x.test'),
      rec('r3', '3.3.3.3', 'x.test'),
    ]
    const pkgs = [
      pkg('p1', 'A', ['r1', true]),
      pkg('p2', 'B', ['r2', true]),
      pkg('p3', 'C', ['r3', true]),
    ]
    const { conflicts } = compile(lib, pkgs, ['p1', 'p2', 'p3'])
    expect(conflicts[0]!.winner.packageName).toBe('C')
    expect(conflicts[0]!.losers.map((l) => l.packageName)).toEqual(['A', 'B'])
  })
})
