import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveHostsPath,
  HOSTS_PATH_ENV,
  parse,
  serialize,
  compile,
  applyManagedBlock,
  extractRecords,
  BackupStore,
  type HostRecord,
  type Package,
} from '../src/core/index.js'

/**
 * The whole test strategy rests on one claim: HOSTSERRER_HOSTS_PATH redirects the entire
 * application at a sandbox file, so the real write pipeline can be exercised with no root and
 * no password prompt. This exercises that claim end to end.
 */
let dir: string
let sandbox: string
const ORIGINAL = '127.0.0.1\tlocalhost\n192.168.65.2 host.docker.internal\n'

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hostserrer-e2e-'))
  sandbox = join(dir, 'sandbox-hosts')
  await writeFile(sandbox, ORIGINAL, 'utf8')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const ts = '2026-01-01T00:00:00.000Z'
const record = (ip: string, ...hostnames: string[]): HostRecord =>
  ({ id: crypto.randomUUID(), ip, hostnames, tags: [], createdAt: ts, updatedAt: ts }) as HostRecord
const packageOf = (name: string, ...recordIds: string[]): Package =>
  ({
    id: crypto.randomUUID(),
    name,
    mode: 'managed',
    entries: recordIds.map((recordId) => ({ recordId, enabled: true })),
  }) as Package

describe('sandbox end-to-end', () => {
  it('the env override redirects the app away from the real hosts file', () => {
    const resolved = resolveHostsPath({ [HOSTS_PATH_ENV]: sandbox }, 'darwin')
    expect(resolved).toEqual({ path: sandbox, sandboxed: true })
    expect(resolved.path).not.toBe('/etc/hosts')
  })

  it('imports, applies a stack, then deactivates back to the original bytes', async () => {
    const { path } = resolveHostsPath({ [HOSTS_PATH_ENV]: sandbox }, 'darwin')
    const before = await readFile(path, 'utf8')

    // The Docker line is importable; localhost is a system name and must never be.
    const imported = extractRecords(before)
    expect(imported.records.map((r) => r.hostnames)).toEqual([['host.docker.internal']])
    expect(imported.rejected).toEqual([])

    const blocklist = record('127.0.0.1', 'ads.tracker.com')
    const staging = record('10.0.4.12', 'api.acme.test')
    const library = [blocklist, staging]
    const packages = [
      packageOf('base-blocklist', blocklist.id),
      packageOf('acme-staging', staging.id),
    ]
    const stack = packages.map((p) => p.id)

    // Back up before writing, exactly as the real pipeline will.
    const backups = new BackupStore(join(dir, 'backups'))
    expect(await backups.captureOriginal(path)).toBe(true)
    const snapshot = await backups.snapshot(path, 50)

    const applied = serialize(
      applyManagedBlock(parse(before), compile(library, packages, stack).lines),
    )
    await writeFile(path, applied, 'utf8')

    const written = await readFile(path, 'utf8')
    expect(written).toContain('127.0.0.1       ads.tracker.com                # base-blocklist')
    expect(written).toContain('10.0.4.12       api.acme.test                  # acme-staging')
    // The foreign entry survived, which is the entire point of managed mode.
    expect(written).toContain('192.168.65.2 host.docker.internal')

    // Deactivating everything must give back the original file, byte for byte.
    const cleared = serialize(
      applyManagedBlock(parse(written), compile(library, packages, []).lines),
    )
    await writeFile(path, cleared, 'utf8')
    expect(await readFile(path, 'utf8')).toBe(ORIGINAL)

    // Both recovery paths still hold the original.
    expect(await backups.readOriginal()).toBe(ORIGINAL)
    expect(await backups.read(snapshot)).toBe(ORIGINAL)
  })

  it('re-applying the same stack is a no-op on disk', async () => {
    const { path } = resolveHostsPath({ [HOSTS_PATH_ENV]: sandbox }, 'darwin')
    const r = record('10.0.4.12', 'api.acme.test')
    const pkgs = [packageOf('acme-staging', r.id)]
    const stack = pkgs.map((p) => p.id)
    const apply = (text: string) =>
      serialize(applyManagedBlock(parse(text), compile([r], pkgs, stack).lines))

    const once = apply(await readFile(path, 'utf8'))
    await writeFile(path, once, 'utf8')
    expect(apply(await readFile(path, 'utf8'))).toBe(once)
  })
})
