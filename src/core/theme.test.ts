import { describe, it, expect } from 'vitest'
import {
  validateTheme,
  checkContrast,
  cssVarName,
  PALETTE_TOKENS,
  type ThemePalette,
} from './theme.js'

/** shadcn's own dark defaults, plus our six additions. Verified to pass all 14 pairs. */
const dark: ThemePalette = {
  background: 'oklch(0.145 0 0)',
  foreground: 'oklch(0.985 0 0)',
  card: 'oklch(0.205 0 0)',
  cardForeground: 'oklch(0.985 0 0)',
  popover: 'oklch(0.269 0 0)',
  popoverForeground: 'oklch(0.985 0 0)',
  primary: 'oklch(0.922 0 0)',
  primaryForeground: 'oklch(0.205 0 0)',
  secondary: 'oklch(0.269 0 0)',
  secondaryForeground: 'oklch(0.985 0 0)',
  muted: 'oklch(0.269 0 0)',
  mutedForeground: 'oklch(0.708 0 0)',
  accent: 'oklch(0.371 0 0)',
  accentForeground: 'oklch(0.985 0 0)',
  destructive: 'oklch(0.704 0.191 22.216)',
  destructiveForeground: 'oklch(0.145 0 0)',
  border: 'oklch(1 0 0 / 10%)',
  input: 'oklch(1 0 0 / 15%)',
  ring: 'oklch(0.556 0 0)',
  success: 'oklch(0.75 0.16 150)',
  warning: 'oklch(0.82 0.16 85)',
  diffAdd: 'oklch(0.85 0.15 150)',
  diffAddBg: 'oklch(0.24 0.05 150)',
  diffRemove: 'oklch(0.80 0.14 25)',
  diffRemoveBg: 'oklch(0.25 0.06 25)',
}
const theme = (over: Record<string, unknown> = {}) => ({
  id: 'default',
  name: 'Default',
  variants: { dark },
  ...over,
})

describe('cssVarName', () => {
  it('kebab-cases a compound token', () =>
    expect(cssVarName('cardForeground')).toBe('--card-foreground'))
  it('leaves a simple token alone', () => expect(cssVarName('background')).toBe('--background'))
  it('handles our diff tokens', () => expect(cssVarName('diffAddBg')).toBe('--diff-add-bg'))
})

describe('schema', () => {
  it('accepts a well-formed dark-only theme', () => expect(validateTheme(theme()).ok).toBe(true))
  it('accepts translucent border and input', () => expect(validateTheme(theme()).ok).toBe(true))
  it('requires at least one variant', () => {
    const r = validateTheme(theme({ variants: {} }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/at least one variant/)
  })
  it('rejects a url() in any token', () => {
    const r = validateTheme(
      theme({ variants: { dark: { ...dark, background: 'url(https://evil/x)' } } }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/background/)
  })
  it('rejects a named colour', () =>
    expect(validateTheme(theme({ variants: { dark: { ...dark, foreground: 'red' } } })).ok).toBe(
      false,
    ))
  it('rejects a missing token', () => {
    const { destructive: _drop, ...missing } = dark
    expect(validateTheme(theme({ variants: { dark: missing } })).ok).toBe(false)
  })
  it('rejects a font outside the allowlist', () =>
    expect(validateTheme(theme({ fontFamily: { mono: 'Evil Font' } })).ok).toBe(false))
  it('accepts a font on the allowlist', () =>
    expect(validateTheme(theme({ fontFamily: { mono: 'JetBrains Mono' } })).ok).toBe(true))
  it('accepts a plain css length radius', () =>
    expect(validateTheme(theme({ radius: '0.625rem' })).ok).toBe(true))
  it('rejects a radius carrying arbitrary css', () =>
    expect(validateTheme(theme({ radius: '1rem;background:url(//evil)' })).ok).toBe(false))
  it('rejects an id with unsafe characters', () =>
    expect(validateTheme(theme({ id: '../evil' })).ok).toBe(false))
  it('rejects a non-object', () => expect(validateTheme('nope').ok).toBe(false))
})

describe('checkContrast', () => {
  it("passes shadcn's default dark palette", () => expect(checkContrast(dark)).toEqual([]))
  it('fails when body text is illegible on the background', () =>
    expect(
      checkContrast({ ...dark, foreground: 'oklch(0.2 0 0)' }).some(
        (f) => f.pair === 'foreground on background',
      ),
    ).toBe(true))
  it('fails when a diff deletion is illegible on its own background', () =>
    expect(
      checkContrast({ ...dark, diffRemove: 'oklch(0.28 0.05 25)' }).some(
        (f) => f.pair === 'diffRemove on diffRemoveBg',
      ),
    ).toBe(true))
  it('reports the measured ratio and the requirement', () => {
    const f = checkContrast({ ...dark, foreground: 'oklch(0.2 0 0)' }).find(
      (x) => x.pair === 'foreground on background',
    )!
    expect(f.required).toBe(4.5)
    expect(f.ratio).toBeLessThan(4.5)
  })
  it('does not check border, input or ring, which may be translucent', () => {
    const pairs = checkContrast({ ...dark, foreground: 'oklch(0.2 0 0)' })
      .map((f) => f.pair)
      .join(' ')
    expect(pairs).not.toMatch(/border|input|ring/)
  })
  it('validateTheme rejects a low-contrast theme even though the schema passes', () => {
    const r = validateTheme(
      theme({ variants: { dark: { ...dark, foreground: 'oklch(0.2 0 0)' } } }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/contrast/i)
  })
})

describe('token list', () => {
  it('every declared token is present in a valid palette', () => {
    for (const t of PALETTE_TOKENS) expect(dark[t]).toBeDefined()
  })
  it('has 25 tokens', () => expect(PALETTE_TOKENS).toHaveLength(25))
})
