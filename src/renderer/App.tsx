// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileText,
  Import,
  Info,
  Library,
  History,
  Plus,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react'
import type { AppSnapshot, PackageDto, ToolKind, ToolMessage } from './env.js'
import { countChanges, diffLines } from './lib/diff.js'
import { applyThemeMode, type ThemeMode } from './lib/theme.js'
import { kbd, useShortcut } from './lib/shortcut.js'
import { cn } from './lib/cn.js'
import { Badge, Button, IconButton, Input, Switch } from './components/ui.js'
import { Logo } from './components/Logo.js'
import { ThemeControl } from './components/ThemeControl.js'
import { HostsFile } from './components/HostsFile.js'
import { ApplyPreview } from './components/ApplyPreview.js'
import { LibraryView } from './components/LibraryView.js'
import { PackageEditor } from './components/PackageEditor.js'
import { ToolConsole, type ToolJob } from './components/ToolConsole.js'
import { About } from './components/About.js'
import { ImportDialog } from './components/ImportDialog.js'
import { BackupsView } from './components/BackupsView.js'

type View =
  | { kind: 'package'; id: string }
  | { kind: 'library' }
  | { kind: 'file' }
  | { kind: 'backups' }
  | { kind: 'about' }

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

const isMac = window.hostserrer.platform === 'darwin'
/**
 * Windows and Linux draw their window controls over the right end of the header. The
 * titlebar-area variables say where they start; the fallback is Windows' three 46 px buttons.
 */
const clearWindowControls = {
  paddingRight:
    'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 138px)) + 12px)',
} as React.CSSProperties

const formatWhen = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const applyToolMessage = (job: ToolJob, msg: ToolMessage): ToolJob =>
  msg.type === 'chunk'
    ? { ...job, output: job.output + msg.text }
    : { ...job, done: true, code: msg.code, ...(msg.note ? { note: msg.note } : {}) }

function PackageRow({
  pkg,
  index,
  total,
  selected,
  onSelect,
  onToggle,
  onMove,
}: {
  pkg: PackageDto
  index: number | null
  total: number
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onMove: (delta: number) => void
}) {
  const active = index !== null
  const entries = pkg.mode === 'managed' ? pkg.entries : []
  const on = entries.filter((e) => e.enabled).length
  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 py-1.5 pr-1.5 pl-3',
        selected && 'bg-secondary',
      )}
    >
      <Switch
        checked={active}
        onChange={onToggle}
        label={`${active ? 'Switch off' : 'Switch on'} ${pkg.name}`}
      />
      <span
        aria-hidden="true"
        className={cn(
          'w-5 shrink-0 rounded text-center font-mono text-[11px] leading-5',
          active ? 'bg-primary/10 text-foreground' : 'text-transparent',
        )}
      >
        {active ? index + 1 : '·'}
      </span>
      <button
        onClick={onSelect}
        className={cn(
          'flex min-w-0 flex-1 items-baseline gap-2 text-left',
          !active && 'text-muted-foreground',
        )}
      >
        <span className="truncate text-[13px]">{pkg.name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground/70">
          {active
            ? `${on.toLocaleString()}/${entries.length.toLocaleString()}`
            : entries.length.toLocaleString()}
        </span>
      </button>
      {active && (
        // Floated over the end of the row, so the name only gives way while they are shown.
        <span
          className={cn(
            'absolute inset-y-0 right-1.5 flex items-center pl-2 opacity-0 transition-opacity',
            'focus-within:opacity-100 group-hover:opacity-100',
            selected ? 'bg-secondary' : 'bg-background',
          )}
        >
          <IconButton
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Move up"
            title="Move up"
          >
            <ArrowUp className="size-3.5" />
          </IconButton>
          <IconButton
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label="Move down"
            title="Move down"
          >
            <ArrowDown className="size-3.5" />
          </IconButton>
        </span>
      )}
    </div>
  )
}

function NavItem({
  active,
  onClick,
  icon,
  label,
  trailing,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  trailing?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]',
        active
          ? 'bg-secondary'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
      )}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {trailing !== undefined && (
        <span className="text-[11px] text-muted-foreground/70">{trailing}</span>
      )}
    </button>
  )
}

