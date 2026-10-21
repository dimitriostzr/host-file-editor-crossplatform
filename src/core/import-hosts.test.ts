import { describe, it, expect } from 'vitest'
import { extractRecords, SYSTEM_HOSTNAMES } from './import-hosts.js'
import { HostRecordSchema } from './types.js'
import { BEGIN_MARKER as B, END_MARKER as E } from './markers.js'

const linux = [
  '127.0.0.1\tlocalhost',
  '127.0.1.1\tworkstation',
  '',
  '::1     ip6-localhost ip6-loopback',
  'fe00::0 ip6-localnet',
  'ff00::0 ip6-mcastprefix',
  '',
  '# Added by Docker Desktop',
  '192.168.65.2 host.docker.internal',
  '192.168.65.2 gateway.docker.internal',
  '',
].join('\n')

describe('extractRecords', () => {
  it('imports nothing from a pristine macOS hosts file', () => {
    const macos =
      '##\n# Host Database\n##\n127.0.0.1\tlocalhost\n255.255.255.255\tbroadcasthost\n::1             localhost\n'
    const r = extractRecords(macos)
    expect(r.records).toEqual([])
    expect(r.skippedSystem).toBe(3)
  })

  it('imports the real entries and skips the system ones', () => {
    const r = extractRecords(linux)
    expect(r.records.map((x) => x.hostnames)).toEqual([
      ['workstation'],
      ['host.docker.internal'],
      ['gateway.docker.internal'],
    ])
    expect(r.skippedSystem).toBe(4)
  })

  it('never imports a system hostname, whatever the IP', () =>
    expect(extractRecords('10.0.0.5 localhost\n').records).toEqual([]))

  it('keeps the non-system hostnames from a mixed line', () =>
    expect(extractRecords('10.0.0.5 localhost myapp.test\n').records[0]!.hostnames).toEqual([
      'myapp.test',
    ]))

  it('skips lines inside an existing managed block, so re-import never duplicates', () => {
    const text = `1.2.3.4 outside.test\n\n${B}\n5.6.7.8 inside.test\n${E}\n`
    const r = extractRecords(text)
    expect(r.records.map((x) => x.hostnames)).toEqual([['outside.test']])
    expect(r.skippedManaged).toBe(1)
  })

  it('carries the inline comment across', () =>
    expect(extractRecords('1.2.3.4 vpn.test # corporate gateway\n').records[0]!.comment).toBe(
      'corporate gateway',
    ))

  it('produces schema-valid records', () => {
    const rec = extractRecords(linux).records[0]!
    expect(rec.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(rec.tags).toEqual([])
    expect(rec.createdAt).toBe(rec.updatedAt)
  })

  it('ignores comments, blanks and unparseable lines', () =>
    expect(extractRecords('# just a comment\n\n!!! garbage\n127.0.0.1\n').records).toEqual([]))
})

describe('validation and rejection reporting', () => {
  it('rejects a name the schema refuses, and reports the line', () => {
    const r = extractRecords(`1.2.3.4 ${'a'.repeat(64)}.test\n`)
    expect(r.records).toEqual([])
    expect(r.rejected).toHaveLength(1)
    expect(r.rejected[0]!.line).toContain('a'.repeat(64))
    expect(r.rejected[0]!.reason).toMatch(/hostname/i)
  })
  it('rejects a label ending in a dash rather than poisoning the library', () => {
    const r = extractRecords('1.2.3.4 build-server-.corp\n')
    expect(r.records).toEqual([])
    expect(r.rejected).toHaveLength(1)
  })
  it('keeps the good lines when one line is bad', () => {
    const r = extractRecords(`1.2.3.4 good.test\n5.6.7.8 ${'a'.repeat(64)}.test\n`)
    expect(r.records.map((x) => x.hostnames)).toEqual([['good.test']])
    expect(r.rejected).toHaveLength(1)
  })
  it('every returned record passes HostRecordSchema', () => {
    const r = extractRecords('1.2.3.4 a.test\n5.6.7.8 b.test\n')
    for (const rec of r.records) expect(HostRecordSchema.safeParse(rec).success).toBe(true)
  })
  it('normalises a trailing root dot and still excludes system names', () => {
    const r = extractRecords('127.0.0.1 localhost.\n1.2.3.4 db.internal.\n')
    expect(r.skippedSystem).toBe(1)
    expect(r.records.map((x) => x.hostnames)).toEqual([['db.internal']])
  })
  it('reports an empty rejected list when everything is clean', () =>
    expect(extractRecords('1.2.3.4 a.test\n').rejected).toEqual([]))
})

describe('SYSTEM_HOSTNAMES', () => {
  it('covers the macOS and Linux defaults', () => {
    for (const h of [
      'localhost',
      'broadcasthost',
      'ip6-localhost',
      'ip6-loopback',
      'ip6-localnet',
      'ip6-mcastprefix',
    ])
      expect(SYSTEM_HOSTNAMES.has(h)).toBe(true)
  })
})

describe('commented-out entries', () => {
  const text = [
    '1.1.1.1 live.test',
    '# 2.2.2.2 parked.test www.parked.test',
    '#3.3.3.3 tight.test # note',
    '# 127.0.0.1 localhost is loopback',
    '# hostserrer moved: 4.4.4.4 moved.test',
    '# just words here',
  ].join('\n')
  it('imports them as records and reports them as disabled', () => {
    const r = extractRecords(text)
    expect(r.records.map((x) => x.hostnames)).toEqual([
      ['live.test'],
      ['parked.test', 'www.parked.test'],
      ['tight.test'],
    ])
    const off = r.records.filter((x) => r.disabled.includes(x.id)).map((x) => x.ip)
    expect(off).toEqual(['2.2.2.2', '3.3.3.3'])
  })
  it('keeps the inline comment of a commented-out entry', () =>
    expect(extractRecords(text).records[2]!.comment).toBe('note'))
  it('never imports a commented line that names a system host, or one hostserrer moved', () => {
    const ips = extractRecords(text).records.map((x) => x.ip)
    expect(ips).not.toContain('127.0.0.1')
    expect(ips).not.toContain('4.4.4.4')
  })
})
