// SPDX-License-Identifier: MIT

import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
} from 'electron'
import { z } from 'zod'
import { DATA_DIR_ENV, HOSTS_PATH_ENV, resolveHostsPath } from '../core/hosts-path.js'
import { HostsService } from './hosts-service.js'
import { isSafeTarget, lookupUrl, runTool, type ToolHandle } from './net-tools.js'

// The sandbox overrides are for development and the demo. A packaged build ignores them, so an
// installed app can never mix a throwaway file into the real library or "original" backup.
const devEnv: NodeJS.ProcessEnv = app.isPackaged
  ? { ...process.env, [HOSTS_PATH_ENV]: undefined, [DATA_DIR_ENV]: undefined }
  : process.env

const isMac = process.platform === 'darwin'

/**
 * The header's own colours (--background and --foreground in index.css), for the parts of the
 * window the OS draws: the window background before first paint, and on Windows and Linux the
 * minimise, maximise and close buttons laid over the right end of the header.
 */
const CHROME = {
  light: { color: '#ffffff', symbolColor: '#0a0a0a' },
  dark: { color: '#0a0a0a', symbolColor: '#fafafa' },
} as const
/** The same colours under a dialog's 50% black backdrop (bg-black/50). */
const DIMMED = {
  light: { color: '#808080', symbolColor: '#050505' },
  dark: { color: '#050505', symbolColor: '#7d7d7d' },
} as const
const chrome = () => CHROME[nativeTheme.shouldUseDarkColors ? 'dark' : 'light']
/** The header is h-11 (44 px) including its 1 px bottom border, which the controls must not cover. */
const OVERLAY_HEIGHT = 43

// Set before the instance lock, which lives in userData: a demo pointed at its own directory
// can then run beside the real app instead of handing off to it.
const dataDirOverride = devEnv[DATA_DIR_ENV]?.trim()
if (dataDirOverride) app.setPath('userData', dataDirOverride)

// One instance only. A second launch hands off to the first and exits, so the user never ends
// up with several windows editing the same file.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  main()
}

