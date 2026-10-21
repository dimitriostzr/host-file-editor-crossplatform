import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostsService } from '../src/main/hosts-service.js'

/**
 * The main-process service, run without Electron against a sandbox hosts file. This is the
 * layer the interface talks to, so it is where "the app rejected a valid address" would show.
 */
let dir: string
let svc: HostsService

const HOSTS = [
  '127.0.0.1\tlocalhost',
  '::1 localhost',
  '# Added by Docker Desktop',
  '192.168.65.2 host.docker.internal',
  '203.0.113.50 example-shop.com www.example-shop.com',
  '# 20.124.81.148 parked.test',
  '',
].join('\n')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hostserrer-svc-'))
  const hostsPath = join(dir, 'hosts')
  await writeFile(hostsPath, HOSTS, 'utf8')
  svc = new HostsService({ userDataDir: join(dir, 'data'), hostsPath, sandboxed: true })
  await svc.init()
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('first run', () => {
  it('seeds the library from the file and wraps it in one package', async () => {
    const s = await svc.snapshot()
    expect(s.library.map((r) => r.hostnames)).toEqual([
      ['host.docker.internal'],
      ['example-shop.com', 'www.example-shop.com'],
      ['parked.test'],
    ])
    expect(s.packages).toHaveLength(1)
    const p = s.packages[0]!
    // The commented-out line is in the package, switched off.
    expect(p.mode === 'managed' && p.entries.map((e) => e.enabled)).toEqual([true, true, false])
    expect(s.packages[0]!.name).toBe('From your hosts file')
    expect(s.settings.activeStack).toEqual([])
    expect(s.hasOriginal).toBe(true)
  })
})

describe('records', () => {
  it('accepts 123.123.123.123 with hostname test', async () => {
    expect(await svc.addRecord({ ip: '123.123.123.123', hostnames: ['test'] })).toMatchObject({
      ok: true,
      id: expect.any(String),
    })
    const s = await svc.snapshot()
    expect(s.library.some((r) => r.ip === '123.123.123.123' && r.hostnames[0] === 'test')).toBe(
      true,
    )
  })
  it('validateRecord reports the same error addRecord would, without saving', async () => {
    const before = (await svc.snapshot()).library.length
    const v = svc.validateRecord({ ip: '123.123.123', hostnames: ['test'] })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.message).toMatch(/^ip: /)
    expect((await svc.snapshot()).library.length).toBe(before)
  })
  it('validateRecord passes a good record', () => {
    expect(svc.validateRecord({ ip: '10.0.0.1', hostnames: ['a.test', 'b.test'] })).toEqual({
      ok: true,
    })
  })
  it('updates in place and keeps createdAt', async () => {
    const r = (await svc.snapshot()).library[0]!
    expect(await svc.updateRecord(r.id, { ip: '10.9.9.9' })).toEqual({ ok: true })
    const after = (await svc.snapshot()).library.find((x) => x.id === r.id)!
    expect(after.ip).toBe('10.9.9.9')
    expect(after.createdAt).toBe(r.createdAt)
    expect(after.hostnames).toEqual(r.hostnames)
  })
  it('deleting a record removes it from every package', async () => {
    const s = await svc.snapshot()
    const r = s.library[0]!
    await svc.deleteRecord(r.id)
    const after = await svc.snapshot()
    expect(after.library.some((x) => x.id === r.id)).toBe(false)
    for (const p of after.packages)
      if (p.mode === 'managed') expect(p.entries.some((e) => e.recordId === r.id)).toBe(false)
  })
})

describe('packages', () => {
  it('creates, renames and picks records', async () => {
    const lib = (await svc.snapshot()).library
    const created = await svc.createPackage({ name: 'staging', recordIds: [lib[0]!.id] })
    expect(created.ok).toBe(true)
    const id = created.ok ? created.id! : ''
    expect(await svc.updatePackage(id, { name: 'acme-staging', description: 'x' })).toEqual({
      ok: true,
    })
    expect(await svc.updatePackage(id, { recordIds: lib.map((r) => r.id) })).toEqual({ ok: true })
    const p = (await svc.snapshot()).packages.find((x) => x.id === id)!
    expect(p.name).toBe('acme-staging')
    expect(p.mode === 'managed' && p.entries.map((e) => e.recordId)).toEqual(lib.map((r) => r.id))
  })
  it('re-picking records keeps the enabled flags of the ones already present', async () => {
    const lib = (await svc.snapshot()).library
    const { id } = (await svc.createPackage({ name: 'p', recordIds: [lib[0]!.id] })) as {
      id: string
    }
    await svc.toggleEntry(id, lib[0]!.id) // now disabled
    await svc.updatePackage(id, { recordIds: [lib[0]!.id, lib[1]!.id] })
    const p = (await svc.snapshot()).packages.find((x) => x.id === id)!
    if (p.mode !== 'managed') throw new Error('expected managed')
    expect(p.entries).toEqual([
      { recordId: lib[0]!.id, enabled: false },
      { recordId: lib[1]!.id, enabled: true },
    ])
  })
  it('enables and disables in bulk, optionally limited to a subset', async () => {
    const lib = (await svc.snapshot()).library
    const { id } = (await svc.createPackage({ name: 'p', recordIds: lib.map((r) => r.id) })) as {
      id: string
    }
    expect(await svc.setEntriesEnabled(id, false)).toEqual({ ok: true })
    let p = (await svc.snapshot()).packages.find((x) => x.id === id)!
    expect(p.mode === 'managed' && p.entries.every((e) => !e.enabled)).toBe(true)
    await svc.setEntriesEnabled(id, true, [lib[1]!.id])
    p = (await svc.snapshot()).packages.find((x) => x.id === id)!
    expect(p.mode === 'managed' && p.entries.map((e) => e.enabled)).toEqual([false, true, false])
  })
  it('rejects a name with a newline, which would inject a line into the file', async () => {
    const r = await svc.createPackage({ name: 'ok\n1.2.3.4 evil.test' })
    expect(r.ok).toBe(false)
  })
  it('deleting a package takes it out of the active stack', async () => {
    const { id } = (await svc.createPackage({ name: 'p' })) as { id: string }
    await svc.setActiveStack([id])
    await svc.deletePackage(id)
    const s = await svc.snapshot()
    expect(s.settings.activeStack).toEqual([])
    expect(s.packages.some((x) => x.id === id)).toBe(false)
  })
})

