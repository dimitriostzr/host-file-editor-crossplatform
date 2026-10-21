import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { applyManagedBlock, compile, parse, serialize, extractRecords } from '../src/core/index.js'
import type { HostRecord, Package } from '../src/core/index.js'

// A URL relative to this module: works under Vitest/Vite, where import.meta.dirname may not.
const fixture = (n: string) =>
  readFile(fileURLToPath(new URL(`./fixtures/hosts/${n}`, import.meta.url)), 'utf8')

const ts = '2026-01-01T00:00:00.000Z'
const rec = (id: string, ip: string, ...hostnames: string[]): HostRecord =>
  ({ id, ip, hostnames, tags: [], createdAt: ts, updatedAt: ts }) as HostRecord
const pkg = (id: string, name: string, ...ids: string[]): Package =>
  ({
    id,
    name,
    mode: 'managed',
    entries: ids.map((recordId) => ({ recordId, enabled: true })),
  }) as Package

const library = [
  rec('r1', '127.0.0.1', 'ads.tracker.com'),
  rec('r2', '10.0.4.12', 'api.acme.test', 'auth.acme.test'),
  rec('r3', '10.0.9.3', 'api.acme.test'),
]
const packages = [
  pkg('p1', 'base-blocklist', 'r1'),
  pkg('p2', 'acme-staging', 'r2'),
  pkg('p3', 'prod-mirror', 'r3'),
]
const write = (text: string, stack: string[]) =>
  serialize(applyManagedBlock(parse(text), compile(library, packages, stack).lines))

describe.each([
  ['macos-default.hosts', '\n'],
  ['windows-default.hosts', '\r\n'],
  ['linux-with-docker.hosts', '\n'],
])('%s', (name, eol) => {
  it('preserves the original line endings', async () => {
    const out = write(await fixture(name), ['p1', 'p2'])
    const other = eol === '\r\n' ? /(?<!\r)\n/ : /\r\n/
    expect(other.test(out)).toBe(false)
  })

  it('leaves every original line untouched', async () => {
    const orig = await fixture(name)
    const out = write(orig, ['p1', 'p2'])
    for (const line of orig.split(/\r?\n/).filter(Boolean)) expect(out).toContain(line)
  })

  it('apply then deactivate restores the file byte-for-byte', async () => {
    const orig = await fixture(name)
    expect(write(write(orig, ['p1', 'p2']), [])).toBe(orig)
  })

  it('is idempotent — applying the same stack twice changes nothing', async () => {
    const once = write(await fixture(name), ['p1', 'p2'])
    expect(write(once, ['p1', 'p2'])).toBe(once)
  })

  it('round-trips through the parser unchanged', async () => {
    const out = write(await fixture(name), ['p1', 'p2'])
    expect(serialize(parse(out))).toBe(out)
  })
})

describe('the case managed mode exists for', () => {
  it("never destroys another tool's entries", async () => {
    const orig = await fixture('linux-with-docker.hosts')
    for (const stack of [['p1'], ['p1', 'p2'], ['p2', 'p3'], []]) {
      const out = write(orig, stack)
      expect(out).toContain('192.168.65.2 host.docker.internal')
      expect(out).toContain('192.168.65.2 gateway.docker.internal')
    }
  })
})

describe('switching environments', () => {
  it('swaps the winning IP when the stack order changes', async () => {
    const orig = await fixture('macos-default.hosts')
    // Later in the stack wins, so the LAST package named is the one that takes effect.
    const mirrorOnTop = write(orig, ['p2', 'p3'])
    const stagingOnTop = write(orig, ['p3', 'p2'])
    expect(mirrorOnTop).toContain('10.0.9.3        api.acme.test')
    expect(stagingOnTop).toContain('10.0.4.12       api.acme.test')
  })

  it('comments the loser with attribution rather than dropping it', async () => {
    const out = write(await fixture('macos-default.hosts'), ['p2', 'p3'])
    expect(out).toContain('# 10.0.4.12     api.acme.test')
    expect(out).toContain('(overridden by prod-mirror)')
  })

  it('re-parses its own output correctly', async () => {
    const out = write(await fixture('macos-default.hosts'), ['p1', 'p2'])
    const entries = parse(out).lines.filter((l) => l.kind === 'entry')
    expect(entries.some((e) => e.hostnames.includes('ads.tracker.com'))).toBe(true)
    expect(entries.some((e) => e.hostnames.includes('localhost'))).toBe(true)
  })
})

describe('import round-trip against real fixtures', () => {
  it('imports nothing importable from the stock macOS file', async () => {
    expect(extractRecords(await fixture('macos-default.hosts')).records).toEqual([])
  })
  it('imports only the non-system entries from the Linux file', async () => {
    const r = extractRecords(await fixture('linux-with-docker.hosts'))
    expect(r.records.map((x) => x.hostnames)).toEqual([
      ['workstation'],
      ['host.docker.internal'],
      ['gateway.docker.internal'],
    ])
    expect(r.rejected).toEqual([])
  })
  it('does not re-import our own managed block', async () => {
    const withBlock = write(await fixture('linux-with-docker.hosts'), ['p1', 'p2'])
    const r = extractRecords(withBlock)
    expect(r.records.map((x) => x.hostnames)).toEqual([
      ['workstation'],
      ['host.docker.internal'],
      ['gateway.docker.internal'],
    ])
    expect(r.skippedManaged).toBeGreaterThan(0)
  })
})
