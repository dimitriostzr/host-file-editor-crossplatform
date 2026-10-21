// SPDX-License-Identifier: MIT

import { platform as osPlatform } from 'node:process'

/** Redirects the whole application at a sandbox file, so tests need no root. */
export const HOSTS_PATH_ENV = 'HOSTSERRER_HOSTS_PATH'
/**
 * Redirects the library, packages, settings and backups at another directory, so a demo or a
 * test never reads or writes the real ones. Honoured by the Electron main process only.
 */
export const DATA_DIR_ENV = 'HOSTSERRER_DATA_DIR'

export function defaultHostsPath(
  platform: NodeJS.Platform = osPlatform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === 'win32') {
    const root = env['SystemRoot'] ?? env['windir'] ?? 'C:\\Windows'
    return `${root}\\System32\\drivers\\etc\\hosts`
  }
  return '/etc/hosts'
}

export interface ResolvedHostsPath {
  path: string
  /** True when an override is in effect. The UI MUST make this visible. */
  sandboxed: boolean
}

export function resolveHostsPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = osPlatform,
): ResolvedHostsPath {
  const override = env[HOSTS_PATH_ENV]?.trim()
  if (override) return { path: override, sandboxed: true }
  return { path: defaultHostsPath(platform, env), sandboxed: false }
}
