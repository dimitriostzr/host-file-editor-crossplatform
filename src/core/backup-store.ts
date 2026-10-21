// SPDX-License-Identifier: MIT

import { copyFile, mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Why a backup was taken. Encoded in the file name so a backup folder needs no index file:
 * `<timestamp>.hosts` is automatic (before an apply), `<timestamp>-manual.hosts` and
 * `<timestamp>-restore.hosts` the other two.
 */
export type BackupKind = 'auto' | 'manual' | 'restore'

export interface BackupInfo {
  name: string
  kind: BackupKind
  /** ISO time the backup was taken. */
  at: string
  size: number
}

/** Colons are illegal in Windows filenames; sanitised names still sort chronologically. */
export const timestampName = (d: Date = new Date(), kind: BackupKind = 'auto'): string =>
  `${d.toISOString().replace(/[:.]/g, '-')}${kind === 'auto' ? '' : `-${kind}`}.hosts`

const BACKUP_NAME_RE =
  /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-(manual|restore))?\.hosts$/

const parseName = (name: string): { kind: BackupKind; at: string } | null => {
  const m = BACKUP_NAME_RE.exec(name)
  if (!m) return null
  return {
    kind: (m[6] as BackupKind | undefined) ?? 'auto',
    at: `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`,
  }
}

export class BackupStore {
  private historyDir: string

  /**
   * `dir` holds the original. History goes to `historyDir` when given — a folder the user
   * picked — and to `dir/history` otherwise.
   */
  constructor(
    private readonly dir: string,
    historyDir?: string | null,
  ) {
    this.historyDir = historyDir ?? join(dir, 'history')
  }

  /** Where new backups go and where they are listed from. Existing backups are not moved. */
  setHistoryDir(historyDir: string | null): void {
    this.historyDir = historyDir ?? join(this.dir, 'history')
  }
  get historyDirectory(): string {
    return this.historyDir
  }

  private get originalPath(): string {
    return join(this.dir, 'original.hosts')
  }

  /** Captured at first launch and never overwritten. Returns true if it captured now. */
  async captureOriginal(hostsPath: string): Promise<boolean> {
    await mkdir(this.dir, { recursive: true })
    try {
      await stat(this.originalPath)
      return false
    } catch {
      await copyFile(hostsPath, this.originalPath)
      return true
    }
  }

  async readOriginal(): Promise<string | null> {
    try {
      return await readFile(this.originalPath, 'utf8')
    } catch {
      return null
    }
  }

  /**
   * Copies the hosts file into the history folder. Retention applies to automatic backups
   * only: manual and pre-restore copies are kept until the user deletes them.
   */
  async snapshot(
    hostsPath: string,
    retention: number,
    now: Date = new Date(),
    kind: BackupKind = 'auto',
  ): Promise<string> {
    await mkdir(this.historyDir, { recursive: true })
    const name = timestampName(now, kind)
    await copyFile(hostsPath, join(this.historyDir, name))
    await this.prune(retention)
    return name
  }

  /** Newest first. */
  async list(): Promise<string[]> {
    try {
      const names = await readdir(this.historyDir)
      return names
        .filter((n) => BACKUP_NAME_RE.test(n))
        .sort()
        .reverse()
    } catch {
      return []
    }
  }

  /** Newest first, with kind, time and size. */
  async entries(): Promise<BackupInfo[]> {
    const names = await this.list()
    const out: BackupInfo[] = []
    for (const name of names) {
      const parsed = parseName(name)!
      try {
        const s = await stat(join(this.historyDir, name))
        out.push({ name, ...parsed, size: s.size })
      } catch {
        // Deleted between the listing and the stat.
      }
    }
    return out
  }

  /** The full path of a backup, for "show in folder". */
  pathOf(name: string): string {
    this.check(name)
    return join(this.historyDir, name)
  }

  async read(name: string): Promise<string> {
    this.check(name)
    return readFile(join(this.historyDir, name), 'utf8')
  }

  async remove(name: string): Promise<void> {
    this.check(name)
    await unlink(join(this.historyDir, name))
  }

  /** Names arrive over IPC. Without this, '../../etc/passwd' is a "backup". */
  private check(name: string): void {
    if (!BACKUP_NAME_RE.test(name)) throw new Error(`invalid backup name: ${name}`)
  }

  private async prune(retention: number): Promise<void> {
    const auto = (await this.list()).filter((n) => parseName(n)?.kind === 'auto')
    await Promise.all(auto.slice(retention).map((n) => unlink(join(this.historyDir, n))))
  }
}
