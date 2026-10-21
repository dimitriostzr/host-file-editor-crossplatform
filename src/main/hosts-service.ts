// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compile, type Conflict } from '../core/compiler.js'
import { applyManagedBlock } from '../core/managed-block.js'
import { coveredHostnames, reconcileShadowedLines } from '../core/shadowed.js'
import { parse, serialize } from '../core/parser.js'
import { extractRecords, type ImportResult } from '../core/import-hosts.js'
import { BackupStore, type BackupInfo, type BackupKind } from '../core/backup-store.js'
import { readJsonValidated, writeJsonAtomic } from '../core/store.js'
import {
  AppStateSchema,
  HostRecordSchema,
  PackageSchema,
  SettingsSchema,
  type AppState,
  type HostRecord,
  type Package,
  type Settings,
} from '../core/types.js'
import { z } from 'zod'
import { elevatedWrite, type ElevationResult } from './elevated-writer.js'

const LibraryFileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  records: z.array(HostRecordSchema).default([]),
})
const PackagesFileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  packages: z.array(PackageSchema).default([]),
})

export interface AppSnapshot {
  hostsPath: string
  sandboxed: boolean
  hostsContent: string
  preview: string
  dirty: boolean
  library: HostRecord[]
  packages: Package[]
  settings: Settings
  conflicts: Conflict[]
  /** Plain lines above the block that the block covers and would comment out. */
  shadowed: number
  /** Entry lines in the file (commented out or not) that the library does not have. */
  unimported: number
  backups: BackupInfo[]
  /** Where backups are written: the chosen folder, or the default in the data folder. */
  backupDir: string
  hasOriginal: boolean
  externalChange: boolean
  lastAppliedAt: string | null
  lastError: string | null
}

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

export type Result = { ok: true } | { ok: false; message: string }

const firstIssue = (e: z.ZodError): string => {
  const i = e.issues[0]
  return i ? `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}` : 'invalid input'
}

/** Records are the same mapping when the IP and the set of hostnames match. */
const recordKey = (r: { ip: string; hostnames: string[] }): string =>
  `${r.ip} ${[...r.hostnames].sort().join(' ')}`

const today = (): string => new Date().toISOString().slice(0, 10)

const importedPackage = (
  name: string,
  records: readonly HostRecord[],
  disabled: readonly string[],
  description: string,
): Package => {
  const off = new Set(disabled)
  return {
    id: crypto.randomUUID(),
    name,
    description,
    mode: 'managed',
    entries: records.map((r) => ({ recordId: r.id, enabled: !off.has(r.id) })),
  }
}

export class HostsService {
  private readonly hostsPath: string
  private readonly sandboxed: boolean
  private readonly dir: string
  private readonly backups: BackupStore
  private library: HostRecord[] = []
  private packages: Package[] = []
  private settings: Settings = SettingsSchema.parse({})
  private state: AppState = AppStateSchema.parse({})
  private lastError: string | null = null
  /** What each data file last held on disk, so unchanged files are not rewritten. */
  private readonly saved = new Map<string, string>()

  constructor(opts: { userDataDir: string; hostsPath: string; sandboxed: boolean }) {
    this.hostsPath = opts.hostsPath
    this.sandboxed = opts.sandboxed
    this.dir = opts.userDataDir
    this.backups = new BackupStore(join(this.dir, 'backups'))
  }

  private p(name: string): string {
    return join(this.dir, name)
  }