describe('snapshot', () => {
  it('is clean with nothing active and dirty once a package is switched on', async () => {
    expect((await svc.snapshot()).dirty).toBe(false)
    const p = (await svc.snapshot()).packages[0]!
    await svc.setActiveStack([p.id])
    const s = await svc.snapshot()
    expect(s.dirty).toBe(true)
    expect(s.preview).toContain('hostserrer: BEGIN')
    expect(s.preview).toContain('192.168.65.2 host.docker.internal') // foreign line untouched
    expect(s.hostsContent).toBe(HOSTS) // nothing written until apply
  })
})

describe('export', () => {
  it('writes a byte-identical copy of the file on disk, not the preview', async () => {
    const p = (await svc.snapshot()).packages[0]!
    await svc.setActiveStack([p.id]) // dirty, so preview differs from disk
    const dest = join(dir, 'exported.txt')
    expect(await svc.exportTo(dest)).toEqual({ ok: true })
    expect(await readFile(dest, 'utf8')).toBe(HOSTS)
  })
  it('reports a failure instead of throwing', async () => {
    const r = await svc.exportTo(join(dir, 'missing-dir', 'exported.txt'))
    expect(r.ok).toBe(false)
  })
})

describe('shadowed lines', () => {
  it('comments out imported lines when their package is on, and restores them when it is off', async () => {
    const p = (await svc.snapshot()).packages[0]!
    await svc.setActiveStack([p.id])
    const on = await svc.snapshot()
    expect(on.shadowed).toBe(2)
    expect(on.preview).toContain('# hostserrer moved: 192.168.65.2 host.docker.internal')
    expect(on.preview).toContain(
      '# hostserrer moved: 203.0.113.50 example-shop.com www.example-shop.com',
    )
    expect(on.preview).toContain('127.0.0.1\tlocalhost') // system line untouched

    // apply() would prompt for a password; the writer installs exactly the preview, so stand
    // in for it and check the pipeline restores the file once the block is gone.
    await writeFile(join(dir, 'hosts'), on.preview, 'utf8')
    await svc.setActiveStack([])
    const off = await svc.snapshot()
    expect(off.shadowed).toBe(0)
    expect(off.preview).toBe(HOSTS)
  })
  it('leaves the lines alone when the setting is off, but still counts them', async () => {
    const p = (await svc.snapshot()).packages[0]!
    await svc.setSettings({ commentShadowedLines: false })
    await svc.setActiveStack([p.id])
    const s = await svc.snapshot()
    expect(s.shadowed).toBe(2)
    expect(s.preview).not.toContain('hostserrer moved')
    expect(s.preview).toContain('192.168.65.2 host.docker.internal\n')
  })
})

describe('import from file', () => {
  it('adds only lines the library lacks, switched off where they are commented out', async () => {
    await writeFile(
      join(dir, 'hosts'),
      HOSTS + '10.0.0.1 new.test\n# 10.0.0.2 new-parked.test\n',
      'utf8',
    )
    const r = await svc.importFromFile()
    expect(r).toMatchObject({ ok: true, added: 2, disabled: 1 })
    const s = await svc.snapshot()
    expect(s.library).toHaveLength(5)
    const pkg = s.packages.find((p) => p.id === (r.ok ? r.packageId : ''))!
    expect(pkg.mode === 'managed' && pkg.entries.map((e) => e.enabled)).toEqual([true, false])
  })
  it('reports nothing new when the file and library agree', async () => {
    expect(await svc.importFromFile()).toEqual({ ok: true, added: 0, disabled: 0, packageId: null })
    expect((await svc.snapshot()).packages).toHaveLength(1)
  })
})