function main(): void {
  // Constructed inside whenReady: the constructor calls app.getPath, which is not available
  // until Electron is ready.
  let service: HostsService
  let win: BrowserWindow | null = null

  const iconPath = join(__dirname, '../../resources/icon.png')

  function createWindow(): void {
    win = new BrowserWindow({
      width: 1180,
      height: 760,
      minWidth: 880,
      minHeight: 560,
      show: false,
      icon: iconPath,
      // The header is the title bar on every platform. macOS keeps its traffic lights inset in
      // it; Windows and Linux get the native window controls drawn over its right end.
      titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
      ...(isMac ? {} : { titleBarOverlay: { ...chrome(), height: OVERLAY_HEIGHT } }),
      backgroundColor: chrome().color,
      webPreferences: {
        // __dirname: this file is bundled to CommonJS (see electron.vite.config.ts).
        preload: join(__dirname, '../preload/index.cjs'),
        // The renderer orchestrates a root write. It gets no Node, no remote module, and a
        // context-isolated bridge with an explicitly enumerated surface.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })

    // Shown once painted, and never raised over other windows after that.
    win.once('ready-to-show', () => win?.show())

    // The renderer has no links of its own; external URLs go through the openLink and
    // openLookup handlers, which build them in main. Anything else is refused, not opened.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    // The header reserves room for the traffic lights, which macOS hides in full screen.
    const sendFullScreen = (on: boolean) => win?.webContents.send('hostserrer:fullscreen', on)
    win.on('enter-full-screen', () => sendFullScreen(true))
    win.on('leave-full-screen', () => sendFullScreen(false))
    win.on('closed', () => {
      for (const j of jobs.values()) j.stop()
      jobs.clear()
      win = null
    })

    const devUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
    if (devUrl) void win.loadURL(devUrl)
    else void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  // The app's own light/dark choice drives native dialogs, scrollbars and window controls too,
  // and the renderer's prefers-color-scheme follows it.
  // While a dialog is open its backdrop dims the window, and the native controls with it.
  let dimmed = false
  const updateOverlay = () => {
    if (!win || isMac) return
    const scheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    win.setTitleBarOverlay({
      ...(dimmed ? DIMMED : CHROME)[scheme],
      height: OVERLAY_HEIGHT,
    })
  }
  nativeTheme.on('updated', () => {
    win?.setBackgroundColor(chrome().color)
    updateOverlay()
  })

  function installMenu(): void {
    if (!isMac) {
      // No menu bar on Windows and Linux: the header is the title bar. A null menu also drops
      // Electron's default accelerators for reload and the developer tools. Development keeps
      // the default menu for those, hidden behind the custom title bar.
      if (app.isPackaged) Menu.setApplicationMenu(null)
      return
    }
    app.setAboutPanelOptions({
      applicationName: 'hostserrer',
      applicationVersion: app.getVersion(),
      version: '',
      copyright: 'Copyright © 2026 Dimitrios T\nReleased under the MIT License',
    })
    const devTools: Electron.MenuItemConstructorOptions[] = app.isPackaged
      ? []
      : [{ type: 'separator' }, { role: 'toggleDevTools' }]
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        // Without an Edit menu, macOS has no copy, paste or select-all in text fields.
        { role: 'editMenu' },
        {
          label: 'View',
          submenu: [
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
            ...devTools,
          ],
        },
        { role: 'windowMenu' },
      ]),
    )
  }

  /** Every payload crossing the bridge is validated here. The renderer is untrusted input. */
  const Id = z.string().min(1).max(200)
  const Stack = z.array(Id).max(500)
  const Hostnames = z.array(z.string().max(253)).min(1).max(200)
  const SettingsPatch = z.object({
    flushDnsOnApply: z.boolean().optional(),
    commentShadowedLines: z.boolean().optional(),
    themeMode: z.enum(['system', 'light', 'dark']).optional(),
    themeId: z.string().max(60).optional(),
    backupRetention: z.number().int().min(1).max(1000).optional(),
    autoBackup: z.boolean().optional(),
  })
  const RecordInput = z.object({
    ip: z.string().max(64),
    hostnames: Hostnames,
    comment: z.string().max(500).optional(),
  })
  const RecordPatch = z.object({
    id: Id,
    ip: z.string().max(64).optional(),
    hostnames: Hostnames.optional(),
    comment: z.string().max(500).optional(),
  })
  const Confirm = z.object({
    message: z.string().max(300),
    detail: z.string().max(1000).optional(),
    confirmLabel: z.string().max(40),
  })
  const PackageInput = z.object({
    name: z.string().max(120),
    description: z.string().max(500).optional(),
    recordIds: z.array(Id).max(500_000).optional(),
  })
  const Target = z.string().min(1).max(253)
  const Lookup = z.object({ kind: z.enum(['google', 'dnschecker', 'whatsmydns']), target: Target })
  /** The only pages the About view can open. The renderer names one; main knows the URL. */
  const LINKS = {
    repo: 'https://github.com/dimitriostzr/host-file-editor-crossplatform',
    license: 'https://github.com/dimitriostzr/host-file-editor-crossplatform/blob/main/LICENSE',
  } as const
  const Link = z.enum(['repo', 'license'])
  const ToolStart = z.object({ kind: z.enum(['ping', 'traceroute']), target: Target })
  const EntriesEnabled = z.object({
    packageId: Id,
    enabled: z.boolean(),
    recordIds: z.array(Id).max(500_000).optional(),
  })
  /** Running ping/traceroute jobs, so a window close or a Stop button can kill them. */
  const jobs = new Map<string, ToolHandle>()
  const PackagePatch = z.object({
    id: Id,
    name: z.string().max(120).optional(),
    description: z.string().max(500).optional(),
    recordIds: z.array(Id).max(500_000).optional(),
  })

  function handle<S extends z.ZodType>(
    channel: string,
    schema: S,
    fn: (arg: z.infer<S>) => Promise<unknown>,
  ): void {
    ipcMain.handle(channel, async (_e, raw: unknown) => {
      const parsed = schema.safeParse(raw)
      if (!parsed.success) return { ok: false, message: 'invalid request' }
      return fn(parsed.data)
    })
  }

  void app.whenReady().then(async () => {
    installMenu()
    if (isMac && !app.isPackaged) {
      // Packaged builds get the icon from the bundle; in development set the dock icon by hand.
      app.dock?.setIcon(nativeImage.createFromPath(iconPath))
    }

    const resolved = resolveHostsPath(devEnv)
    service = new HostsService({
      userDataDir: app.getPath('userData'),
      hostsPath: resolved.path,
      sandboxed: resolved.sandboxed,
    })
    await service.init()
    nativeTheme.themeSource = (await service.snapshot()).settings.themeMode

    ipcMain.handle('hostserrer:snapshot', () => service.snapshot())
    ipcMain.handle('hostserrer:appInfo', () => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform} ${process.arch}`,
      dataDir: app.getPath('userData'),
      links: LINKS,
    }))
    handle('hostserrer:openLink', Link, async (kind) => {
      await shell.openExternal(LINKS[kind])
      return { ok: true }
    })
    handle('hostserrer:setActiveStack', Stack, async (ids) => {
      await service.setActiveStack(ids)
      return { ok: true }
    })
    handle('hostserrer:setSettings', SettingsPatch, async (patch) => {
      await service.setSettings(patch)
      if (patch.themeMode) nativeTheme.themeSource = patch.themeMode
      return { ok: true }
    })
    handle('hostserrer:toggleEntry', z.object({ packageId: Id, recordId: Id }), async (a) => {
      await service.toggleEntry(a.packageId, a.recordId)
      return { ok: true }
    })
    handle('hostserrer:addRecord', RecordInput.extend({ packageId: Id.optional() }), (a) =>
      service.addRecord(
        {
          ip: a.ip,
          hostnames: a.hostnames,
          ...(a.comment !== undefined ? { comment: a.comment } : {}),
        },
        a.packageId,
      ),
    )
    // A pasted blocklist or hosts file. 64 MB is several times the largest public blocklists.
    handle(
      'hostserrer:importText',
      z.object({ text: z.string().max(64_000_000), packageName: z.string().max(120) }),
      (a) => service.importText(a.text, a.packageName),
    )
    ipcMain.handle('hostserrer:fileStamp', () => service.fileStamp())
    handle('hostserrer:updateRecord', RecordPatch, ({ id, ...patch }) =>
      service.updateRecord(id, {
        ...(patch.ip !== undefined ? { ip: patch.ip } : {}),
        ...(patch.hostnames !== undefined ? { hostnames: patch.hostnames } : {}),
        ...(patch.comment !== undefined ? { comment: patch.comment } : {}),
      }),
    )
    handle('hostserrer:deleteRecord', Id, (id) => service.deleteRecord(id))
    handle('hostserrer:createPackage', PackageInput, (a) =>
      service.createPackage({
        name: a.name,
        ...(a.description !== undefined ? { description: a.description } : {}),
        ...(a.recordIds !== undefined ? { recordIds: a.recordIds } : {}),
      }),
    )
    handle('hostserrer:updatePackage', PackagePatch, ({ id, ...patch }) =>
      service.updatePackage(id, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.recordIds !== undefined ? { recordIds: patch.recordIds } : {}),
      }),
    )
    handle('hostserrer:deletePackage', Id, (id) => service.deletePackage(id))
    handle('hostserrer:validateRecord', RecordInput, async (a) =>
      service.validateRecord({
        ip: a.ip,
        hostnames: a.hostnames,
        ...(a.comment !== undefined ? { comment: a.comment } : {}),
      }),
    )
    handle('hostserrer:setEntriesEnabled', EntriesEnabled, (a) =>
      service.setEntriesEnabled(a.packageId, a.enabled, a.recordIds),
    )
    // The renderer never supplies a URL. It names a lookup and a target; main builds the URL.
    handle('hostserrer:openLookup', Lookup, async ({ kind, target }) => {
      if (!isSafeTarget(target)) return { ok: false, message: 'not a valid hostname or IP' }
      await shell.openExternal(lookupUrl(kind, target))
      return { ok: true }
    })
    ipcMain.handle('hostserrer:toolStart', (e, raw: unknown) => {
      const parsed = ToolStart.safeParse(raw)
      if (!parsed.success) return { ok: false, message: 'invalid request' }
      const { kind, target } = parsed.data
      if (!isSafeTarget(target)) return { ok: false, message: 'not a valid hostname or IP' }
      if (jobs.size >= 4) return { ok: false, message: 'too many tools running; stop one first' }
      const jobId = randomUUID()
      const sender = e.sender
      const send = (msg: unknown) => {
        if (!sender.isDestroyed()) sender.send('hostserrer:tool', msg)
      }
      jobs.set(
        jobId,
        runTool(kind, target, {
          chunk: (text) => send({ jobId, type: 'chunk', text }),
          done: (code, note) => {
            jobs.delete(jobId)
            send({ jobId, type: 'done', code, ...(note ? { note } : {}) })
          },
        }),
      )
      return { ok: true, jobId }
    })
    handle('hostserrer:toolStop', Id, async (jobId) => {
      jobs.get(jobId)?.stop()
      return { ok: true }
    })
    ipcMain.handle('hostserrer:apply', () => service.apply())
    ipcMain.handle('hostserrer:restoreOriginal', () => service.restoreOriginal())
    ipcMain.handle('hostserrer:importFromFile', () => service.importFromFile())
    // The renderer never names a destination path. Main shows the native save dialog and only
    // then writes to the path the user picked.
    ipcMain.handle('hostserrer:exportHosts', async (e) => {
      const owner = BrowserWindow.fromWebContents(e.sender)
      const stamp = new Date().toISOString().slice(0, 10)
      const options: Electron.SaveDialogOptions = {
        title: 'Export hosts file',
        defaultPath: join(app.getPath('downloads'), `hosts-${stamp}.txt`),
        filters: [
          { name: 'Text', extensions: ['txt'] },
          { name: 'All files', extensions: ['*'] },
        ],
      }
      const picked = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options)
      if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true }
      const r = await service.exportTo(picked.filePath)
      return r.ok ? { ok: true, path: picked.filePath } : r
    })
    // A native confirmation, attached to the window (a sheet on macOS), in place of the
    // renderer's window.confirm, which has no button labels and a page-style title.
    ipcMain.handle('hostserrer:confirm', async (e, raw: unknown) => {
      const parsed = Confirm.safeParse(raw)
      const owner = BrowserWindow.fromWebContents(e.sender)
      if (!parsed.success || !owner) return false
      const { message, detail, confirmLabel } = parsed.data
      const { response } = await dialog.showMessageBox(owner, {
        type: 'warning',
        message,
        ...(detail ? { detail } : {}),
        buttons: [confirmLabel, 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      return response === 0
    })
    // Backups. Names are checked against the backup naming pattern in the store, and the folder
    // only ever comes from the native dialog below, never from the renderer.
    const BackupName = z.string().max(80)
    ipcMain.handle('hostserrer:backupNow', () => service.backupNow())
    handle('hostserrer:readBackup', BackupName, (name) => service.readBackup(name))
    handle('hostserrer:restoreBackup', BackupName, (name) => service.restoreBackup(name))
    handle('hostserrer:deleteBackup', BackupName, (name) => service.deleteBackup(name))
    handle('hostserrer:revealBackup', BackupName.nullable(), async (name) => {
      try {
        const path = service.backupPath(name)
        if (name) shell.showItemInFolder(path)
        else {
          await mkdir(path, { recursive: true })
          const err = await shell.openPath(path)
          if (err) return { ok: false, message: err }
        }
        return { ok: true }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : 'could not open' }
      }
    })
    ipcMain.handle('hostserrer:chooseBackupDir', async (e) => {
      const owner = BrowserWindow.fromWebContents(e.sender)
      const options: Electron.OpenDialogOptions = {
        title: 'Choose a folder for hosts file backups',
        defaultPath: service.backupPath(null),
        properties: ['openDirectory', 'createDirectory'],
      }
      const picked = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options)
      const dir = picked.filePaths[0]
      if (picked.canceled || !dir) return { ok: false, cancelled: true }
      await service.setBackupDir(dir)
      return { ok: true }
    })
    ipcMain.handle('hostserrer:resetBackupDir', async () => {
      await service.setBackupDir(null)
      return { ok: true }
    })
    handle('hostserrer:dimTitleBar', z.boolean(), async (on) => {
      dimmed = on
      updateOverlay()
      return { ok: true }
    })
    ipcMain.handle('hostserrer:acknowledgeExternalChange', async () => {
      await service.acknowledgeExternalChange()
      return { ok: true }
    })

    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