  async init(): Promise<void> {
    this.library = (
      await readJsonValidated(this.p('library.json'), LibraryFileSchema, () => ({
        schemaVersion: 1 as const,
        records: [],
      }))
    ).data.records
    this.packages = (
      await readJsonValidated(this.p('packages.json'), PackagesFileSchema, () => ({
        schemaVersion: 1 as const,
        packages: [],
      }))
    ).data.packages
    this.settings = (
      await readJsonValidated(this.p('settings.json'), SettingsSchema, () =>
        SettingsSchema.parse({}),
      )
    ).data
    this.backups.setHistoryDir(this.settings.backupDir)
    this.state = (
      await readJsonValidated(this.p('state.json'), AppStateSchema, () => AppStateSchema.parse({}))
    ).data

    // Captured before anything can modify the file, and never overwritten.
    await this.backups.captureOriginal(this.hostsPath)

    // First run: seed the library from whatever is already in the file.
    if (this.library.length === 0 && this.packages.length === 0) await this.seedFromHostsFile()
  }

  private async seedFromHostsFile(): Promise<void> {
    const text = await readFile(this.hostsPath, 'utf8')
    const { records, disabled } = extractRecords(text)
    this.library = records
    if (records.length > 0) {
      this.packages = [
        importedPackage(
          'From your hosts file',
          records,
          disabled,
          'Everything found in your hosts file when hostserrer first ran',
        ),
      ]
    }
    await this.persist()
  }

  /**
   * Bring in lines from the file that the library does not have yet — hand edits made since
   * first run, or commented-out entries an older version skipped. New records land in a fresh
   * `Imported <date>` package, switched off where the line was commented out, so nothing about
   * the file changes until the user chooses to switch that package on.
   */
  /**
   * Records the file holds that the library does not, matched by IP and hostname set. Takes the
   * extraction rather than the text: ids are minted per extraction, so `disabled` only matches
   * records from the same call.
   */
  private freshRecords(extracted: ImportResult): HostRecord[] {
    const known = new Set(this.library.map(recordKey))
    return extracted.records.filter((r) => !known.has(recordKey(r)))
  }

  async importFromFile(): Promise<
    | { ok: true; added: number; disabled: number; packageId: string | null }
    | { ok: false; message: string }
  > {
    const extracted = extractRecords(await readFile(this.hostsPath, 'utf8'))
    const fresh = this.freshRecords(extracted)
    if (fresh.length === 0) return { ok: true, added: 0, disabled: 0, packageId: null }
    const off = extracted.disabled.filter((id) => fresh.some((r) => r.id === id))
    const pkg = importedPackage(
      `New in your hosts file, ${today()}`,
      fresh,
      off,
      'Lines found in your hosts file that the library did not have',
    )
    this.library = [...this.library, ...fresh]
    this.packages = [...this.packages, pkg]
    await this.persist()
    return { ok: true, added: fresh.length, disabled: off.length, packageId: pkg.id }
  }

  /**
   * Paste or file import: hosts-format lines become a new package. Records the library already
   * has are reused rather than duplicated, and commented-out lines come in switched off. The
   * package is not put in the stack, so nothing reaches the file until the user switches it on.
   */
  async importText(
    text: string,
    packageName: string,
  ): Promise<
    | {
        ok: true
        packageId: string
        records: number
        added: number
        disabled: number
        rejected: number
        skippedSystem: number
      }
    | { ok: false; message: string }
  > {
    const extracted = extractRecords(text)
    const off = new Set(extracted.disabled)
    const byKey = new Map(this.library.map((r) => [recordKey(r), r.id]))
    const fresh: HostRecord[] = []
    const entries = new Map<string, boolean>()
    for (const r of extracted.records) {
      const k = recordKey(r)
      let id = byKey.get(k)
      if (id === undefined) {
        id = r.id
        byKey.set(k, id)
        fresh.push(r)
      }
      if (!entries.has(id)) entries.set(id, !off.has(r.id))
    }
    if (entries.size === 0) {
      const why =
        extracted.rejected.length > 0
          ? ` ${extracted.rejected.length} line${extracted.rejected.length === 1 ? ' was' : 's were'} not valid, for example: ${extracted.rejected[0]!.line.slice(0, 80)}`
          : ''
      return { ok: false, message: `No host entries found.${why}` }
    }
    const parsed = PackageSchema.safeParse({
      id: crypto.randomUUID(),
      name: packageName.trim() || `Imported ${today()}`,
      description: `Imported on ${today()}`,
      mode: 'managed',
      entries: [...entries].map(([recordId, enabled]) => ({ recordId, enabled })),
    })
    if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
    this.library = [...this.library, ...fresh]
    this.packages = [...this.packages, parsed.data]
    await this.persist()
    return {
      ok: true,
      packageId: parsed.data.id,
      records: entries.size,
      added: fresh.length,
      disabled: [...entries.values()].filter((on) => !on).length,
      rejected: extracted.rejected.length,
      skippedSystem: extracted.skippedSystem,
    }
  }

