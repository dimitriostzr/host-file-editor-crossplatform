import { describe, it, expect } from 'vitest'
import { parseColor, contrastRatio } from './color.js'

const rgb = (v: string) => parseColor(v)?.rgb

describe('parseColor accepts only numeric colour formats', () => {
  it('hex6', () => expect(rgb('#1a2b3c')).toEqual([26, 43, 60]))
  it('hex3 expands', () => expect(rgb('#abc')).toEqual([170, 187, 204]))
  it('is case-insensitive', () => expect(rgb('#ABC')).toEqual([170, 187, 204]))
  it('rgb()', () => expect(rgb('rgb(10, 20, 30)')).toEqual([10, 20, 30]))
  it('rgb() with spaces', () => expect(rgb('rgb(10 20 30)')).toEqual([10, 20, 30]))
  it('hsl() red', () => expect(rgb('hsl(0, 100%, 50%)')).toEqual([255, 0, 0]))
  it('hsl() green', () => expect(rgb('hsl(120, 100%, 25%)')).toEqual([0, 128, 0]))
})

describe('parseColor converts OKLCH to sRGB', () => {
  it('black', () => expect(rgb('oklch(0 0 0)')).toEqual([0, 0, 0]))
  it('white', () => expect(rgb('oklch(1 0 0)')).toEqual([255, 255, 255]))
  it('red primary', () => expect(rgb('oklch(0.6280 0.2577 29.23)')).toEqual([255, 0, 0]))
  it('green primary', () => expect(rgb('oklch(0.8664 0.2948 142.5)')).toEqual([0, 255, 0]))
  it('blue primary', () => expect(rgb('oklch(0.4520 0.3132 264.05)')).toEqual([0, 0, 255]))
  it('accepts percentage lightness', () =>
    expect(rgb('oklch(62.8% 0.2577 29.23)')).toEqual([255, 0, 0]))
  it('accepts a deg suffix on hue', () =>
    expect(rgb('oklch(0.4520 0.3132 264.05deg)')).toEqual([0, 0, 255]))
  it('is case-insensitive and space-tolerant', () =>
    expect(rgb('OKLCH( 1  0  0 )')).toEqual([255, 255, 255]))
  it("matches shadcn's default dark background", () =>
    expect(rgb('oklch(0.145 0 0)')).toEqual([10, 10, 10]))
  it('clamps out-of-gamut values into sRGB rather than returning negatives', () => {
    const c = rgb('oklch(0.9 0.4 150)')!
    expect(c.every((n) => n >= 0 && n <= 255)).toBe(true)
  })
})

describe('parseColor records alpha', () => {
  it('defaults to opaque', () => expect(parseColor('#abc')?.alpha).toBe(1))
  it('reads a fractional alpha', () => expect(parseColor('oklch(1 0 0 / 0.1)')?.alpha).toBe(0.1))
  it('reads a percentage alpha', () => expect(parseColor('oklch(1 0 0 / 10%)')?.alpha).toBe(0.1))
  it("parses shadcn's translucent border", () =>
    expect(parseColor('oklch(1 0 0 / 10%)')?.rgb).toEqual([255, 255, 255]))
})

describe('parseColor rejects anything that could escape into CSS', () => {
  for (const bad of [
    'url(https://evil.example/x.png)',
    'var(--x)',
    'red',
    '#fff;background:url(//evil)',
    'oklch(0.5 0.1 180);background:url(//evil)',
    'oklch(var(--x) 0 0)',
    'oklch(0.5 0.1 calc(1*2))',
    'oklch(0.5 0.1)',
    'oklch()',
    'color(display-p3 1 0 0)',
    'rgb(300,0,0)',
    'rgb(10,20)',
    '#12345',
    'expression(alert(1))',
    '',
    '   ',
    '#fff !important',
  ])
    it(`rejects ${JSON.stringify(bad)}`, () => expect(parseColor(bad)).toBe(null))
})

describe('contrastRatio matches published WCAG values', () => {
  it('black on white is 21:1', () => expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5))
  it('white on white is 1:1', () => expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5))
  it('#767676 on white is the AA boundary', () =>
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1))
  it('#595959 on white is roughly AAA', () =>
    expect(contrastRatio('#595959', '#ffffff')).toBeCloseTo(7.0, 1))
  it('is symmetric', () =>
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(
      contrastRatio('#abcdef', '#123456'),
      10,
    ))
  it('works across formats', () =>
    expect(contrastRatio('oklch(1 0 0)', '#000000')).toBeCloseTo(21, 5))
  it("rates shadcn's default muted-foreground on white above AA", () =>
    expect(contrastRatio('oklch(0.556 0 0)', 'oklch(1 0 0)')).toBeGreaterThan(4.5))
  it('throws on an unparseable colour rather than returning a wrong number', () =>
    expect(() => contrastRatio('red', '#fff')).toThrow(/unparseable colour/))
  it('throws on a translucent colour, whose contrast is undefined', () =>
    expect(() => contrastRatio('oklch(1 0 0 / 10%)', '#000')).toThrow(/translucent/))
})
