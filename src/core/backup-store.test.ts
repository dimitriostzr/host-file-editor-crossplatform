import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BackupStore, timestampName } from './backup-store.js'

let dir: string
let hosts: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hostserrer-backup-'))
  hosts = join(dir, 'hosts')
  await writeFile(hosts, '127.0.0.1 localhost\n', 'utf8')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})
const store = () => new BackupStore(join(dir, 'backups'))

describe('timestampName', () => {
  it('contains no characters illegal in Windows filenames', () => {
    const n = timestampName(new Date('2026-09-11T14:02:11.123Z'))
    expect(n).toBe('2026-09-11T14-02-11-123Z.hosts')
    expect(/[:*?"<>|]/.test(n)).toBe(false)
  })
  it('sorts lexicographically into chronological order', () => {
    const a = timestampName(new Date('2026-09-11T14:02:11.123Z'))
    const b = timestampName(new Date('2026-09-11T14:02:11.124Z'))
    const c = timestampName(new Date('2026-12-01T00:00:00.000Z'))
    expect([c, a, b].sort()).toEqual([a, b, c])
  })
})

describe('original', () => {
  it('captures once and reports that it did', async () => {
    expect(await store().captureOriginal(hosts)).toBe(true)
    expect(await store().readOriginal()).toBe('127.0.0.1 localhost\n')
  })
  it('never overwrites an already-captured original', async () => {
    const s = store()
    await s.captureOriginal(hosts)
    await writeFile(hosts, 'CHANGED\n', 'utf8')
    expect(await s.captureOriginal(hosts)).toBe(false)
    expect(await s.readOriginal()).toBe('127.0.0.1 localhost\n')
  })
  it('returns null when nothing has been captured', async () => {
    expect(await store().readOriginal()).toBe(null)
  })
})

describe('history', () => {
  it('snapshots and reads back', async () => {
    const s = store()
    const name = await s.snapshot(hosts, 50)
    expect(await s.read(name)).toBe('127.0.0.1 localhost\n')
  })
  it('lists newest first', async () => {
    const s = store()
    const a = await s.snapshot(hosts, 50, new Date('2026-01-01T00:00:00.000Z'))
    const b = await s.snapshot(hosts, 50, new Date('2026-06-01T00:00:00.000Z'))
    expect(await s.list()).toEqual([b, a])
  })
  it('prunes to the retention limit, discarding the oldest', async () => {
    const s = store()
    for (let i = 1; i <= 5; i++) await s.snapshot(hosts, 3, new Date(`2026-0${i}-01T00:00:00.000Z`))
    const list = await s.list()
    expect(list).toHaveLength(3)
    expect(list[2]).toContain('2026-03-01')
  })
  it('retention of 0 keeps nothing', async () => {
    const s = store()
    await s.snapshot(hosts, 0)
    expect(await s.list()).toEqual([])
  })
  it('returns an empty list before any snapshot exists', async () => {
    expect(await store().list()).toEqual([])
  })
  it('ignores foreign files in the history directory', async () => {
    const s = store()
    await s.snapshot(hosts, 50)
    await writeFile(join(dir, 'backups', 'history', 'notes.txt'), 'x', 'utf8')
    expect(await s.list()).toHaveLength(1)
  })
  it('rejects path traversal in a backup name', async () => {
    await expect(store().read('../../../etc/passwd')).rejects.toThrow(/invalid backup name/)
  })
  it('rejects an absolute path', async () => {
    await expect(store().read('/etc/passwd')).rejects.toThrow(/invalid backup name/)
  })
  it('rejects a name that merely ends in .hosts', async () => {
    await expect(store().read('evil.hosts')).rejects.toThrow(/invalid backup name/)
  })
})

describe('kinds, folder and removal', () => {
  it('names manual and pre-restore backups by kind and reports it', async () => {
    const s = store()
    await s.snapshot(hosts, 50, new Date('2026-01-01T00:00:00.000Z'))
    await s.snapshot(hosts, 50, new Date('2026-01-02T00:00:00.000Z'), 'manual')
    await s.snapshot(hosts, 50, new Date('2026-01-03T00:00:00.000Z'), 'restore')
    const e = await s.entries()
    expect(e.map((x) => [x.kind, x.at])).toEqual([
      ['restore', '2026-01-03T00:00:00.000Z'],
      ['manual', '2026-01-02T00:00:00.000Z'],
      ['auto', '2026-01-01T00:00:00.000Z'],
    ])
    expect(e[0]!.size).toBe('127.0.0.1 localhost\n'.length)
  })
  it('prunes automatic backups only, keeping manual ones', async () => {
    const s = store()
    await s.snapshot(hosts, 2, new Date('2026-01-01T00:00:00.000Z'), 'manual')
    for (let i = 2; i <= 6; i++) await s.snapshot(hosts, 2, new Date(`2026-01-0${i}T00:00:00.000Z`))
    const kinds = (await s.entries()).map((x) => x.kind)
    expect(kinds).toEqual(['auto', 'auto', 'manual'])
  })
  it('writes to a chosen folder and lists from it', async () => {
    const s = store()
    const elsewhere = join(dir, 'elsewhere')
    s.setHistoryDir(elsewhere)
    const name = await s.snapshot(hosts, 50)
    expect(s.pathOf(name)).toBe(join(elsewhere, name))
    expect(await s.list()).toEqual([name])
    s.setHistoryDir(null)
    expect(await s.list()).toEqual([])
  })
  it('removes a backup, and refuses a name that is not one', async () => {
    const s = store()
    const name = await s.snapshot(hosts, 50)
    await s.remove(name)
    expect(await s.list()).toEqual([])
    await expect(s.remove('../hosts')).rejects.toThrow(/invalid backup name/)
  })
})
