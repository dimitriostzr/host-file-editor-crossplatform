// SPDX-License-Identifier: MIT

import { z } from 'zod'
import { contrastRatio, parseColor } from './color.js'

/**
 * shadcn's token names, canonically. We do not keep a parallel vocabulary and map between the
 * two: one source of truth means a palette from any shadcn theme generator pastes straight in.
 * The last six are ours — shadcn has no equivalent. `destructive` doubles as the danger colour.
 */
export const PALETTE_TOKENS = [
  'background',
  'foreground',
  'card',
  'cardForeground',
  'popover',
  'popoverForeground',
  'primary',
  'primaryForeground',
  'secondary',
  'secondaryForeground',
  'muted',
  'mutedForeground',
  'accent',
  'accentForeground',
  'destructive',
  'destructiveForeground',
  'border',
  'input',
  'ring',
  'success',
  'warning',
  'diffAdd',
  'diffAddBg',
  'diffRemove',
  'diffRemoveBg',
] as const

export type PaletteToken = (typeof PALETTE_TOKENS)[number]

/** `cardForeground` -> `--card-foreground`. */
export const cssVarName = (token: PaletteToken): string =>
  `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`

const ColorSchema = z.string().refine((v) => parseColor(v) !== null, {
  message:
    'must be oklch(), #rgb, #rrggbb, rgb() or hsl() — no url(), var(), calc() or named colours',
})

const paletteShape = Object.fromEntries(PALETTE_TOKENS.map((t) => [t, ColorSchema])) as Record<
  PaletteToken,
  typeof ColorSchema
>
export const ThemePaletteSchema = z.object(paletteShape)
export type ThemePalette = Record<PaletteToken, string>

/** No font files are ever loaded; only these family names may be referenced. */
export const FONT_ALLOWLIST = [
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'sans-serif',
  'serif',
  'monospace',
  'Inter',
  'SF Mono',
  'Menlo',
  'Consolas',
  'JetBrains Mono',
  'IBM Plex Mono',
  'Fira Code',
  'Source Code Pro',
] as const

export const ThemeSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be lowercase letters, digits and dashes'),
  name: z.string().min(1).max(60),
  /** A bare CSS length. Anything richer would be arbitrary CSS reaching a custom property. */
  radius: z
    .string()
    .regex(/^\d*\.?\d+(rem|px)$/, 'radius must be a bare rem or px length')
    .optional(),
  fontFamily: z
    .object({ ui: z.enum(FONT_ALLOWLIST).optional(), mono: z.enum(FONT_ALLOWLIST).optional() })
    .optional(),
  variants: z
    .object({ light: ThemePaletteSchema.optional(), dark: ThemePaletteSchema.optional() })
    .refine((v) => v.light !== undefined || v.dark !== undefined, {
      message: 'a theme must declare at least one variant',
    }),
})
export type Theme = z.infer<typeof ThemeSchema>

const AA_NORMAL = 4.5
const AA_LARGE = 3

/**
 * border, input and ring are deliberately absent: shadcn's own dark defaults make them
 * translucent, and the contrast of a translucent colour is undefined without a known backdrop.
 */
const PAIRS: ReadonlyArray<readonly [PaletteToken, PaletteToken, number]> = [
  ['foreground', 'background', AA_NORMAL],
  ['foreground', 'card', AA_NORMAL],
  ['foreground', 'popover', AA_NORMAL],
  ['mutedForeground', 'background', AA_NORMAL],
  ['mutedForeground', 'muted', AA_NORMAL],
  ['primaryForeground', 'primary', AA_NORMAL],
  ['secondaryForeground', 'secondary', AA_NORMAL],
  ['accentForeground', 'accent', AA_NORMAL],
  ['destructiveForeground', 'destructive', AA_NORMAL],
  ['destructive', 'background', AA_NORMAL],
  ['success', 'background', AA_LARGE],
  ['warning', 'background', AA_LARGE],
  ['diffAdd', 'diffAddBg', AA_NORMAL],
  ['diffRemove', 'diffRemoveBg', AA_NORMAL],
]

export interface ContrastFailure {
  pair: string
  ratio: number
  required: number
}

export function checkContrast(palette: ThemePalette): ContrastFailure[] {
  const failures: ContrastFailure[] = []
  for (const [fg, bg, required] of PAIRS) {
    const ratio = contrastRatio(palette[fg], palette[bg])
    if (ratio < required)
      failures.push({ pair: `${fg} on ${bg}`, ratio: Math.round(ratio * 100) / 100, required })
  }
  return failures
}

export type ValidateResult = { ok: true; theme: Theme } | { ok: false; errors: string[] }

export function validateTheme(input: unknown): ValidateResult {
  const parsed = ThemeSchema.safeParse(input)
  if (!parsed.success)
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    }

  const errors: string[] = []
  for (const [variant, palette] of Object.entries(parsed.data.variants)) {
    if (!palette) continue
    for (const f of checkContrast(palette))
      errors.push(`${variant}: contrast ${f.pair} is ${f.ratio}:1, needs ${f.required}:1`)
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, theme: parsed.data }
}
