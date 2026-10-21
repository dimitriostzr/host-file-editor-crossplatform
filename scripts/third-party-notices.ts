// SPDX-License-Identifier: MIT
//
// Writes THIRD_PARTY_NOTICES.txt next to a bundle, listing every npm package whose code ended
// up inside it, with that package's licence text. MIT, ISC and BSD all require the notice to
// travel with copies of the code, and once Vite has bundled a package its own LICENSE file is
// no longer in the app. The list comes from the modules Rollup actually included, so it cannot
// drift from what ships. A bundled package without a licence file fails the build.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

const NM = '/node_modules/'

export function thirdPartyNotices(opts: { fileName?: string; extra?: string[] } = {}): Plugin {
  const fileName = opts.fileName ?? 'THIRD_PARTY_NOTICES.txt'
  return {
    name: 'hostserrer:third-party-notices',
    apply: 'build',
    generateBundle() {
      const dirs = new Map<string, string>()
      for (const id of this.getModuleIds()) {
        const path = id.replace(/^\0/, '').split('?')[0]!.replaceAll('\\', '/')
        const at = path.lastIndexOf(NM)
        if (at < 0) continue
        const rest = path.slice(at + NM.length).split('/')
        const name = rest[0]!.startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]!
        dirs.set(name, path.slice(0, at + NM.length) + name)
      }
      // Packages that contribute output without appearing as a module, such as Tailwind's
      // generated CSS.
      for (const name of opts.extra ?? []) {
        if (!dirs.has(name)) dirs.set(name, join(process.cwd(), 'node_modules', name))
      }

      const sections = [...dirs.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, dir]) => {
          const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
            version?: string
            license?: string
          }
          const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
          if (!file) this.error(`${name} is bundled but has no licence file in ${dir}`)
          const text = readFileSync(join(dir, file), 'utf8').trim()
          return `${name} ${pkg.version ?? ''} (${pkg.license ?? 'see below'})\n\n${text}`
        })

      const header =
        'hostserrer includes the following third-party software, bundled into the application.\n' +
        'Electron and Chromium ship their own notices as LICENSE.electron.txt and\n' +
        'LICENSES.chromium.html alongside the application.\n'
      this.emitFile({
        type: 'asset',
        fileName,
        source: [header, ...sections].join(`\n\n${'-'.repeat(80)}\n\n`) + '\n',
      })
    },
  }
}
