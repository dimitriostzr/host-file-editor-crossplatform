// SPDX-License-Identifier: MIT
//
// electron-builder afterExtract hook. Electron ships LICENSE (its MIT notice) and
// LICENSES.chromium.html next to the app; electron-builder keeps them beside the executable on
// Windows and Linux but deletes them when it assembles the macOS bundle. Both licences require
// the notice to travel with the app, so on macOS they are copied into the bundle first, next to
// hostserrer's own licence and third-party notices.

const { copyFile, readdir } = require('node:fs/promises')
const { join } = require('node:path')

exports.default = async function afterExtract(context) {
  if (context.electronPlatformName !== 'darwin' && context.electronPlatformName !== 'mas') return
  const dir = context.appOutDir
  const app = (await readdir(dir)).find((name) => name.endsWith('.app'))
  if (!app) throw new Error(`afterExtract: no .app bundle in ${dir}`)
  const contents = join(dir, app, 'Contents')
  await copyFile(join(dir, 'LICENSE'), join(contents, 'LICENSE.electron.txt'))
  await copyFile(join(dir, 'LICENSES.chromium.html'), join(contents, 'LICENSES.chromium.html'))
}