describe('import text', () => {
  it('makes a switched-off package, reusing records the library already has', async () => {
    const before = (await svc.snapshot()).library.length
    const r = await svc.importText(
      [
        '0.0.0.0 ads.example.test',
        '# 0.0.0.0 parked-ad.example.test',
        '192.168.65.2 host.docker.internal',
        '0.0.0.0 ads.example.test',
        'not a hosts line at all',
        '127.0.0.1 localhost',
      ].join('\n'),
      'Blocklist',
    )
    expect(r).toMatchObject({ ok: true, records: 3, added: 2, disabled: 1, skippedSystem: 1 })
    const s = await svc.snapshot()
    expect(s.library).toHaveLength(before + 2)
    const pkg = s.packages.find((p) => p.name === 'Blocklist')!
    expect(pkg.mode === 'managed' && pkg.entries.map((e) => e.enabled)).toEqual([true, false, true])
    expect(s.settings.activeStack).not.toContain(pkg.id)
  })
  it('explains when nothing in the text is a host entry', async () => {
    const r = await svc.importText('# just a comment\nhello world\n', 'Nothing')
    expect(r.ok).toBe(false)
    expect((await svc.snapshot()).packages.some((p) => p.name === 'Nothing')).toBe(false)
  })
})

describe('add record into a package', () => {
  it('puts the new record in the library and in the package, switched on', async () => {
    const pkgId = (await svc.snapshot()).packages[0]!.id
    const r = await svc.addRecord({ ip: '10.9.9.9', hostnames: ['new.test'] }, pkgId)
    expect(r.ok).toBe(true)
    const p = (await svc.snapshot()).packages[0]!
    expect(p.mode === 'managed' && p.entries.at(-1)).toEqual({ recordId: r.id, enabled: true })
  })
})

describe('unimported count', () => {
  it('is zero after first run and counts lines added to the file since', async () => {
    expect((await svc.snapshot()).unimported).toBe(0)
    await writeFile(
      join(dir, 'hosts'),
      HOSTS + '10.0.0.1 new.test\n# 10.0.0.2 parked2.test\n',
      'utf8',
    )
    expect((await svc.snapshot()).unimported).toBe(2)
    await svc.importFromFile()
    expect((await svc.snapshot()).unimported).toBe(0)
  })
})

describe('sandbox writes', () => {
  it('applies and restores a sandbox file directly, with no elevation', async () => {
    const p = (await svc.snapshot()).packages[0]!
    await svc.setActiveStack([p.id])
    expect(await svc.apply()).toEqual({ ok: true })
    const written = await readFile(join(dir, 'hosts'), 'utf8')
    expect(written).toContain('hostserrer: BEGIN')
    const s = await svc.snapshot()
    expect(s.dirty).toBe(false)
    expect(s.lastAppliedAt).not.toBeNull()
    expect(s.backups).toHaveLength(1)

    expect(await svc.restoreOriginal()).toEqual({ ok: true })
    expect(await readFile(join(dir, 'hosts'), 'utf8')).toBe(HOSTS)
    expect((await svc.snapshot()).settings.activeStack).toEqual([])
  })
})

describe('backups', () => {
  it('backs up before apply, and not at all when automatic backups are off', async () => {
    const pkgId = (await svc.snapshot()).packages[0]!.id
    await svc.setActiveStack([pkgId])
    expect((await svc.apply()).ok).toBe(true)
    expect((await svc.snapshot()).backups.map((b) => b.kind)).toEqual(['auto'])
    await svc.setSettings({ autoBackup: false })
    await svc.setActiveStack([])
    expect((await svc.apply()).ok).toBe(true)
    expect((await svc.snapshot()).backups).toHaveLength(1)
  })
  it('restores a backup over a changed file, backing up the current one first', async () => {
    const hostsPath = join(dir, 'hosts')
    expect((await svc.backupNow()).ok).toBe(true)
    const [manual] = (await svc.snapshot()).backups
    await writeFile(hostsPath, 'changed by hand\n', 'utf8')
    expect((await svc.restoreBackup(manual!.name)).ok).toBe(true)
    expect(await readFile(hostsPath, 'utf8')).toBe(HOSTS)
    const kinds = (await svc.snapshot()).backups.map((b) => b.kind)
    expect(kinds).toEqual(['restore', 'manual'])
    const replaced = (await svc.snapshot()).backups[0]!
    expect(await svc.readBackup(replaced.name)).toEqual({ ok: true, content: 'changed by hand\n' })
  })
  it('writes backups to a chosen folder and stops the apply when it cannot', async () => {
    const elsewhere = join(dir, 'backups-elsewhere')
    await svc.setBackupDir(elsewhere)
    expect((await svc.backupNow()).ok).toBe(true)
    expect((await svc.snapshot()).backupDir).toBe(elsewhere)
    // A folder path that is actually a file cannot hold backups.
    await writeFile(join(dir, 'not-a-folder'), 'x', 'utf8')
    await svc.setBackupDir(join(dir, 'not-a-folder'))
    const pkgId = (await svc.snapshot()).packages[0]!.id
    await svc.setActiveStack([pkgId])
    const r = await svc.apply()
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/Could not back up/)
    expect(await readFile(join(dir, 'hosts'), 'utf8')).toBe(HOSTS)
  })
})
