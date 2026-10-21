// SPDX-License-Identifier: MIT

import { spawn } from 'node:child_process'
import { isIP } from 'node:net'
import { HOSTNAME_RE } from '../core/types.js'

export type ToolKind = 'ping' | 'traceroute'
export type LookupKind = 'google' | 'dnschecker' | 'whatsmydns'

/**
 * Targets come from the renderer, which is untrusted input, and end up as an argument to a
 * child process. They are passed as an argv element (never through a shell) and must also look
 * like a hostname or an IP, so nothing that resembles a flag or a path can get through.
 */
export const isSafeTarget = (t: string): boolean =>
  t.length <= 253 && !t.startsWith('-') && (isIP(t) !== 0 || HOSTNAME_RE.test(t.toLowerCase()))

export function lookupUrl(kind: LookupKind, target: string): string {
  const q = encodeURIComponent(target)
  switch (kind) {
    case 'google':
      return `https://www.google.com/search?q=${q}`
    case 'dnschecker':
      return `https://dnschecker.org/#A/${q}`
    case 'whatsmydns':
      return `https://www.whatsmydns.net/#A/${q}`
  }
}

interface Command {
  file: string
  args: string[]
  timeoutMs: number
}

function command(kind: ToolKind, target: string): Command {
  const p = process.platform
  if (kind === 'ping') {
    if (p === 'win32') return { file: 'ping', args: ['-n', '4', target], timeoutMs: 20_000 }
    if (p === 'darwin') return { file: '/sbin/ping', args: ['-c', '4', target], timeoutMs: 20_000 }
    return { file: 'ping', args: ['-c', '4', '-w', '10', target], timeoutMs: 20_000 }
  }
  if (p === 'win32')
    return { file: 'tracert', args: ['-d', '-h', '20', target], timeoutMs: 120_000 }
  if (p === 'darwin')
    return {
      file: '/usr/sbin/traceroute',
      args: ['-m', '20', '-w', '2', target],
      timeoutMs: 120_000,
    }
  return { file: 'traceroute', args: ['-m', '20', '-w', '2', target], timeoutMs: 120_000 }
}

export interface ToolEvents {
  chunk(text: string): void
  done(code: number | null, note?: string): void
}

export interface ToolHandle {
  stop(): void
}

/** Streams output as it arrives; traceroute in particular can take a minute. */
export function runTool(kind: ToolKind, target: string, on: ToolEvents): ToolHandle {
  const { file, args, timeoutMs } = command(kind, target)
  on.chunk(`$ ${file} ${args.join(' ')}\n`)
  const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let finished = false
  const finish = (code: number | null, note?: string) => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    on.done(code, note)
  }
  const timer = setTimeout(() => {
    child.kill()
    finish(null, `stopped after ${Math.round(timeoutMs / 1000)}s`)
  }, timeoutMs)
  child.stdout.on('data', (d: Buffer) => on.chunk(d.toString('utf8')))
  child.stderr.on('data', (d: Buffer) => on.chunk(d.toString('utf8')))
  child.on('error', (e) => finish(null, e.message))
  child.on('close', (code) => finish(code))
  return {
    stop() {
      child.kill()
      finish(null, 'stopped')
    },
  }
}
