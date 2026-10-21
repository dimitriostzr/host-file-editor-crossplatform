// SPDX-License-Identifier: MIT

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Single-quoted literals for sh and PowerShell. Windows account names may contain `'`. */
const shQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`
const psQuote = (s: string): string => `'${s.replaceAll("'", "''")}'`

export type ElevationResult = { ok: true } | { ok: false; cancelled: boolean; message: string }

export interface ElevatedWriteOptions {
  targetPath: string
  content: string
  flushDns: boolean
}

/**
 * The only module permitted to escalate.
 *
 * Two properties matter more than they look:
 *
 * 1. The hosts content never appears on a command line. It is staged to a temp file and the
 *    elevated command receives only a path. That removes shell injection as a class — which
 *    matters disproportionately when the injection target runs as root.
 * 2. The privileged step installs from that temp file with `install`/`cp`, so the target keeps
 *    its owner and mode, and on POSIX the write goes through a same-filesystem scratch file and
 *    an atomic rename.
 */
export async function elevatedWrite(opts: ElevatedWriteOptions): Promise<ElevationResult> {
  const dir = await mkdtemp(join(tmpdir(), 'hostserrer-'))
  const staged = join(dir, `hosts-${randomUUID()}`)
  try {
    await writeFile(staged, opts.content, 'utf8')
    await chmod(staged, 0o600)
    switch (process.platform) {
      case 'darwin':
        return await writeDarwin(staged, opts)
      case 'win32':
        return await writeWindows(staged, opts)
      default:
        return await writeLinux(staged, opts)
    }
  } catch (e) {
    return { ok: false, cancelled: false, message: describe(e) }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const describe = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : 'unknown error'

/** AppleScript's own error code for "user cancelled the authentication dialog". */
const USER_CANCELLED = -128

async function writeDarwin(staged: string, opts: ElevatedWriteOptions): Promise<ElevationResult> {
  const flush = opts.flushDns
    ? ' && /usr/bin/dscacheutil -flushcache && /usr/bin/killall -HUP mDNSResponder'
    : ''
  // Same filesystem as the target, then an atomic rename, with owner and mode set explicitly.
  const tmp = shQuote(`${opts.targetPath}.hostserrer.tmp`)
  const script = [
    `/usr/bin/install -m 0644 -o root -g wheel ${shQuote(staged)} ${tmp}`,
    `/bin/mv -f ${tmp} ${shQuote(opts.targetPath)}`,
  ].join(' && ')
  const applescript = `do shell script "${(script + flush).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges`
  try {
    await run('/usr/bin/osascript', ['-e', applescript])
    return { ok: true }
  } catch (e) {
    const msg = describe(e)
    const cancelled = msg.includes(String(USER_CANCELLED)) || /User cancell?ed/i.test(msg)
    return { ok: false, cancelled, message: cancelled ? 'Cancelled' : msg }
  }
}

async function writeLinux(staged: string, opts: ElevatedWriteOptions): Promise<ElevationResult> {
  // `&&`, not `;`: a flush after a failed install would otherwise make the whole command exit 0.
  const flush = opts.flushDns
    ? ` && (resolvectl flush-caches || systemd-resolve --flush-caches || true)`
    : ''
  const tmp = shQuote(`${opts.targetPath}.hostserrer.tmp`)
  const script =
    `install -m 0644 -o root -g root ${shQuote(staged)} ${tmp} && ` +
    `mv -f ${tmp} ${shQuote(opts.targetPath)}${flush}`
  try {
    await run('pkexec', ['/bin/sh', '-c', script])
    return { ok: true }
  } catch (e) {
    const err = e as { code?: number }
    // pkexec exits 126 when the user dismisses the authentication dialog.
    if (err.code === 126) return { ok: false, cancelled: true, message: 'Cancelled' }
    return { ok: false, cancelled: false, message: describe(e) }
  }
}

async function writeWindows(staged: string, opts: ElevatedWriteOptions): Promise<ElevationResult> {
  // No reliable atomic rename over a file other processes may hold open, so this copies in
  // place. The caller has already taken a backup and verifies afterwards.
  // Stop, so a failed copy is a terminating error and a non-zero exit, not a warning.
  const flush = opts.flushDns ? '; ipconfig /flushdns | Out-Null' : ''
  const inner =
    `$ErrorActionPreference = 'Stop'; ` +
    `Copy-Item -LiteralPath ${psQuote(staged)} -Destination ${psQuote(opts.targetPath)} -Force${flush}`
  const encoded = Buffer.from(inner, 'utf16le').toString('base64')
  try {
    await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      // A refused UAC prompt makes Start-Process throw and leaves $p null, and `exit $null` is
      // exit 0. Map it to ERROR_CANCELLED (1223) instead.
      `try { $p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encoded}' } catch { exit 1223 }; exit $p.ExitCode`,
    ])
    return { ok: true }
  } catch (e) {
    const msg = describe(e)
    // Matched on the exit code: the message repeats the command line, which contains "1223".
    const cancelled =
      (e as { code?: unknown }).code === 1223 || /operation was cancell?ed by the user/i.test(msg)
    return { ok: false, cancelled, message: cancelled ? 'Cancelled' : msg }
  }
}
