// SPDX-License-Identifier: MIT
//
// Launches electron-vite with a clean environment.
//
// VS Code's integrated terminal inherits ELECTRON_RUN_AS_NODE=1 from its extension host. With
// that set, the Electron binary runs as plain Node: no window appears, `process.type` is
// undefined, and `require('electron')` resolves to the npm shim that returns a path string
// rather than the API. The failure looks like a bug in the app, so strip the variable here
// instead of leaving every contributor to rediscover it.

import { spawn } from 'node:child_process'

const mode = process.argv[2] ?? 'dev'
const env = { ...process.env }
delete env['ELECTRON_RUN_AS_NODE']

const child = spawn('electron-vite', [mode, ...process.argv.slice(3)], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
})
child.on('exit', (code) => process.exit(code ?? 0))
