import { describe, it, expect } from 'vitest'
import {
  HostnameSchema,
  IpSchema,
  HostRecordSchema,
  PackageSchema,
  PackageEntrySchema,
  SettingsSchema,
  AppStateSchema,
  type Package,
} from './types.js'

const ts = '2026-01-01T00:00:00.000Z'

describe('HostnameSchema', () => {
  it('lowercases, because DNS is case-insensitive', () =>
    expect(HostnameSchema.parse('API.Acme.TEST')).toBe('api.acme.test'))
  it('trims surrounding whitespace', () =>
    expect(HostnameSchema.parse('  a.test  ')).toBe('a.test'))
  it('allows a single label', () => expect(HostnameSchema.parse('myhost')).toBe('myhost'))
  it('allows underscores — the hosts file is not DNS', () =>
    expect(HostnameSchema.parse('_dev.local')).toBe('_dev.local'))
  it('rejects a leading dash', () =>
    expect(HostnameSchema.safeParse('-bad.test').success).toBe(false))
  it('rejects embedded spaces', () => expect(HostnameSchema.safeParse('a b').success).toBe(false))
  it('rejects empty', () => expect(HostnameSchema.safeParse('').success).toBe(false))
})

describe('IpSchema', () => {
  for (const ok of ['127.0.0.1', '10.0.4.12', '::1', 'fe80::1', '2001:db8::8a2e:370:7334'])
    it(`accepts ${ok}`, () => expect(IpSchema.safeParse(ok).success).toBe(true))
  for (const bad of ['999.1.1.1', '1.2.3', '1.2.3.4.5', 'localhost', ''])
    it(`rejects ${bad || '(empty)'}`, () => expect(IpSchema.safeParse(bad).success).toBe(false))
})

describe('HostRecordSchema', () => {
  const base = {
    id: crypto.randomUUID(),
    ip: '10.0.4.12',
    hostnames: ['API.acme.test'],
    createdAt: ts,
    updatedAt: ts,
  }
  it('defaults tags to an empty array', () => expect(HostRecordSchema.parse(base).tags).toEqual([]))
  it('normalises hostnames', () =>
    expect(HostRecordSchema.parse(base).hostnames).toEqual(['api.acme.test']))
  it('requires at least one hostname', () =>
    expect(HostRecordSchema.safeParse({ ...base, hostnames: [] }).success).toBe(false))
  it('rejects a non-uuid id', () =>
    expect(HostRecordSchema.safeParse({ ...base, id: 'nope' }).success).toBe(false))
})

describe('PackageSchema', () => {
  const base = { id: crypto.randomUUID(), name: 'acme-staging', mode: 'managed' as const }
  it('defaults entries to an empty array', () =>
    expect((PackageSchema.parse(base) as Extract<Package, { mode: 'managed' }>).entries).toEqual(
      [],
    ))
  it('rejects an empty name', () =>
    expect(PackageSchema.safeParse({ ...base, name: '' }).success).toBe(false))
  it('rejects an unknown mode', () =>
    expect(PackageSchema.safeParse({ ...base, mode: 'weird' }).success).toBe(false))
})

describe('SettingsSchema', () => {
  it('supplies every default from an empty object', () => {
    const s = SettingsSchema.parse({})
    expect(s).toEqual({
      activeStack: [],
      flushDnsOnApply: true,
      commentShadowedLines: true,
      backupRetention: 50,
      autoBackup: true,
      backupDir: null,
      themeId: 'default',
      themeMode: 'system',
    })
  })
  it('rejects a negative retention', () =>
    expect(SettingsSchema.safeParse({ backupRetention: -1 }).success).toBe(false))
})

describe('HostnameSchema length boundaries', () => {
  const label63 = 'a'.repeat(63)
  it('accepts a 63-character label', () => expect(HostnameSchema.parse(label63)).toBe(label63))
  it('rejects a 64-character label', () =>
    expect(HostnameSchema.safeParse('a'.repeat(64)).success).toBe(false))
  it('accepts exactly 253 characters', () =>
    expect(
      HostnameSchema.safeParse([label63, label63, label63, 'a'.repeat(61)].join('.')).success,
    ).toBe(true))
  it('rejects 255 characters of otherwise-legal labels', () =>
    expect(HostnameSchema.safeParse([label63, label63, label63, label63].join('.')).success).toBe(
      false,
    ))
})

