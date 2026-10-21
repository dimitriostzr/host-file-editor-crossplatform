// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react'
import { Eye, FolderOpen, Save, Trash2 } from 'lucide-react'
import type { AppSnapshot, BackupDto, WriteResult } from '../env.js'
import { Button, IconButton, Input, Switch } from './ui.js'
import { CompareDialog } from './CompareDialog.js'

const KIND_LABEL: Record<BackupDto['kind'], string> = {
  auto: 'Before apply',
  manual: 'Manual',
  restore: 'Before restore',
}

const formatWhen = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })

const formatSize = (n: number): string =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`

/**
 * Every copy of the hosts file the app has kept, the settings for taking them, and restore.
 * Restoring shows exactly what would change first, and backs up the current file before
 * writing, so a restore can itself be undone.
 */
export function BackupsView({
  snap,
  onChanged,
  onRestoreOriginal,
  onNotice,
}: {
  snap: AppSnapshot
  onChanged: () => Promise<void>
  onRestoreOriginal: () => void
  onNotice: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [comparing, setComparing] = useState<{ backup: BackupDto; content: string } | null>(null)
  const [retention, setRetention] = useState(String(snap.settings.backupRetention))
  useEffect(
    () => setRetention(String(snap.settings.backupRetention)),
    [snap.settings.backupRetention],
  )

  const run = async (fn: () => Promise<{ ok: boolean; message?: string }>, done?: string) => {
    setBusy(true)
    try {
      const r = await fn()
      if (!r.ok && r.message) onNotice(r.message)
      else if (r.ok && done) onNotice(done)
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  const saveRetention = () => {
    const n = Number.parseInt(retention, 10)
    if (!Number.isFinite(n) || n < 1 || n > 1000) {
      setRetention(String(snap.settings.backupRetention))
      return
    }
    if (n !== snap.settings.backupRetention)
      void run(() => window.hostserrer.setSettings({ backupRetention: n }))
  }

  const view = async (backup: BackupDto) => {
    const r = await window.hostserrer.readBackup(backup.name)
    if (r.ok) setComparing({ backup, content: r.content })
    else onNotice(r.message)
  }

  const customDir = snap.settings.backupDir !== null

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
        <span className="text-[13px] font-medium">Backups</span>
        <span className="text-[12px] text-muted-foreground">
          {snap.backups.length.toLocaleString()} kept
          {snap.hasOriginal ? ', plus the original' : ''}
        </span>
        <Button
          variant="primary"
          className="ml-auto h-7"
          disabled={busy}
          onClick={() => void run(() => window.hostserrer.backupNow(), 'Backed up the hosts file.')}
        >
          <Save className="size-3.5" aria-hidden="true" />
          Back up now
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <section className="space-y-3 border-b px-4 py-4 select-none">
          <label className="flex items-center gap-3 text-[13px]">
            <Switch
              checked={snap.settings.autoBackup}
              onChange={() =>
                void run(() =>
                  window.hostserrer.setSettings({ autoBackup: !snap.settings.autoBackup }),
                )
              }
              label="Back up automatically before every change"
            />
            <span>Back up automatically before every change to the hosts file</span>
          </label>
          <div className="flex items-center gap-2 pl-12 text-[13px] text-muted-foreground">
            <span>Keep the last</span>
            <Input
              type="number"
              min={1}
              max={1000}
              value={retention}
              disabled={!snap.settings.autoBackup}
              onChange={(e) => setRetention(e.target.value)}
              onBlur={saveRetention}
              onKeyDown={(e) => e.key === 'Enter' && saveRetention()}
              aria-label="Automatic backups to keep"
              className="h-7 w-20"
            />
            <span>automatic backups. Manual backups are kept until you delete them.</span>
          </div>
          <div className="flex items-center gap-2 pl-12 text-[13px]">
            <span className="text-muted-foreground">Folder</span>
            <span
              className="min-w-0 truncate rounded bg-secondary px-2 py-0.5 font-mono text-[12px] select-text"
              title={snap.backupDir}
            >
              {snap.backupDir}
            </span>
            <Button
              variant="secondary"
              className="h-7 shrink-0"
              disabled={busy}
              onClick={() => void run(() => window.hostserrer.chooseBackupDir())}
            >
              Change…
            </Button>
            {customDir && (
              <Button
                variant="ghost"
                className="h-7 shrink-0"
                disabled={busy}
                onClick={() => void run(() => window.hostserrer.resetBackupDir())}
                title="Back to the app's own data folder"
              >
                Use default
              </Button>
            )}
            <IconButton
              aria-label="Open the backup folder"
              title="Open the backup folder"
              onClick={() => void run(() => window.hostserrer.revealBackup(null))}
            >
              <FolderOpen className="size-3.5" />
            </IconButton>
          </div>
          <p className="pl-12 text-[11px] text-muted-foreground/80">
            Changing the folder does not move existing backups; they stay where they are.
          </p>
        </section>

        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b text-left text-[11px] font-medium text-muted-foreground">
              <th className="px-4 py-1.5 font-medium">Taken</th>
              <th className="px-2 py-1.5 font-medium">Kind</th>
              <th className="px-2 py-1.5 text-right font-medium">Size</th>
              <th className="w-44 px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {snap.hasOriginal && (
              <tr className="group border-b bg-secondary/30 hover:bg-secondary/50">
                <td className="px-4 py-1.5">Original</td>
                <td className="px-2 py-1.5 text-muted-foreground" colSpan={2}>
                  As it was when hostserrer first ran. Never deleted.
                </td>
                <td className="px-2 py-1 text-right">
                  <Button
                    variant="ghost"
                    className="h-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={onRestoreOriginal}
                  >
                    Restore…
                  </Button>
                </td>
              </tr>
            )}
            {snap.backups.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                  No backups in this folder yet.{' '}
                  {snap.settings.autoBackup
                    ? 'One is taken before every change to the hosts file.'
                    : 'Automatic backups are off.'}
                </td>
              </tr>
            )}
            {snap.backups.map((b) => (
              <tr key={b.name} className="group border-b hover:bg-secondary/50">
                <td className="px-4 py-1.5">{formatWhen(b.at)}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{KIND_LABEL[b.kind]}</td>
                <td className="px-2 py-1.5 text-right font-mono text-[12px] text-muted-foreground">
                  {formatSize(b.size)}
                </td>
                <td className="px-2 py-1 text-right">
                  <span className="inline-flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button variant="ghost" className="h-7" onClick={() => void view(b)}>
                      <Eye className="size-3.5" aria-hidden="true" />
                      View and restore
                    </Button>
                    <IconButton
                      aria-label="Show in folder"
                      title="Show in folder"
                      onClick={() => void run(() => window.hostserrer.revealBackup(b.name))}
                    >
                      <FolderOpen className="size-3.5" />
                    </IconButton>
                    <IconButton
                      aria-label="Delete backup"
                      title="Delete"
                      onClick={async () => {
                        const ok = await window.hostserrer.confirm({
                          message: 'Delete this backup?',
                          detail: `${KIND_LABEL[b.kind]}, ${formatWhen(b.at)}. The file is removed from the backup folder.`,
                          confirmLabel: 'Delete',
                        })
                        if (ok) void run(() => window.hostserrer.deleteBackup(b.name))
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {comparing && (
        <CompareDialog
          title="Restore this backup?"
          subtitle={`${KIND_LABEL[comparing.backup.kind]}, ${formatWhen(comparing.backup.at)} — what restoring it would change in the hosts file. The current file is backed up first.`}
          before={snap.hostsContent}
          after={comparing.content}
          actionLabel="Restore this backup"
          onAction={async (): Promise<WriteResult> => {
            const r = await window.hostserrer.restoreBackup(comparing.backup.name)
            if (r.ok) onNotice('Backup restored. The file you replaced was backed up first.')
            await onChanged()
            return r
          }}
          onClose={() => setComparing(null)}
        />
      )}
    </div>
  )
}