  /** Changes whenever the file does. Polled by the window instead of a full snapshot. */
  async fileStamp(): Promise<string> {
    try {
      const s = await stat(this.hostsPath)
      return `${s.mtimeMs}:${s.size}`
    } catch {
      return 'missing'
    }
  }

  private async persist(): Promise<void> {
    await this.save('library.json', { schemaVersion: 1, records: this.library })
    await this.save('packages.json', { schemaVersion: 1, packages: this.packages })
    await this.save('settings.json', { schemaVersion: 1, ...this.settings })
    await this.save('state.json', { schemaVersion: 1, ...this.state })
  }

  /** A blocklist library runs to tens of megabytes; most changes leave it untouched. */
  private async save(name: string, data: unknown): Promise<void> {
    const text = JSON.stringify(data)
    if (this.saved.get(name) === text) return
    await writeJsonAtomic(this.p(name), data)
    this.saved.set(name, text)
  }

  /**
   * The one place the next file is computed, for preview and for apply alike. Shadowed lines
   * are always reconciled: with the setting off the covered set is empty, so nothing new is
   * commented out and anything commented earlier is restored.
   */
  private build(current: string): { next: string; conflicts: Conflict[]; shadowed: number } {
    const { lines, conflicts } = compile(this.library, this.packages, this.settings.activeStack)
    const withBlock = applyManagedBlock(parse(current), lines)
    const covered = coveredHostnames(lines)
    const shadowed = reconcileShadowedLines(withBlock, covered).moved.length
    const final = reconcileShadowedLines(
      withBlock,
      this.settings.commentShadowedLines ? covered : new Set(),
    )
    return { next: serialize(final.doc), conflicts, shadowed }
  }

  async snapshot(): Promise<AppSnapshot> {
    const hostsContent = await readFile(this.hostsPath, 'utf8')
    let preview = hostsContent
    let conflicts: Conflict[] = []
    let shadowed = 0
    let error = this.lastError
    try {
      ;({ next: preview, conflicts, shadowed } = this.build(hostsContent))
    } catch (e) {
      error = e instanceof Error ? e.message : 'could not build a preview'
    }
    return {
      hostsPath: this.hostsPath,
      sandboxed: this.sandboxed,
      hostsContent,
      preview,
      dirty: preview !== hostsContent,
      library: this.library,
      packages: this.packages,
      settings: this.settings,
      conflicts,
      shadowed,
      unimported: this.freshRecords(extractRecords(hostsContent)).length,
      backups: await this.backups.entries(),
      backupDir: this.backups.historyDirectory,
      hasOriginal: (await this.backups.readOriginal()) !== null,
      externalChange:
        this.state.lastWrittenHash !== null && this.state.lastWrittenHash !== sha(hostsContent),
      lastAppliedAt: this.state.lastAppliedAt,
      lastError: error,
    }
  }

  async setActiveStack(ids: string[]): Promise<void> {
    this.settings = { ...this.settings, activeStack: ids }
    await this.persist()
  }

  /** Optional fields may arrive explicitly undefined, which exactOptionalPropertyTypes
   *  distinguishes from absent — hence the explicit `| undefined`. */
  async setSettings(patch: { [K in keyof Settings]?: Settings[K] | undefined }): Promise<void> {
    this.settings = SettingsSchema.parse({ ...this.settings, ...patch })
    await this.persist()
  }

