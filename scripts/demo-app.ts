// SPDX-License-Identifier: MIT
//
// Opens the desktop app on demo data — for screenshots, walkthroughs and trying things out.
// Everything lives under one throwaway directory: the hosts file AND the app's own library,
// packages, settings and backups. Your real hosts file and real library are never touched.
//
//   npm run demo:app             seeds the directory if it is missing, then launches
//   npm run demo:app -- --reset  wipes the directory and seeds it again first
//   npm run demo:app -- --seed-only  writes the data and exits without opening a window

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DATA_DIR_ENV, HOSTS_PATH_ENV, type HostRecord, type Package } from '../src/core/index.js'

const root = join(process.platform === 'win32' ? tmpdir() : '/tmp', 'hostserrer-demo')
const hostsPath = join(root, 'hosts')
const dataDir = join(root, 'data')
const reset = process.argv.includes('--reset')
/** Seed and stop, without opening a window — for checking the data. */
const seedOnly = process.argv.includes('--seed-only')

const HOSTS = `##
# Host Database
#
# localhost is used to configure the loopback interface
# when the system is booting.  Do not change this entry.
##
127.0.0.1       localhost
255.255.255.255 broadcasthost
::1             localhost

# Added by Docker Desktop
192.168.65.2 host.docker.internal
192.168.65.2 gateway.docker.internal
# End of section

93.184.216.34 example-client.com www.example-client.com
# 198.51.100.7 old-cms.example-client.com
`

const at = '2026-08-14T09:30:00.000Z'
const rec = (ip: string, hostnames: string[], comment?: string): HostRecord => ({
  id: randomUUID(),
  ip,
  hostnames,
  ...(comment ? { comment } : {}),
  tags: [],
  createdAt: at,
  updatedAt: at,
})

// The library: one shared pool of records that packages reference by id.
const docker = rec('192.168.65.2', ['host.docker.internal'])
const dockerGw = rec('192.168.65.2', ['gateway.docker.internal'])
const client = rec('93.184.216.34', ['example-client.com', 'www.example-client.com'])
const clientOld = rec('198.51.100.7', ['old-cms.example-client.com'], 'decommissioned')

const devApp = rec('127.0.0.1', ['app.acme.test', 'www.acme.test'])
const devApi = rec('127.0.0.1', ['api.acme.test'])
const devAuth = rec('127.0.0.1', ['auth.acme.test'], 'keycloak on :8080')
const devMail = rec('127.0.0.1', ['mail.acme.test'], 'mailpit')

const stgApp = rec('10.20.4.12', ['app.acme.com', 'www.acme.com'])
const stgApi = rec('10.20.4.13', ['api.acme.com'])
const stgCdn = rec('10.20.4.20', ['cdn.acme.com'], 'staging bucket')

const prodApp = rec('203.0.113.10', ['app.acme.com', 'www.acme.com'], 'new load balancer')
const prodApi = rec('203.0.113.11', ['api.acme.com'])

const blk1 = rec('0.0.0.0', ['telemetry.vendor-example.com'])
const blk2 = rec('0.0.0.0', ['metrics.vendor-example.com'])
const blk3 = rec('0.0.0.0', ['ads.tracker-example.net', 'cdn.tracker-example.net'])
const blk4 = rec('0.0.0.0', ['beacon.tracker-example.net'])

const library = [
  docker,
  dockerGw,
  client,
  clientOld,
  devApp,
  devApi,
  devAuth,
  devMail,
  stgApp,
  stgApi,
  stgCdn,
  prodApp,
  prodApi,
  blk1,
  blk2,
  blk3,
  blk4,
]

const pkg = (
  name: string,
  description: string,
  entries: [HostRecord, boolean][],
  color?: string,
): Package => ({
  id: randomUUID(),
  name,
  description,
  ...(color ? { color } : {}),
  mode: 'managed',
  entries: entries.map(([r, enabled]) => ({ recordId: r.id, enabled })),
})

const imported = pkg(
  'Imported 2026-08-14',
  'Everything found in your hosts file when hostserrer first ran',
  [
    [docker, true],
    [dockerGw, true],
    [client, true],
    [clientOld, false],
  ],
)
const localDev = pkg('Local dev', 'Everything on this machine, for working offline', [
  [devApp, true],
  [devApi, true],
  [devAuth, true],
  [devMail, false],
])
const staging = pkg('Staging', 'Point acme.com at the staging VPC', [
  [stgApp, true],
  [stgApi, true],
  [stgCdn, true],
])
const prodPreview = pkg(
  'Production preview',
  'Hit the new production load balancer before DNS is switched',
  [
    [prodApp, true],
    [prodApi, false],
  ],
)
const blocklist = pkg('Blocklist', 'Telemetry and ad hosts, sent nowhere', [
  [blk1, true],
  [blk2, true],
  [blk3, true],
  [blk4, true],
])
const packages = [imported, localDev, staging, prodPreview, blocklist]

// Blocklist first, then Staging, then Production preview on top — so app.acme.com is claimed
// by two packages and the preview shows a conflict resolved by stack order.
const settings = {
  schemaVersion: 1,
  activeStack: [blocklist.id, staging.id, prodPreview.id],
  flushDnsOnApply: true,
  commentShadowedLines: true,
  backupRetention: 50,
  themeId: 'default',
  themeMode: 'system',
}

async function seed(): Promise<void> {
  await rm(root, { recursive: true, force: true })
  await mkdir(dataDir, { recursive: true })
  await writeFile(hostsPath, HOSTS, 'utf8')
  const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n'
  await writeFile(join(dataDir, 'library.json'), json({ schemaVersion: 1, records: library }))
  await writeFile(join(dataDir, 'packages.json'), json({ schemaVersion: 1, packages }))
  await writeFile(join(dataDir, 'settings.json'), json(settings))
  console.log(`Seeded demo data in ${root}`)
}

if (reset || !existsSync(hostsPath)) await seed()
else console.log(`Using existing demo data in ${root} (pass --reset to start over)`)

console.log(`Hosts file: ${hostsPath}\nApp data:   ${dataDir}\n`)
if (seedOnly) process.exit(0)

const env: NodeJS.ProcessEnv = {
  ...process.env,
  [HOSTS_PATH_ENV]: hostsPath,
  [DATA_DIR_ENV]: dataDir,
}
delete env['ELECTRON_RUN_AS_NODE']
const child = spawn('electron-vite', ['dev'], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
})
child.on('exit', (code) => process.exit(code ?? 0))
