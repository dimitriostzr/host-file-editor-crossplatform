// SPDX-License-Identifier: MIT

export type Rgb = [r: number, g: number, b: number]

export interface ParsedColor {
  rgb: Rgb
  /** 0..1. Translucent colours are legal, but cannot take part in a contrast check. */
  alpha: number
}

const NUM = String.raw`\d*\.?\d+`
const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
const RGB = new RegExp(
  `^rgb\\(\\s*(\\d{1,3})\\s*[, ]\\s*(\\d{1,3})\\s*[, ]\\s*(\\d{1,3})\\s*\\)$`,
  'i',
)
const HSL = new RegExp(`^hsl\\(\\s*(${NUM})\\s*[, ]\\s*(${NUM})%\\s*[, ]\\s*(${NUM})%\\s*\\)$`, 'i')
const OKLCH = new RegExp(
  `^oklch\\(\\s*(${NUM})(%?)\\s+(${NUM})\\s+(${NUM})(?:deg)?\\s*(?:/\\s*(${NUM})(%?)\\s*)?\\)$`,
  'i',
)

const opaque = (rgb: Rgb): ParsedColor => ({ rgb, alpha: 1 })

/**
 * A security boundary, not a convenience. Whatever this accepts can end up inside a stylesheet
 * as a CSS custom property, so it accepts five numeric formats and nothing else — notably no
 * url(), no var(), no calc(), no named colours, and nothing containing a semicolon.
 */
export function parseColor(value: string): ParsedColor | null {
  let m: RegExpExecArray | null

  if ((m = HEX3.exec(value)))
    return opaque([
      parseInt(`${m[1]}${m[1]}`, 16),
      parseInt(`${m[2]}${m[2]}`, 16),
      parseInt(`${m[3]}${m[3]}`, 16),
    ])

  if ((m = HEX6.exec(value)))
    return opaque([parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)])

  if ((m = RGB.exec(value))) {
    const c: Rgb = [Number(m[1]), Number(m[2]), Number(m[3])]
    return c.every((n) => n <= 255) ? opaque(c) : null
  }

  if ((m = HSL.exec(value)))
    return opaque(hslToRgb(Number(m[1]) % 360, Number(m[2]) / 100, Number(m[3]) / 100))

  if ((m = OKLCH.exec(value))) {
    const l = m[2] === '%' ? Number(m[1]) / 100 : Number(m[1])
    const rgb = oklchToRgb(l, Number(m[3]), Number(m[4]))
    if (m[5] === undefined) return opaque(rgb)
    const a = m[6] === '%' ? Number(m[5]) / 100 : Number(m[5])
    return a >= 0 && a <= 1 ? { rgb, alpha: a } : null
  }

  return null
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const t: Rgb =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return [Math.round((t[0] + m) * 255), Math.round((t[1] + m) * 255), Math.round((t[2] + m) * 255)]
}

/** OKLCH -> OKLab -> linear sRGB -> gamma-encoded sRGB. Out-of-gamut values are clamped. */
function oklchToRgb(lightness: number, chroma: number, hueDeg: number): Rgb {
  const h = (hueDeg * Math.PI) / 180
  const a = chroma * Math.cos(h)
  const b = chroma * Math.sin(h)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const encoded = linear.map((v) => {
    const clamped = Math.max(v, 0)
    const c = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, c)) * 255)
  })
  return [encoded[0]!, encoded[1]!, encoded[2]!]
}

const channel = (c: number): number => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** WCAG 2.1 relative luminance. */
export const luminance = ([r, g, b]: Rgb): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

export function contrastRatio(a: string, b: string): number {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (ca === null) throw new Error(`unparseable colour: ${a}`)
  if (cb === null) throw new Error(`unparseable colour: ${b}`)
  // Undefined without knowing the backdrop; returning a number would be a confident lie.
  if (ca.alpha < 1) throw new Error(`contrast is undefined for a translucent colour: ${a}`)
  if (cb.alpha < 1) throw new Error(`contrast is undefined for a translucent colour: ${b}`)
  const la = luminance(ca.rgb)
  const lb = luminance(cb.rgb)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}