  async toggleEntry(packageId: string, recordId: string): Promise<void> {
    this.packages = this.packages.map((p) =>
      p.id !== packageId || p.mode !== 'managed'
        ? p
        : {
            ...p,
            entries: p.entries.map((e) =>
              e.recordId === recordId ? { ...e, enabled: !e.enabled } : e,
            ),
          },
    )
    await this.persist()
  }

  async setEntriesEnabled(
    packageId: string,
    enabled: boolean,
    recordIds?: string[],
  ): Promise<Result> {
    const p = this.packages.find((x) => x.id === packageId)
    if (!p) return { ok: false, message: 'package not found' }
    if (p.mode !== 'managed') return { ok: false, message: 'not a managed package' }
    const only = recordIds ? new Set(recordIds) : null
    this.packages = this.packages.map((x) =>
      x.id !== packageId || x.mode !== 'managed'
        ? x
        : {
            ...x,
            entries: x.entries.map((e) => (only && !only.has(e.recordId) ? e : { ...e, enabled })),
          },
    )
    await this.persist()
    return { ok: true }
  }

  /**
   * The single write path for both apply and restore. A sandbox file is the user's own, so it is
   * written directly with no password prompt and no DNS flush; anything else goes through the
   * elevated writer.
   */
  private async write(content: string): Promise<ElevationResult> {
    if (!this.sandboxed)
      return elevatedWrite({
        targetPath: this.hostsPath,
        content,
        flushDns: this.settings.flushDnsOnApply,
      })
    try {
      await writeFile(this.hostsPath, content, 'utf8')
      return { ok: true }
    } catch (e) {
      return {
        ok: false,
        cancelled: false,
        message: e instanceof Error ? e.message : 'write failed',
      }
    }
  }

  /**
   * A copy of the file as it is now, before something overwrites it. Automatic backups follow
   * the setting; a restore always backs up, since it can replace hand edits. A failure stops the
   * write: a backup that was meant to exist and does not is not something to find out later.
   */
  private async backupBeforeWrite(kind: BackupKind): Promise<string | null> {
    if (kind === 'auto' && !this.settings.autoBackup) return null
    try {
      await this.backups.snapshot(
        this.hostsPath,
        Math.max(this.settings.backupRetention, 1),
        new Date(),
        kind,
      )
      return null
    } catch (e) {
      const why = e instanceof Error ? e.message : 'unknown error'
      return `Could not back up the hosts file to ${this.backups.historyDirectory} (${why}). Nothing was written. Choose another backup folder or turn automatic backups off.`
    }
  }

  /** Writes `content` and never reports success without reading the file back. */
  private async writeVerified(
    content: string,
  ): Promise<{ ok: boolean; cancelled?: boolean; message?: string }> {
    const result = await this.write(content)
    if (!result.ok) {
      this.lastError = result.cancelled ? null : result.message
      return { ok: false, cancelled: result.cancelled, message: result.message }
    }
    const written = await readFile(this.hostsPath, 'utf8')
    if (written !== content) {
      this.lastError = 'the file on disk does not match what was written'
      return { ok: false, message: this.lastError }
    }
    this.lastError = null
    this.state = { lastWrittenHash: sha(written), lastAppliedAt: new Date().toISOString() }
    await this.persist()
    return { ok: true }
  }

  /** Write the compiled result, taking a backup first and verifying afterwards. */
  async apply(): Promise<{ ok: boolean; cancelled?: boolean; message?: string }> {
    const current = await readFile(this.hostsPath, 'utf8')
    const { next } = this.build(current)
    if (next === current) return { ok: true }
    const failed = await this.backupBeforeWrite('auto')
    if (failed) return { ok: false, message: failed }
    return this.writeVerified(next)
  }