export default function App() {
  const [snap, setSnap] = useState<AppSnapshot | null>(null)
  const [view, setView] = useState<View>({ kind: 'file' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [newName, setNewName] = useState('')
  const [jobs, setJobs] = useState<ToolJob[]>([])
  const [activeJob, setActiveJob] = useState<string | null>(null)
  // Output can arrive before toolStart resolves with the job id; hold it until the job exists.
  const early = useRef(new Map<string, ToolMessage[]>())

  const refresh = useCallback(async () => setSnap(await window.hostserrer.snapshot()), [])

  useEffect(() => {
    // The file can change under us — another tool, or a hand edit. Poll its modification time
    // and size, which is cheap, and take a full snapshot only when they change.
    let last: string | null = null
    let stopped = false
    void (async () => {
      last = await window.hostserrer.fileStamp()
      if (!stopped) await refresh()
    })()
    const t = setInterval(async () => {
      const stamp = await window.hostserrer.fileStamp()
      if (last !== null && stamp !== last) void refresh()
      last = stamp
    }, 2000)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [refresh])

  useEffect(
    () =>
      window.hostserrer.onTool((msg) =>
        setJobs((js) => {
          if (!js.some((j) => j.id === msg.jobId)) {
            early.current.set(msg.jobId, [...(early.current.get(msg.jobId) ?? []), msg])
            return js
          }
          return js.map((j) => (j.id === msg.jobId ? applyToolMessage(j, msg) : j))
        }),
      ),
    [],
  )

  const themeMode: ThemeMode = snap?.settings.themeMode ?? 'system'
  useEffect(() => applyThemeMode(themeMode), [themeMode])

  const [fullScreen, setFullScreen] = useState(false)
  useEffect(() => window.hostserrer.onFullScreen(setFullScreen), [])

  // Keyed on the two texts, not the snapshot: most refreshes leave both unchanged.
  const hostsContent = snap?.hostsContent ?? ''
  const previewText = snap?.preview ?? ''
  const diff = useMemo(() => diffLines(hostsContent, previewText), [hostsContent, previewText])
  const { added, removed } = useMemo(() => countChanges(diff), [diff])

  useShortcut('Enter', () => setPreviewing(true), !!snap?.dirty && !busy && !previewing)

  if (!snap)
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
        Reading your hosts file…
      </div>
    )

  const stack = snap.settings.activeStack
  const byId = new Map(snap.packages.map((p) => [p.id, p]))
  const ordered: { pkg: PackageDto; index: number | null }[] = [
    ...stack.flatMap((id, i) => (byId.has(id) ? [{ pkg: byId.get(id)!, index: i }] : [])),
    ...snap.packages
      .filter((p) => !stack.includes(p.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((pkg) => ({ pkg, index: null })),
  ]
  const selectedPkg = view.kind === 'package' ? byId.get(view.id) : undefined

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const setStack = (ids: string[]) => act(() => window.hostserrer.setActiveStack(ids))
  const toggleActive = (id: string) =>
    setStack(stack.includes(id) ? stack.filter((x) => x !== id) : [...stack, id])
  const move = (id: string, delta: number) => {
    const i = stack.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= stack.length) return
    const copy = [...stack]
    copy[i] = copy[j]!
    copy[j] = id
    void setStack(copy)
  }

  const createPackage = async () => {
    const name = newName.trim()
    if (!name) return
    const r = await window.hostserrer.createPackage({ name })
    if (r.ok && r.id) {
      setCreating(false)
      setNewName('')
      setView({ kind: 'package', id: r.id })
      await refresh()
    } else if (!r.ok) setNotice(r.message)
  }

  const runTool = async (kind: ToolKind, target: string) => {
    const r = await window.hostserrer.toolStart({ kind, target })
    if (!r.ok) {
      setNotice(r.message)
      return
    }
    const id = r.jobId!
    setJobs((js) => {
      const buffered = early.current.get(id) ?? []
      early.current.delete(id)
      const job = buffered.reduce(applyToolMessage, {
        id,
        kind,
        target,
        output: '',
        done: false,
        code: null,
      })
      return [...js, job]
    })
    setActiveJob(id)
  }
  const stopJob = (id: string) => void window.hostserrer.toolStop(id)
  const closeJob = (id: string) => {
    if (!jobs.find((j) => j.id === id)?.done) stopJob(id)
    setJobs((js) => js.filter((j) => j.id !== id))
    setActiveJob((cur) => (cur === id ? null : cur))
  }

  const apply = async () => {
    setBusy(true)
    try {
      const r = await window.hostserrer.apply()
      if (r.ok) setNotice(null)
      await refresh()
      return r
    } finally {
      setBusy(false)
    }
  }
  const importFromFile = () =>
    act(async () => {
      const r = await window.hostserrer.importFromFile()
      if (!r.ok) setNotice(r.message)
      else if (r.added === 0)
        setNotice('Nothing new: every line in the file is already in the library.')
      else {
        const off =
          r.disabled > 0 ? `, ${r.disabled} switched off because the line is commented out` : ''
        setNotice(`Added ${r.added} record${r.added === 1 ? '' : 's'} to a new package${off}.`)
        if (r.packageId) setView({ kind: 'package', id: r.packageId })
      }
    })
  const exportHosts = () =>
    act(async () => {
      const r = await window.hostserrer.exportHosts()
      if (r.ok) setNotice(`Exported to ${r.path}`)
      else if (!r.cancelled) setNotice(r.message ?? 'Export failed')
    })
  const restore = () =>
    act(async () => {
      const ok = await window.hostserrer.confirm({
        message: 'Restore the original hosts file?',
        detail:
          'This writes the file as it was when hostserrer first ran and switches every package off. A backup of the current file is taken first.',
        confirmLabel: 'Restore',
      })
      if (!ok) return
      const r = await window.hostserrer.restoreOriginal()
      setNotice(
        r.ok ? 'Original hosts file restored.' : r.cancelled ? 'Cancelled.' : (r.message ?? null),
      )
    })

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header
        className={cn(
          'flex h-11 shrink-0 items-center gap-2.5 border-b select-none',
          isMac ? (fullScreen ? 'pr-3 pl-4' : 'pr-3 pl-20') : 'pl-3.5',
        )}
        style={isMac ? drag : { ...drag, ...clearWindowControls }}
      >
        <Logo className="size-5" />
        <span className="text-[13px] font-semibold tracking-tight">hostserrer</span>
        <span className="font-mono text-[12px] text-muted-foreground">{snap.hostsPath}</span>
        {snap.sandboxed && (
          <Badge tone="warning" className="gap-1">
            <TriangleAlert className="size-3" aria-hidden="true" />
            sandbox
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2" style={noDrag}>
          <ThemeControl
            value={themeMode}
            onChange={(m) => void act(() => window.hostserrer.setSettings({ themeMode: m }))}
          />
        </div>
      </header>

      {snap.externalChange && (
        <div className="flex items-center gap-3 border-b bg-warning/10 px-4 py-2 text-[12px]">
          <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>Something else changed this file since hostserrer last wrote it.</span>
          <Button
            variant="secondary"
            className="ml-auto h-7"
            onClick={() => act(() => window.hostserrer.acknowledgeExternalChange())}
          >
            Keep their changes
          </Button>
        </div>
      )}
      {snap.unimported > 0 && (
        <div className="flex items-center gap-3 border-b px-4 py-2 text-[12px]">
          <Import className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            {snap.unimported} line{snap.unimported === 1 ? '' : 's'} in the file{' '}
            {snap.unimported === 1 ? 'is' : 'are'} not in your library yet. Commented-out lines are
            imported switched off.
          </span>
          <Button
            variant="secondary"
            className="ml-auto h-7"
            onClick={importFromFile}
            disabled={busy}
          >
            Import {snap.unimported === 1 ? 'it' : 'them'}
          </Button>
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-3 border-b px-4 py-2 text-[12px]">
          <span>{notice}</span>
          <Button variant="ghost" className="ml-auto h-7" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r select-none">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <nav className="py-2">
              <NavItem
                active={view.kind === 'file'}
                onClick={() => setView({ kind: 'file' })}
                icon={<FileText className="size-3.5" />}
                label="Hosts file"
                trailing={
                  snap.dirty ? (
                    <span className="font-mono">
                      <span className="text-diff-add">+{added.toLocaleString()}</span>{' '}
                      <span className="text-diff-remove">−{removed.toLocaleString()}</span>
                    </span>
                  ) : undefined
                }
              />
              <NavItem
                active={view.kind === 'library'}
                onClick={() => setView({ kind: 'library' })}
                icon={<Library className="size-3.5" />}
                label="Library"
                trailing={snap.library.length.toLocaleString()}
              />
              <NavItem
                active={view.kind === 'backups'}
                onClick={() => setView({ kind: 'backups' })}
                icon={<History className="size-3.5" />}
                label="Backups"
                trailing={snap.backups.length.toLocaleString()}
              />
            </nav>

            <div className="border-t">
              <div className="flex items-center px-3 pt-3 pb-1">
                <span className="text-[11px] font-semibold text-muted-foreground">Packages</span>
                <span className="ml-1.5 text-[11px] text-muted-foreground/70">
                  {stack.length}/{snap.packages.length} on
                </span>
                <IconButton
                  className="ml-auto size-6"
                  aria-label="New package"
                  title="New package"
                  onClick={() => setCreating(true)}
                >
                  <Plus className="size-3.5" />
                </IconButton>
              </div>
              <p className="px-3 pb-2 text-[11px] leading-snug text-muted-foreground/80">
                Switched-on packages are written to the file. A higher number overrides a lower one.
              </p>
              {creating && (
                <form
                  className="flex items-center gap-1 px-3 py-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void createPackage()
                  }}
                >
                  <Input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Package name"
                    className="h-7"
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setCreating(false)
                        setNewName('')
                      }
                    }}
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    className="h-7"
                    disabled={!newName.trim()}
                  >
                    Create
                  </Button>
                </form>
              )}
              {ordered.length === 0 && !creating && (
                <p className="px-3 py-2 text-[12px] text-muted-foreground">No packages yet.</p>
              )}
              {ordered.map(({ pkg, index }) => (
                <PackageRow
                  key={pkg.id}
                  pkg={pkg}
                  index={index}
                  total={stack.length}
                  selected={view.kind === 'package' && view.id === pkg.id}
                  onSelect={() => setView({ kind: 'package', id: pkg.id })}
                  onToggle={() => void toggleActive(pkg.id)}
                  onMove={(d) => move(pkg.id, d)}
                />
              ))}
              <div className="h-3" />
            </div>
          </div>

          <div className="shrink-0 border-t px-3 py-3">
            <div className="flex items-center">
              <span className="text-[11px] font-semibold text-muted-foreground">This file</span>
              <IconButton
                className="ml-auto size-6"
                aria-label="Re-read the hosts file"
                title="Re-read the hosts file from disk"
                disabled={busy}
                onClick={() => void act(async () => {})}
              >
                <RefreshCw className="size-3.5" />
              </IconButton>
            </div>
            <dl className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0">Last applied</dt>
                <dd className="truncate text-foreground/80">
                  {snap.lastAppliedAt ? formatWhen(snap.lastAppliedAt) : 'never, by hostserrer'}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0">Backups</dt>
                <dd>
                  <button
                    className="text-foreground/80 hover:text-foreground hover:underline"
                    onClick={() => setView({ kind: 'backups' })}
                  >
                    {snap.backups.length.toLocaleString()} kept
                    {snap.hasOriginal ? ', plus the original' : ''}
                  </button>
                </dd>
              </div>
            </dl>
            <div className="mt-2.5 flex gap-1">
              <Button
                variant="secondary"
                className="h-7 flex-1 px-2"
                onClick={exportHosts}
                disabled={busy}
                title="Save a copy of the hosts file as it is on disk"
              >
                <Download className="size-3.5" aria-hidden="true" />
                Export
              </Button>
              <Button
                variant="secondary"
                className="h-7 flex-1 px-2"
                onClick={restore}
                disabled={busy || !snap.hasOriginal}
                title="Write back the file captured when hostserrer first ran"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Restore
              </Button>
            </div>
          </div>
          <div className="shrink-0 border-t py-1">
            <NavItem
              active={view.kind === 'about'}
              onClick={() => setView({ kind: 'about' })}
              icon={<Info className="size-3.5" />}
              label="About hostserrer"
            />
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col">
            {view.kind === 'about' && <About hostsPath={snap.hostsPath} />}
            {view.kind === 'backups' && (
              <BackupsView
                snap={snap}
                onChanged={refresh}
                onRestoreOriginal={restore}
                onNotice={setNotice}
              />
            )}
            {view.kind === 'library' && (
              <LibraryView
                library={snap.library}
                packages={snap.packages}
                onChanged={refresh}
                onImport={() => setImporting(true)}
                onRunTool={(k, t) => void runTool(k, t)}
              />
            )}
            {view.kind === 'package' && selectedPkg?.mode === 'managed' && (
              <PackageEditor
                pkg={selectedPkg}
                library={snap.library}
                isActive={stack.includes(selectedPkg.id)}
                onChanged={refresh}
                onDeleted={() => setView({ kind: 'file' })}
                onRunTool={(k, t) => void runTool(k, t)}
              />
            )}
            {(view.kind === 'file' || (view.kind === 'package' && !selectedPkg)) && (
              <>
                {stack.length === 0 && (
                  <div className="flex items-center gap-3 border-b bg-secondary/40 px-4 py-2.5 text-[12px]">
                    <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span>
                      {snap.packages.length === 0 ? (
                        <>
                          Start in the <strong className="font-medium">Library</strong>: add records
                          or import a blocklist, then group them into a package.
                        </>
                      ) : (
                        <>
                          Nothing from hostserrer is in this file yet. Switch a package on in the
                          sidebar, then <strong className="font-medium">Preview and apply</strong>.
                        </>
                      )}
                    </span>
                    {snap.packages.length === 0 && (
                      <Button
                        variant="secondary"
                        className="ml-auto h-7"
                        onClick={() => setView({ kind: 'library' })}
                      >
                        Open the library
                      </Button>
                    )}
                  </div>
                )}
                <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4 text-[12px] text-muted-foreground">
                  <span>Your hosts file, as it is on disk right now</span>
                  {snap.conflicts.length > 0 && (
                    <Badge tone="destructive">
                      {snap.conflicts.length} conflict{snap.conflicts.length === 1 ? '' : 's'}{' '}
                      resolved
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    className="ml-auto h-7"
                    onClick={importFromFile}
                    disabled={busy}
                    title="Add lines from this file that the library does not have yet, including commented-out ones"
                  >
                    <Import className="size-3.5" aria-hidden="true" />
                    Import new lines
                  </Button>
                </div>
                <div className="min-h-0 flex-1">
                  <HostsFile
                    content={snap.hostsContent}
                    packages={snap.packages}
                    onOpenPackage={(id) => setView({ kind: 'package', id })}
                  />
                </div>
              </>
            )}
          </div>
          {jobs.length > 0 && (
            <ToolConsole
              jobs={jobs}
              activeId={activeJob}
              onSelect={setActiveJob}
              onStop={stopJob}
              onClose={closeJob}
            />
          )}
        </main>
      </div>

      <footer className="shrink-0 border-t select-none">
        <div className="flex h-12 items-center gap-3 px-4">
          <span className="text-[13px]">
            {snap.dirty ? (
              <>
                <span className="font-medium">
                  {(added + removed).toLocaleString()} pending change
                  {added + removed === 1 ? '' : 's'}
                </span>
                <span className="ml-2 font-mono text-[12px]">
                  <span className="text-diff-add">+{added.toLocaleString()}</span>{' '}
                  <span className="text-diff-remove">−{removed.toLocaleString()}</span>
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">No pending changes</span>
            )}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => void setStack([])}
              disabled={busy || stack.length === 0}
            >
              Switch all off
            </Button>
            <Button
              variant="primary"
              onClick={() => setPreviewing(true)}
              disabled={busy || !snap.dirty}
              title={`See exactly what will change, then write it (${kbd('Enter')})`}
            >
              {busy ? 'Working…' : 'Preview and apply'}
            </Button>
          </div>
        </div>
      </footer>

      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImported={(r, name) => {
            setImporting(false)
            const parts = [
              `Imported ${r.records.toLocaleString()} record${r.records === 1 ? '' : 's'} into “${name}”`,
              r.records !== r.added
                ? `${(r.records - r.added).toLocaleString()} already in the library`
                : '',
              r.disabled > 0 ? `${r.disabled.toLocaleString()} switched off` : '',
              r.rejected > 0
                ? `${r.rejected.toLocaleString()} invalid line${r.rejected === 1 ? '' : 's'} skipped`
                : '',
            ].filter(Boolean)
            setNotice(`${parts.join(', ')}. Switch the package on in the sidebar to use it.`)
            setView({ kind: 'package', id: r.packageId })
            void refresh()
          }}
        />
      )}
      {previewing && (
        <ApplyPreview
          hostsPath={snap.hostsPath}
          diff={diff}
          conflicts={snap.conflicts}
          shadowed={snap.shadowed}
          commentShadowed={snap.settings.commentShadowedLines}
          onToggleShadowed={() =>
            void act(() =>
              window.hostserrer.setSettings({
                commentShadowedLines: !snap.settings.commentShadowedLines,
              }),
            )
          }
          onApply={apply}
          onClose={() => setPreviewing(false)}
        />
      )}
    </div>
  )
}
