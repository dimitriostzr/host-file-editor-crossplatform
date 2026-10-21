// SPDX-License-Identifier: MIT

/**
 * The IPC contract, stated explicitly rather than imported from the core.
 *
 * The renderer runs sandboxed and cannot load Node modules, so importing the core's types would
 * drag `node:net` into a program that cannot resolve it. Writing the wire shapes out here also
 * makes the boundary visible: this is everything the interface is allowed to know.
 */

export interface HostRecordDto {
  id: string
  ip: string
  hostnames: string[]
  comment?: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface PackageEntryDto {
  recordId: string
  enabled: boolean
}

export type PackageDto =
  | {
      id: string
      name: string
      description?: string
      color?: string
      mode: 'managed'
      entries: PackageEntryDto[]
    }
  | {
      id: string
      name: string
      description?: string
      color?: string
      mode: 'full-file'
      rawContent: string
    }

export interface BackupDto {
  name: string
  kind: 'auto' | 'manual' | 'restore'
  at: string
  size: number
}

export interface SettingsDto {
  activeStack: string[]
  flushDnsOnApply: boolean
  commentShadowedLines: boolean
  backupRetention: number
  autoBackup: boolean
  backupDir: string | null
  themeId: string
  themeMode: 'system' | 'light' | 'dark'
}

export interface ConflictDto {
  hostname: string
  winner: { ip: string; packageName: string }
  losers: { ip: string; packageName: string }[]
}

export interface AppSnapshot {
  hostsPath: string
  sandboxed: boolean
  hostsContent: string
  preview: string
  dirty: boolean
  library: HostRecordDto[]
  packages: PackageDto[]
  settings: SettingsDto
  conflicts: ConflictDto[]
  /** Plain lines above the block that the block covers and would comment out. */
  shadowed: number
  /** Entry lines in the file (commented out or not) that the library does not have. */
  unimported: number
  backups: BackupDto[]
  backupDir: string
  hasOriginal: boolean
  externalChange: boolean
  /** ISO timestamp of the last successful write by hostserrer, or null if it never wrote. */
  lastAppliedAt: string | null
  lastError: string | null
}

export type Result = { ok: true } | { ok: false; message: string }

export type LinkKind = 'repo' | 'license'
export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  dataDir: string
  links: Record<LinkKind, string>
}

export type ToolKind = 'ping' | 'traceroute'
export type LookupKind = 'google' | 'dnschecker' | 'whatsmydns'
export type ToolMessage =
  | { jobId: string; type: 'chunk'; text: string }
  | { jobId: string; type: 'done'; code: number | null; note?: string }

export interface WriteResult {
  ok: boolean
  cancelled?: boolean
  message?: string
}

export type ImportFromFileResult =
  | { ok: true; added: number; disabled: number; packageId: string | null }
  | { ok: false; message: string }

export type ImportTextResult =
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

export type ExportResult =
  { ok: true; path: string } | { ok: false; cancelled?: boolean; message?: string }

declare global {
  interface Window {
    hostserrer: {
      platform: string
      onFullScreen(cb: (on: boolean) => void): () => void
      dimTitleBar(on: boolean): Promise<{ ok: boolean }>
      confirm(input: { message: string; detail?: string; confirmLabel: string }): Promise<boolean>
      snapshot(): Promise<AppSnapshot>
      appInfo(): Promise<AppInfo>
      openLink(kind: LinkKind): Promise<{ ok: boolean }>
      setActiveStack(ids: string[]): Promise<{ ok: boolean }>
      setSettings(patch: Partial<SettingsDto>): Promise<{ ok: boolean }>
      toggleEntry(packageId: string, recordId: string): Promise<{ ok: boolean }>
      addRecord(input: {
        ip: string
        hostnames: string[]
        comment?: string
        packageId?: string
      }): Promise<Result & { id?: string }>
      importText(input: { text: string; packageName: string }): Promise<ImportTextResult>
      fileStamp(): Promise<string>
      backupNow(): Promise<Result>
      readBackup(
        name: string,
      ): Promise<{ ok: true; content: string } | { ok: false; message: string }>
      restoreBackup(name: string): Promise<WriteResult>
      deleteBackup(name: string): Promise<Result>
      revealBackup(name: string | null): Promise<Result>
      chooseBackupDir(): Promise<{ ok: boolean; cancelled?: boolean }>
      resetBackupDir(): Promise<{ ok: boolean }>
      updateRecord(input: {
        id: string
        ip?: string
        hostnames?: string[]
        comment?: string
      }): Promise<Result>
      deleteRecord(id: string): Promise<Result>
      createPackage(input: {
        name: string
        description?: string
        recordIds?: string[]
      }): Promise<Result & { id?: string }>
      updatePackage(input: {
        id: string
        name?: string
        description?: string
        recordIds?: string[]
      }): Promise<Result>
      deletePackage(id: string): Promise<Result>
      validateRecord(input: { ip: string; hostnames: string[]; comment?: string }): Promise<Result>
      setEntriesEnabled(input: {
        packageId: string
        enabled: boolean
        recordIds?: string[]
      }): Promise<Result>
      openLookup(input: { kind: LookupKind; target: string }): Promise<Result>
      toolStart(input: { kind: ToolKind; target: string }): Promise<Result & { jobId?: string }>
      toolStop(jobId: string): Promise<{ ok: boolean }>
      onTool(cb: (msg: ToolMessage) => void): () => void
      apply(): Promise<WriteResult>
      restoreOriginal(): Promise<WriteResult>
      exportHosts(): Promise<ExportResult>
      importFromFile(): Promise<ImportFromFileResult>
      acknowledgeExternalChange(): Promise<{ ok: boolean }>
    }
  }
}