  /**
   * Copy the hosts file, exactly as it is on disk right now, to a path of the user's choosing.
   * Plain user-level I/O: reading needs no privileges and the destination is the user's own.
   */
  async exportTo(destination: string): Promise<Result> {
    try {
      await writeFile(destination, await readFile(this.hostsPath, 'utf8'), 'utf8')
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'could not write the export' }
    }
  }

  async restoreOriginal(): Promise<{ ok: boolean; cancelled?: boolean; message?: string }> {
    const original = await this.backups.readOriginal()
    if (original === null) return { ok: false, message: 'no original was captured' }
    const failed = await this.backupBeforeWrite('restore')
    if (failed) return { ok: false, message: failed }
    const r = await this.writeVerified(original)
    // Only once the write is confirmed, so a cancelled prompt keeps the user's stack.
    if (r.ok) await this.setActiveStack([])
    return r
  }

  // ---- Backups -------------------------------------------------------------------------

  async backupNow(): Promise<Result> {
    try {
      await this.backups.snapshot(
        this.hostsPath,
        Math.max(this.settings.backupRetention, 1),
        new Date(),
        'manual',
      )
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'could not back up' }
    }
  }

  async readBackup(
    name: string,
  ): Promise<{ ok: true; content: string } | { ok: false; message: string }> {
    try {
      return { ok: true, content: await this.backups.read(name) }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'could not read the backup' }
    }
  }

  /**
   * Writes a backup back to the hosts file, backing up the current file first. Packages are
   * left as they are; if they differ from what the backup holds, that shows as pending changes.
   */
  async restoreBackup(
    name: string,
  ): Promise<{ ok: boolean; cancelled?: boolean; message?: string }> {
    const backup = await this.readBackup(name)
    if (!backup.ok) return backup
    const failed = await this.backupBeforeWrite('restore')
    if (failed) return { ok: false, message: failed }
    return this.writeVerified(backup.content)
  }

  async deleteBackup(name: string): Promise<Result> {
    try {
      await this.backups.remove(name)
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'could not delete the backup' }
    }
  }

  /** The full path of a backup, or of the folder when `name` is null. */
  backupPath(name: string | null): string {
    return name === null ? this.backups.historyDirectory : this.backups.pathOf(name)
  }

  /** Set from a native folder dialog in main. Null goes back to the data folder. */
  async setBackupDir(dir: string | null): Promise<void> {
    this.settings = { ...this.settings, backupDir: dir }
    this.backups.setHistoryDir(dir)
    await this.persist()
  }

  // ---- Library -------------------------------------------------------------------------

  private buildRecord(
    input: { ip: string; hostnames: string[]; comment?: string },
    base?: HostRecord,
  ): ReturnType<typeof HostRecordSchema.safeParse> {
    const now = new Date().toISOString()
    return HostRecordSchema.safeParse({
      id: base?.id ?? crypto.randomUUID(),
      ip: input.ip,
      hostnames: input.hostnames,
      ...(input.comment ? { comment: input.comment } : {}),
      tags: base?.tags ?? [],
      createdAt: base?.createdAt ?? now,
      updatedAt: now,
    })
  }

  /** The same validation as addRecord, without saving. Lets the form show accurate errors live. */
  validateRecord(input: { ip: string; hostnames: string[]; comment?: string }): Result {
    const parsed = this.buildRecord(input)
    return parsed.success ? { ok: true } : { ok: false, message: firstIssue(parsed.error) }
  }

  /** With `packageId`, the new record also joins that package, switched on. */
  async addRecord(
    input: { ip: string; hostnames: string[]; comment?: string },
    packageId?: string,
  ): Promise<Result & { id?: string }> {
    const parsed = this.buildRecord(input)
    if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
    const record = parsed.data
    this.library = [...this.library, record]
    if (packageId)
      this.packages = this.packages.map((p) =>
        p.id !== packageId || p.mode !== 'managed'
          ? p
          : { ...p, entries: [...p.entries, { recordId: record.id, enabled: true }] },
      )
    await this.persist()
    return { ok: true, id: record.id }
  }

  async updateRecord(
    id: string,
    patch: { ip?: string; hostnames?: string[]; comment?: string },
  ): Promise<Result> {
    const existing = this.library.find((r) => r.id === id)
    if (!existing) return { ok: false, message: 'record not found' }
    const comment = patch.comment !== undefined ? patch.comment : existing.comment
    const parsed = this.buildRecord(
      {
        ip: patch.ip ?? existing.ip,
        hostnames: patch.hostnames ?? existing.hostnames,
        ...(comment ? { comment } : {}),
      },
      existing,
    )
    if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
    this.library = this.library.map((r) => (r.id === id ? parsed.data : r))
    await this.persist()
    return { ok: true }
  }

  /** Removes the record and every package reference to it. */
  async deleteRecord(id: string): Promise<Result> {
    if (!this.library.some((r) => r.id === id)) return { ok: false, message: 'record not found' }
    this.library = this.library.filter((r) => r.id !== id)
    this.packages = this.packages.map((p) =>
      p.mode !== 'managed' ? p : { ...p, entries: p.entries.filter((e) => e.recordId !== id) },
    )
    await this.persist()
    return { ok: true }
  }

  // ---- Packages ------------------------------------------------------------------------

  async createPackage(input: {
    name: string
    description?: string
    recordIds?: string[]
  }): Promise<Result & { id?: string }> {
    const known = new Set(this.library.map((r) => r.id))
    const parsed = PackageSchema.safeParse({
      id: crypto.randomUUID(),
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      mode: 'managed',
      entries: (input.recordIds ?? [])
        .filter((id) => known.has(id))
        .map((recordId) => ({ recordId, enabled: true })),
    })
    if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
    this.packages = [...this.packages, parsed.data]
    await this.persist()
    return { ok: true, id: parsed.data.id }
  }

  /**
   * `recordIds`, when given, becomes the package's full membership. Records already present
   * keep their enabled flag; new ones start enabled.
   */
  async updatePackage(
    id: string,
    patch: { name?: string; description?: string; recordIds?: string[] },
  ): Promise<Result> {
    const existing = this.packages.find((p) => p.id === id)
    if (!existing) return { ok: false, message: 'package not found' }
    if (existing.mode !== 'managed') return { ok: false, message: 'not a managed package' }
    const known = new Set(this.library.map((r) => r.id))
    const enabledBefore = new Map(existing.entries.map((e) => [e.recordId, e.enabled]))
    const entries =
      patch.recordIds === undefined
        ? existing.entries
        : patch.recordIds
            .filter((rid) => known.has(rid))
            .map((recordId) => ({ recordId, enabled: enabledBefore.get(recordId) ?? true }))
    const { description: _old, ...rest } = existing
    const parsed = PackageSchema.safeParse({
      ...rest,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...((patch.description ?? existing.description)
        ? { description: patch.description ?? existing.description }
        : {}),
      entries,
    })
    if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
    this.packages = this.packages.map((p) => (p.id === id ? parsed.data : p))
    await this.persist()
    return { ok: true }
  }

  /** Removes the package and takes it out of the active stack. */
  async deletePackage(id: string): Promise<Result> {
    if (!this.packages.some((p) => p.id === id)) return { ok: false, message: 'package not found' }
    this.packages = this.packages.filter((p) => p.id !== id)
    this.settings = {
      ...this.settings,
      activeStack: this.settings.activeStack.filter((x) => x !== id),
    }
    await this.persist()
    return { ok: true }
  }

  async acknowledgeExternalChange(): Promise<void> {
    const current = await readFile(this.hostsPath, 'utf8')
    this.state = { ...this.state, lastWrittenHash: sha(current) }
    await this.persist()
  }
}
