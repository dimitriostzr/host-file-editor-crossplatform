// SPDX-License-Identifier: MIT

/**
 * These strings are a released file format. They appear in users' hosts files.
 * Changing either one orphans every managed block already on disk.
 */
export const BEGIN_MARKER = '# >>> hostserrer: BEGIN (managed) >>>'
export const END_MARKER = '# <<< hostserrer: END <<<'

/**
 * Heads each package's lines inside the block, so the file shows where every rule comes from.
 * Display only: the block is regenerated on every apply and nothing parses these to decide
 * what to write.
 */
export const sectionHeader = (packageName: string): string => `# --- ${packageName} ---`

/** The package name when `line` is a section header, otherwise null. */
export function parseSectionHeader(line: string): string | null {
  const m = /^# --- (.+) ---$/.exec(line.trim())
  return m ? m[1]! : null
}
