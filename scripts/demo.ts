// SPDX-License-Identifier: MIT
//
// A guided tour of the core engine, run against a throwaway sandbox file.
// This NEVER touches your real hosts file. Run it with: npm run demo

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyManagedBlock,
  BackupStore,
  compile,
  extractRecords,
  parse,
  serialize,
  type HostRecord,
  type Package,
} from '../src/core/index.js'

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`

function step(n: number, title: string): void {
  console.log(`\n${bold(cyan(`── ${n}. ${title}`))}\n`)
}

function show(text: string): void {
  console.log(
    text
      .split('\n')
      .map((l) => {
        if (l.includes('hostserrer:')) return dim(`   │ ${l}`)
        if (l.startsWith('#')) return dim(`   │ ${l}`)
        return `   │ ${l}`
      })
      .join('\n'),
  )
}

const ts = new Date().toISOString()
const record = (ip: string, ...hostnames: string[]): HostRecord =>
  ({ id: crypto.randomUUID(), ip, hostnames, tags: [], createdAt: ts, updatedAt: ts }) as HostRecord

const SANDBOX_HOSTS = [
  '##',
  '# Host Database',
  '#',
  '# localhost is used to configure the loopback interface',
  '##',
  '127.0.0.1\tlocalhost',
  '255.255.255.255\tbroadcasthost',
  '::1             localhost',
  '',
  '# Added by Docker Desktop',
  '192.168.65.2 host.docker.internal',
  '',
].join('\n')

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'hostserrer-demo-'))
  const hostsPath = join(dir, 'hosts')
  await writeFile(hostsPath, SANDBOX_HOSTS, 'utf8')

  console.log(bold('\n  hostserrer — core engine demo'))
  console.log(dim(`  sandbox file: ${hostsPath}`))
  console.log(dim('  your real hosts file is not touched'))

  step(1, 'The starting hosts file')
  const original = await readFile(hostsPath, 'utf8')
  show(original)

  step(2, 'Import it into a record library')
  const imported = extractRecords(original)
  console.log(`   ${green('imported')}  ${imported.records.length} record(s):`)
  for (const r of imported.records) console.log(`     ${r.ip.padEnd(16)} ${r.hostnames.join(' ')}`)
  console.log(
    `   ${dim(`skipped ${imported.skippedSystem} system line(s) — localhost and friends must never`)}`,
  )
  console.log(`   ${dim('live in a package, or deactivating it would break the machine')}`)

  // Build a small library and three packages.
  const ads = record('127.0.0.1', 'ads.tracker.com')
  const telemetry = record('127.0.0.1', 'telemetry.vendor.com')
  const staging = record('10.0.4.12', 'api.acme.test', 'auth.acme.test')
  const mirror = record('10.0.9.3', 'api.acme.test')
  const library = [ads, telemetry, staging, mirror]

  // Narrowed to the managed arm: Package is a discriminated union, and only that arm has
  // `entries`, which step 5 toggles.
  type ManagedPackage = Extract<Package, { mode: 'managed' }>
  const pkg = (name: string, ...ids: string[]): ManagedPackage => ({
    id: crypto.randomUUID(),
    name,
    mode: 'managed',
    entries: ids.map((recordId) => ({ recordId, enabled: true })),
  })

  const pBlock = pkg('base-blocklist', ads.id, telemetry.id)
  const pStaging = pkg('acme-staging', staging.id)
  const pMirror = pkg('prod-mirror', mirror.id)
  const packages = [pBlock, pStaging, pMirror]

  const apply = async (stack: string[]): Promise<string> => {
    const current = await readFile(hostsPath, 'utf8')
    const { lines, conflicts } = compile(library, packages, stack)
    const next = serialize(applyManagedBlock(parse(current), lines))
    await writeFile(hostsPath, next, 'utf8')
    if (conflicts.length > 0) {
      for (const c of conflicts)
        console.log(
          `   ${red('conflict')}  ${c.hostname}: ${c.winner.packageName} wins over ` +
            c.losers.map((l) => l.packageName).join(', '),
        )
      console.log('')
    }
    return next
  }

  const backups = new BackupStore(join(dir, 'backups'))
  await backups.captureOriginal(hostsPath)

  step(3, 'Activate two packages: base-blocklist, then acme-staging')
  show(await apply([pBlock.id, pStaging.id]))
  console.log(`\n   ${green('note')}  the Docker line above is untouched`)

  step(4, 'Push prod-mirror on top — later in the stack wins')
  show(await apply([pBlock.id, pStaging.id, pMirror.id]))
  console.log(`\n   ${green('note')}  the loser is commented, not deleted, and says who beat it`)

  step(5, 'Disable just the ads record inside base-blocklist')
  pBlock.entries[0]!.enabled = false // the ads.tracker.com reference only
  show(await apply([pBlock.id, pStaging.id, pMirror.id]))
  console.log(`\n   ${green('note')}  ads.tracker.com is gone, telemetry.vendor.com remains`)

  step(6, 'Deactivate everything')
  const restored = await apply([])
  show(restored)

  const identical = restored === original
  console.log(
    `\n   ${identical ? green('✓ byte-for-byte identical to the original') : red('✗ FILE DIFFERS')}`,
  )
  console.log(
    `   ${dim(`original also recoverable from ${join(dir, 'backups', 'original.hosts')}`)}`,
  )

  await rm(dir, { recursive: true, force: true })
  console.log(dim('\n  sandbox removed.\n'))
  if (!identical) process.exit(1)
}

await main()