describe('HostnameSchema shapes', () => {
  it('normalises a trailing root dot away', () =>
    expect(HostnameSchema.parse('db.internal.')).toBe('db.internal'))
  it('rejects a leading dot', () => expect(HostnameSchema.safeParse('.a.test').success).toBe(false))
  it('rejects consecutive dots', () =>
    expect(HostnameSchema.safeParse('a..test').success).toBe(false))
  it('rejects a label ending in a dash', () =>
    expect(HostnameSchema.safeParse('foo-.test').success).toBe(false))
  it('accepts an all-numeric name', () => expect(HostnameSchema.parse('1.2.3.4')).toBe('1.2.3.4'))
})

describe('IpSchema trims like HostnameSchema', () => {
  it('accepts a padded address', () => expect(IpSchema.parse('  10.0.4.12 ')).toBe('10.0.4.12'))
})

describe('injection guards', () => {
  const base = { id: crypto.randomUUID(), mode: 'managed' as const }
  it('rejects a newline in a package name', () =>
    expect(PackageSchema.safeParse({ ...base, name: 'ok\n1.2.3.4 evil.test' }).success).toBe(false))
  it('rejects a whitespace-only package name', () =>
    expect(PackageSchema.safeParse({ ...base, name: '   ' }).success).toBe(false))
  it('trims a package name', () =>
    expect(PackageSchema.parse({ ...base, name: '  ok  ' }).name).toBe('ok'))
  it('rejects a newline in a record comment', () =>
    expect(
      HostRecordSchema.safeParse({
        id: crypto.randomUUID(),
        ip: '1.2.3.4',
        hostnames: ['a.test'],
        comment: 'ok\n1.2.3.4 evil.test',
        createdAt: ts,
        updatedAt: ts,
      }).success,
    ).toBe(false))
  it('rejects a css-injecting package colour', () =>
    expect(
      PackageSchema.safeParse({ ...base, name: 'p', color: '#fff;background:url(//evil)' }).success,
    ).toBe(false))
  it('accepts an oklch package colour', () =>
    expect(PackageSchema.parse({ ...base, name: 'p', color: 'oklch(0.7 0.1 250)' }).color).toBe(
      'oklch(0.7 0.1 250)',
    ))
  it('accepts a plain hex package colour', () =>
    expect(PackageSchema.parse({ ...base, name: 'p', color: '#3af' }).color).toBe('#3af'))
  it('accepts an unknown key from a future version rather than failing the file', () =>
    expect(PackageSchema.safeParse({ ...base, name: 'p', icon: 'flask' }).success).toBe(true))
})

describe('PackageSchema mode invariant', () => {
  const base = { id: crypto.randomUUID(), name: 'p' }
  it('requires rawContent on a full-file package', () =>
    expect(PackageSchema.safeParse({ ...base, mode: 'full-file' }).success).toBe(false))
  it('accepts a full-file package with rawContent', () =>
    expect(PackageSchema.safeParse({ ...base, mode: 'full-file', rawContent: 'x' }).success).toBe(
      true,
    ))
  it('rejects rawContent on a managed package', () =>
    expect(PackageSchema.safeParse({ ...base, mode: 'managed', rawContent: 'x' }).success).toBe(
      false,
    ))
})

describe('SettingsSchema guards', () => {
  it('rejects a non-uuid in activeStack', () =>
    expect(SettingsSchema.safeParse({ activeStack: ['not-a-uuid'] }).success).toBe(false))
  it('accepts uuids in activeStack', () =>
    expect(SettingsSchema.safeParse({ activeStack: [crypto.randomUUID()] }).success).toBe(true))
  it('rejects a traversing themeId', () =>
    expect(SettingsSchema.safeParse({ themeId: '../../../etc/passwd' }).success).toBe(false))
})

describe('PackageEntrySchema', () => {
  it('accepts a valid entry', () =>
    expect(
      PackageEntrySchema.safeParse({ recordId: crypto.randomUUID(), enabled: true }).success,
    ).toBe(true))
  it('rejects a non-uuid recordId', () =>
    expect(PackageEntrySchema.safeParse({ recordId: 'x', enabled: true }).success).toBe(false))
})

describe('AppStateSchema', () => {
  it('defaults both fields to null', () =>
    expect(AppStateSchema.parse({})).toEqual({ lastWrittenHash: null, lastAppliedAt: null }))
})
