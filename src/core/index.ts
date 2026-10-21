// SPDX-License-Identifier: MIT

export { BEGIN_MARKER, END_MARKER, sectionHeader, parseSectionHeader } from './markers.js'
export {
  HOSTNAME_RE,
  HostnameSchema,
  IpSchema,
  HostRecordSchema,
  PackageEntrySchema,
  PackageModeSchema,
  PackageSchema,
  SettingsSchema,
  AppStateSchema,
  type HostRecord,
  type PackageEntry,
  type PackageMode,
  type Package,
  type Settings,
  type AppState,
} from './types.js'
export {
  HOSTS_PATH_ENV,
  DATA_DIR_ENV,
  defaultHostsPath,
  resolveHostsPath,
  type ResolvedHostsPath,
} from './hosts-path.js'
export { parse, serialize, type HostsDocument, type HostsLine } from './parser.js'
export {
  extractRecords,
  SYSTEM_HOSTNAMES,
  type ImportResult,
  type ImportRejection,
} from './import-hosts.js'
export { compile, type CompileResult, type Conflict } from './compiler.js'
export {
  reconcileShadowedLines,
  coveredHostnames,
  MOVED_PREFIX,
  type ReconcileResult,
} from './shadowed.js'
export {
  findManagedBlock,
  applyManagedBlock,
  ManagedBlockError,
  type ManagedBlockErrorCode,
} from './managed-block.js'
export { writeJsonAtomic, readJsonValidated, type ReadResult } from './store.js'
export { BackupStore, timestampName } from './backup-store.js'
export { parseColor, luminance, contrastRatio, type Rgb, type ParsedColor } from './color.js'
export {
  ThemeSchema,
  ThemePaletteSchema,
  PALETTE_TOKENS,
  FONT_ALLOWLIST,
  cssVarName,
  checkContrast,
  validateTheme,
  type Theme,
  type ThemePalette,
  type PaletteToken,
  type ContrastFailure,
  type ValidateResult,
} from './theme.js'
