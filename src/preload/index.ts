// SPDX-License-Identifier: MIT

import { contextBridge, ipcRenderer } from 'electron'

/**
 * The entire surface the renderer can reach. Named methods only — `ipcRenderer` itself is never
 * exposed, so a compromised renderer cannot invoke arbitrary channels.
 */
const invoke = (channel: string, arg?: unknown) => ipcRenderer.invoke(channel, arg)

const api = {
  /** For platform-specific window chrome only; the renderer has no other use for it. */
  platform: process.platform,
  snapshot: () => invoke('hostserrer:snapshot'),
  appInfo: () => invoke('hostserrer:appInfo'),
  openLink: (kind: string) => invoke('hostserrer:openLink', kind),
  setActiveStack: (ids: string[]) => invoke('hostserrer:setActiveStack', ids),
  setSettings: (patch: Record<string, unknown>) => invoke('hostserrer:setSettings', patch),
  toggleEntry: (packageId: string, recordId: string) =>
    invoke('hostserrer:toggleEntry', { packageId, recordId }),
  addRecord: (input: { ip: string; hostnames: string[]; comment?: string; packageId?: string }) =>
    invoke('hostserrer:addRecord', input),
  importText: (input: { text: string; packageName: string }) =>
    invoke('hostserrer:importText', input),
  fileStamp: () => invoke('hostserrer:fileStamp'),
  updateRecord: (input: { id: string; ip?: string; hostnames?: string[]; comment?: string }) =>
    invoke('hostserrer:updateRecord', input),
  deleteRecord: (id: string) => invoke('hostserrer:deleteRecord', id),
  createPackage: (input: { name: string; description?: string; recordIds?: string[] }) =>
    invoke('hostserrer:createPackage', input),
  updatePackage: (input: {
    id: string
    name?: string
    description?: string
    recordIds?: string[]
  }) => invoke('hostserrer:updatePackage', input),
  deletePackage: (id: string) => invoke('hostserrer:deletePackage', id),
  validateRecord: (input: { ip: string; hostnames: string[]; comment?: string }) =>
    invoke('hostserrer:validateRecord', input),
  setEntriesEnabled: (input: { packageId: string; enabled: boolean; recordIds?: string[] }) =>
    invoke('hostserrer:setEntriesEnabled', input),
  openLookup: (input: { kind: string; target: string }) => invoke('hostserrer:openLookup', input),
  toolStart: (input: { kind: string; target: string }) => invoke('hostserrer:toolStart', input),
  toolStop: (jobId: string) => invoke('hostserrer:toolStop', jobId),
  /** Subscribes to streamed tool output. Returns an unsubscribe function. */
  onTool: (cb: (msg: unknown) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: unknown) => cb(msg)
    ipcRenderer.on('hostserrer:tool', listener)
    return () => ipcRenderer.removeListener('hostserrer:tool', listener)
  },
  /** macOS full screen, which hides the traffic lights. Returns an unsubscribe function. */
  onFullScreen: (cb: (on: boolean) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, on: boolean) => cb(on)
    ipcRenderer.on('hostserrer:fullscreen', listener)
    return () => ipcRenderer.removeListener('hostserrer:fullscreen', listener)
  },
  dimTitleBar: (on: boolean) => invoke('hostserrer:dimTitleBar', on),
  confirm: (input: { message: string; detail?: string; confirmLabel: string }) =>
    invoke('hostserrer:confirm', input),
  apply: () => invoke('hostserrer:apply'),
  restoreOriginal: () => invoke('hostserrer:restoreOriginal'),
  exportHosts: () => invoke('hostserrer:exportHosts'),
  importFromFile: () => invoke('hostserrer:importFromFile'),
  backupNow: () => invoke('hostserrer:backupNow'),
  readBackup: (name: string) => invoke('hostserrer:readBackup', name),
  restoreBackup: (name: string) => invoke('hostserrer:restoreBackup', name),
  deleteBackup: (name: string) => invoke('hostserrer:deleteBackup', name),
  revealBackup: (name: string | null) => invoke('hostserrer:revealBackup', name),
  chooseBackupDir: () => invoke('hostserrer:chooseBackupDir'),
  resetBackupDir: () => invoke('hostserrer:resetBackupDir'),
  acknowledgeExternalChange: () => invoke('hostserrer:acknowledgeExternalChange'),
} as const

contextBridge.exposeInMainWorld('hostserrer', api)
