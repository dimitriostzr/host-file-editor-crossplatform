// SPDX-License-Identifier: MIT

import { isIP } from 'node:net'
import { z } from 'zod'
import { parseColor } from './color.js'

/**
 * RFC 1123-ish, with deliberate departures in both directions.
 *
 * More permissive than DNS: underscores are allowed. The hosts file is not DNS, resolvers
 * accept `_dev.local`, and rejecting it would refuse input the OS is perfectly happy with.
 *
 * Stricter than the resolver: the 63-character label limit, the 253-character total, and the
 * rule that a label may not end in a dash. A hosts file tolerates all three. They are enforced
 * because a name breaking them is far likelier to be a typo than an intention.
 *
 * This places an obligation on first-run import, which is NOT yet met: because one invalid
 * record fails validation of the whole library file, `extractRecords` must validate each
 * candidate line and report the rejects, rather than pushing raw parser output into the store.
 * See D51.
 */
export const HOSTNAME_RE =
  /^(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*$/

/** A trailing root dot is normalised away rather than rejected: `db.internal.` is a real,
 *  common way to write a fully-qualified name, and rejecting it would fail the whole record. */
export const HostnameSchema = z
  .string()
  .transform((v) => v.trim().toLowerCase().replace(/\.$/, ''))
  .refine((v) => HOSTNAME_RE.test(v), { message: 'invalid hostname' })

/** Delegates to node:net. Hand-written IPv6 regexes are reliably wrong. Trims to match
 *  HostnameSchema, so a pasted trailing space behaves the same way in both fields. */
export const IpSchema = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => isIP(v) !== 0, { message: 'invalid IPv4 or IPv6 address' })

/**
 * Package names and record comments are interpolated verbatim into the managed block of a file
 * written as root. A newline in either would inject attacker-chosen lines into /etc/hosts from
 * an imported package file, which the design treats as an untrusted boundary.
 */
const hasControlChars = (v: string): boolean => /[\p{Cc}\p{Cf}]/u.test(v)
const CONTROL_CHAR_MESSAGE = 'must not contain control or invisible formatting characters'

const DisplayNameSchema = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'must not be empty' })
  .refine((v) => !hasControlChars(v), { message: CONTROL_CHAR_MESSAGE })

/**
 * One colour grammar for the whole app. The palette is authored in OKLCH, so a package swatch
 * that could not be an OKLCH value would be an arbitrary inconsistency. Packages are importable,
 * so this is the same trust boundary the theme validator guards.
 */
const SwatchColorSchema = z.string().refine((v) => parseColor(v) !== null, {
  message: 'must be oklch(), #rgb, #rrggbb, rgb() or hsl()',
})

export const HostRecordSchema = z.object({
  id: z.uuid(),
  ip: IpSchema,
  hostnames: z.array(HostnameSchema).min(1),
  comment: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => !hasControlChars(v), { message: CONTROL_CHAR_MESSAGE })
    .optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type HostRecord = z.infer<typeof HostRecordSchema>

export const PackageEntrySchema = z.object({
  recordId: z.uuid(),
  enabled: z.boolean(),
})
export type PackageEntry = z.infer<typeof PackageEntrySchema>

export const PackageModeSchema = z.enum(['managed', 'full-file'])
export type PackageMode = z.infer<typeof PackageModeSchema>

const packageCommon = {
  id: z.uuid(),
  name: DisplayNameSchema,
  description: z.string().optional(),
  color: SwatchColorSchema.optional(),
}

/**
 * A discriminated union, not a flat object with two optional fields. A `full-file` package owns
 * the entire hosts file, so `rawContent` is mandatory there — otherwise the writer would have to
 * invent a policy for "owns the whole file, has no content" at the moment it is running as root.
 * Equally, a `managed` package cannot carry stray `rawContent` that goes live on a mode change.
 *
 * Each arm declares the other arm's field as `never().optional()` rather than using a strict
 * object, so only those two specific keys are rejected. Packages are the team-sharing format:
 * a genuinely unknown key (say, a field a future version invents) is stripped, not fatal, so
 * that the first teammate to upgrade doesn't cost everyone else their whole package file.
 */
export const PackageSchema = z.discriminatedUnion('mode', [
  z.object({
    ...packageCommon,
    mode: z.literal('managed'),
    entries: z.array(PackageEntrySchema).default([]),
    rawContent: z.never().optional(),
  }),
  z.object({
    ...packageCommon,
    mode: z.literal('full-file'),
    rawContent: z.string(),
    entries: z.never().optional(),
  }),
])
export type Package = z.infer<typeof PackageSchema>

export const SettingsSchema = z.object({
  /** Ordered package ids. LATER index = HIGHER precedence. */
  activeStack: z.array(z.uuid()).default([]),
  flushDnsOnApply: z.boolean().default(true),
  /**
   * Comment out plain lines above the block that the block already covers, so the block's
   * entries actually resolve. They are put back once the block stops covering them.
   */
  commentShadowedLines: z.boolean().default(true),
  /** Automatic backups kept; manual ones are kept until deleted. */
  backupRetention: z.number().int().min(0).default(50),
  /** Copy the hosts file to the backup folder before every write. */
  autoBackup: z.boolean().default(true),
  /**
   * A folder the user picked for backups, or null for the app's data folder. Only ever set
   * from a native folder dialog in main, never from a path the renderer supplies.
   */
  backupDir: z.string().min(1).nullable().default(null),
  /** Names a file on disk (`themes/<id>.json`), so it is constrained to a safe leaf name. */
  themeId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'must be a lowercase safe name')
    .default('default'),
  /** Named `themeMode`, not `mode`, so it is never confused with a Package's mode. */
  themeMode: z.enum(['system', 'light', 'dark']).default('system'),
})
export type Settings = z.infer<typeof SettingsSchema>

/** Application state, deliberately separate from user settings. */
export const AppStateSchema = z.object({
  lastWrittenHash: z.string().nullable().default(null),
  lastAppliedAt: z.iso.datetime().nullable().default(null),
})
export type AppState = z.infer<typeof AppStateSchema>
