import type { Palette, SheetLayout } from '../types'

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

export function createPalette(name = 'Palette', colors: string[] = ['#1a1a1a', '#e8e4dc']): Palette {
  return { id: uid('pal'), name, colors: colors.map(normalizeHex) }
}

/** Normalize to #RRGGBB uppercase, or return null if invalid. */
export function parseHex(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (s[0] !== '#') s = `#${s}`
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1]
    const g = s[2]
    const b = s[3]
    s = `#${r}${r}${g}${g}${b}${b}`
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) return null
  return s.toUpperCase()
}

export function normalizeHex(raw: string): string {
  return parseHex(raw) ?? '#000000'
}

export type ColorSortKey = 'hue' | 'saturation' | 'brightness'

/** Hex → HSB (H 0–360, S/B 0–1). */
export function hexToHsb(hex: string): { h: number; s: number; b: number } {
  const n = normalizeHex(hex)
  const r = parseInt(n.slice(1, 3), 16) / 255
  const g = parseInt(n.slice(3, 5), 16) / 255
  const b = parseInt(n.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return { h, s, b: max }
}

export function sortColors(
  colors: string[],
  key: ColorSortKey,
  direction: 1 | -1 = 1,
): string[] {
  return [...colors].sort((a, b) => {
    const A = hexToHsb(a)
    const B = hexToHsb(b)
    let cmp = 0
    if (key === 'hue') cmp = A.h - B.h || A.s - B.s || A.b - B.b
    else if (key === 'saturation') cmp = A.s - B.s || A.h - B.h || A.b - B.b
    else cmp = A.b - B.b || A.h - B.h || A.s - B.s
    return cmp * direction
  })
}

/** Choose columns so rows and cols are as even as possible. */
export function autoColumns(count: number): number {
  if (count <= 0) return 1
  if (count === 1) return 1
  const ideal = Math.sqrt(count)
  let best = Math.max(1, Math.round(ideal))
  let bestScore = Infinity
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    const score = Math.abs(rows - cols) * 10 + Math.abs(cols - ideal)
    if (score < bestScore) {
      bestScore = score
      best = cols
    }
  }
  return best
}

export function gridDims(count: number, columns: number | null): { cols: number; rows: number } {
  const cols = columns && columns > 0 ? Math.min(columns, Math.max(1, count)) : autoColumns(count)
  const rows = Math.max(1, Math.ceil(count / cols))
  return { cols, rows }
}

export function downloadCanvasJpg(canvas: HTMLCanvasElement, fileName: string, quality = 0.92) {
  canvas.toBlob(
    (blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName.endsWith('.jpg') ? fileName : `${fileName}.jpg`
      a.click()
      URL.revokeObjectURL(url)
    },
    'image/jpeg',
    quality,
  )
}

export type { SheetLayout, Palette }
