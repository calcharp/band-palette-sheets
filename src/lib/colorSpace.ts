/** OKLab ↔ sRGB helpers for perceptual color work. */

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface Oklab {
  L: number
  a: number
  b: number
}

function srgbToLinear(c: number): number {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(c: number): number {
  const x = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
  return Math.min(255, Math.max(0, Math.round(x * 255)))
}

export function rgbToOklab(r: number, g: number, b: number): Oklab {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb
  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  }
}

export function oklabToRgb(lab: Oklab): Rgb {
  const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b
  const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b
  const s_ = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return {
    r: linearToSrgb(lr),
    g: linearToSrgb(lg),
    b: linearToSrgb(lb),
  }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase()
}

export function hexToRgb(hex: string): Rgb {
  const n = hex.replace('#', '')
  const full =
    n.length === 3 ? `${n[0]}${n[0]}${n[1]}${n[1]}${n[2]}${n[2]}` : n.padStart(6, '0').slice(0, 6)
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  }
}

export function hexToOklab(hex: string): Oklab {
  const { r, g, b } = hexToRgb(hex)
  return rgbToOklab(r, g, b)
}

/** Weighted mix in OKLab (weights need not sum to 1). */
export function mixOklab(parts: { hex: string; weight: number }[]): string {
  const usable = parts.filter((p) => p.weight > 0)
  if (!usable.length) return '#000000'
  const total = usable.reduce((s, p) => s + p.weight, 0)
  let L = 0
  let a = 0
  let b = 0
  for (const p of usable) {
    const w = p.weight / total
    const lab = hexToOklab(p.hex)
    L += lab.L * w
    a += lab.a * w
    b += lab.b * w
  }
  return rgbToHex(oklabToRgb({ L, a, b }))
}

export function dist2(a: Oklab, b: Oklab): number {
  const dL = a.L - b.L
  const da = a.a - b.a
  const db = a.b - b.b
  return dL * dL + da * da + db * db
}
