import { createWorker, PSM, type Worker } from 'tesseract.js'
import { rgbToHex } from './colorSpace'
import { createPalette, normalizeHex } from './palette'
import type { Palette } from '../types'

export interface DetectedSwatch {
  x: number
  y: number
  w: number
  h: number
  hex: string
}

export interface DetectedPalette {
  name: string
  colors: string[]
  bounds: { x: number; y: number; w: number; h: number }
  nameBounds: { x: number; y: number; w: number; h: number } | null
}

export interface ParseSheetResult {
  palettes: DetectedPalette[]
  swatches: DetectedSwatch[]
}

/** Max channel delta from bg to still count as background (JPEG noise). */
const BG_TOL = 12
/** Max channel delta from seed to stay in the same band. */
const BAND_TOL = 28
const MIN_AREA_FRAC = 0.002
const MIN_FILL = 0.4
const MIN_W = 24
const MIN_H = 10

function cheb(r: number, g: number, b: number, cr: number, cg: number, cb: number): number {
  return Math.max(Math.abs(r - cr), Math.abs(g - cg), Math.abs(b - cb))
}

/** Solid sheet background ≈ median of corner samples. */
function estimateBackground(image: ImageData): [number, number, number] {
  const { width, height, data } = image
  const samples: [number, number, number][] = []
  const inset = Math.max(2, Math.floor(Math.min(width, height) * 0.01))
  const pts: [number, number][] = [
    [inset, inset],
    [width - inset - 1, inset],
    [inset, height - inset - 1],
    [width - inset - 1, height - inset - 1],
  ]
  for (const [cx, cy] of pts) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        const i = (y * width + x) * 4
        samples.push([data[i], data[i + 1], data[i + 2]])
      }
    }
  }
  const med = (c: 0 | 1 | 2) => {
    const v = samples.map((s) => s[c]).sort((a, b) => a - b)
    return v[Math.floor(v.length / 2)] ?? 255
  }
  return [med(0), med(1), med(2)]
}

function modeHex(image: ImageData, pixels: number[]): string {
  const { data } = image
  const counts = new Map<number, number>()
  for (const idx of pixels) {
    const i = idx * 4
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let bestKey = 0
  let bestCount = -1
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      bestKey = key
    }
  }
  return rgbToHex({
    r: (bestKey >> 16) & 0xff,
    g: (bestKey >> 8) & 0xff,
    b: bestKey & 0xff,
  })
}

/**
 * Detect solid color bands: anything not the sheet background, flooded by color.
 * Works on flat PNGs and lightly compressed JPGs of the same sheets.
 */
export function detectSwatches(image: ImageData): DetectedSwatch[] {
  const { width, height, data } = image
  const imageArea = width * height
  const minArea = Math.max(80, Math.floor(imageArea * MIN_AREA_FRAC))
  const [br, bg, bb] = estimateBackground(image)
  const visited = new Uint8Array(width * height)
  /** Pixels that failed as flood seeds — may still belong to another band. */
  const noSeed = new Uint8Array(width * height)
  const found: DetectedSwatch[] = []

  for (let start = 0; start < width * height; start++) {
    if (visited[start] || noSeed[start]) continue
    const o = start * 4
    if (data[o + 3] < 20) {
      visited[start] = 1
      continue
    }
    const r0 = data[o]
    const g0 = data[o + 1]
    const b0 = data[o + 2]

    // Background flood
    if (cheb(r0, g0, b0, br, bg, bb) <= BG_TOL) {
      const stack = [start]
      visited[start] = 1
      while (stack.length) {
        const idx = stack.pop()!
        const x = idx % width
        const y = (idx / width) | 0
        for (const n of [idx - 1, idx + 1, idx - width, idx + width]) {
          if (n < 0 || n >= width * height || visited[n]) continue
          const nx = n % width
          const ny = (n / width) | 0
          if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue
          const no = n * 4
          if (data[no + 3] < 20) {
            visited[n] = 1
            continue
          }
          if (cheb(data[no], data[no + 1], data[no + 2], br, bg, bb) > BG_TOL) continue
          visited[n] = 1
          stack.push(n)
        }
      }
      continue
    }

    // Prefer a stable seed: mode of a small neighborhood (avoids JPEG AA edge pixels)
    const sx0 = start % width
    const sy0 = (start / width) | 0
    const seedCounts = new Map<number, number>()
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = sx0 + dx
        const y = sy0 + dy
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        const i = (y * width + x) * 4
        if (data[i + 3] < 20) continue
        if (cheb(data[i], data[i + 1], data[i + 2], br, bg, bb) <= BG_TOL) continue
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
        seedCounts.set(key, (seedCounts.get(key) ?? 0) + 1)
      }
    }
    let seedKey = (r0 << 16) | (g0 << 8) | b0
    let seedN = -1
    for (const [key, count] of seedCounts) {
      if (count > seedN) {
        seedN = count
        seedKey = key
      }
    }
    const sr = (seedKey >> 16) & 0xff
    const sg = (seedKey >> 8) & 0xff
    const sb = seedKey & 0xff

    // Band flood: same color as seed, not background
    const stack = [start]
    visited[start] = 1
    const pixels: number[] = []
    let minX = sx0
    let minY = sy0
    let maxX = sx0
    let maxY = sy0

    while (stack.length) {
      const idx = stack.pop()!
      pixels.push(idx)
      const x = idx % width
      const y = (idx / width) | 0
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      for (const n of [idx - 1, idx + 1, idx - width, idx + width]) {
        if (n < 0 || n >= width * height || visited[n]) continue
        const nx = n % width
        const ny = (n / width) | 0
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue
        const no = n * 4
        if (data[no + 3] < 20) continue
        const r = data[no]
        const g = data[no + 1]
        const b = data[no + 2]
        if (cheb(r, g, b, br, bg, bb) <= BG_TOL) continue
        if (cheb(r, g, b, sr, sg, sb) > BAND_TOL) continue
        visited[n] = 1
        stack.push(n)
      }
    }

    const area = pixels.length
    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    const ok =
      area >= minArea &&
      bw >= MIN_W &&
      bh >= MIN_H &&
      area / (bw * bh) >= MIN_FILL &&
      bw >= bh * 1.2 &&
      bh <= bw * 1.5

    if (!ok) {
      // Don't permanently consume these pixels — a better seed may claim the band
      for (const idx of pixels) visited[idx] = 0
      noSeed[start] = 1
      continue
    }

    found.push({
      x: minX,
      y: minY,
      w: bw,
      h: bh,
      hex: modeHex(image, pixels),
    })
  }

  // Dedupe overlaps (JPEG can yield near-duplicate floods)
  found.sort((a, b) => b.w * b.h - a.w * a.h)
  const kept: DetectedSwatch[] = []
  for (const s of found) {
    const overlaps = kept.some((k) => {
      const ix = Math.min(s.x + s.w, k.x + k.w) - Math.max(s.x, k.x)
      const iy = Math.min(s.y + s.h, k.y + k.h) - Math.max(s.y, k.y)
      if (ix <= 0 || iy <= 0) return false
      const inter = ix * iy
      return inter / (s.w * s.h) > 0.45 || inter / (k.w * k.h) > 0.45
    })
    if (!overlaps) kept.push(s)
  }
  return kept
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

/** Group vertically stacked, column-aligned bands; split on large gaps. */
export function groupSwatchesIntoPalettes(swatches: DetectedSwatch[]): DetectedSwatch[][] {
  if (!swatches.length) return []
  const sorted = [...swatches].sort((a, b) => a.x - b.x || a.y - b.y)
  const medW = median(sorted.map((s) => s.w))
  const medH = median(sorted.map((s) => s.h))
  const xTol = Math.max(12, medW * 0.35)
  const gapBreak = Math.max(medH * 1.35, 18)

  const columns: DetectedSwatch[][] = []
  const used = new Set<number>()

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue
    const seed = sorted[i]
    const col = [seed]
    used.add(i)
    const cx = seed.x + seed.w / 2
    for (let j = 0; j < sorted.length; j++) {
      if (used.has(j)) continue
      const s = sorted[j]
      const scx = s.x + s.w / 2
      if (Math.abs(scx - cx) <= xTol && Math.abs(s.w - seed.w) <= xTol) {
        used.add(j)
        col.push(s)
      }
    }
    col.sort((a, b) => a.y - b.y)
    columns.push(col)
  }

  const stacks: DetectedSwatch[][] = []
  for (const col of columns) {
    let current: DetectedSwatch[] = [col[0]]
    for (let i = 1; i < col.length; i++) {
      const prev = current[current.length - 1]
      const gap = col[i].y - (prev.y + prev.h)
      if (gap > gapBreak) {
        stacks.push(current)
        current = [col[i]]
      } else {
        current.push(col[i])
      }
    }
    stacks.push(current)
  }

  stacks.sort((a, b) => {
    const ay = a[0].y
    const by = b[0].y
    const ax = a[0].x
    const bx = b[0].x
    const rowTol = medH * 1.2
    if (Math.abs(ay - by) > rowTol) return ay - by
    return ax - bx
  })

  return stacks
}

function stackBounds(stack: DetectedSwatch[]) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of stack) {
    x0 = Math.min(x0, s.x)
    y0 = Math.min(y0, s.y)
    x1 = Math.max(x1, s.x + s.w)
    y1 = Math.max(y1, s.y + s.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function nameCropBounds(
  stack: DetectedSwatch[],
  all: DetectedSwatch[],
  imageW: number,
  imageH: number,
): { x: number; y: number; w: number; h: number } | null {
  const bounds = stackBounds(stack)
  const bandH = median(stack.map((s) => s.h))
  // Titles sit in a short strip just above the stack — keep crop tight so hex labels aren't included
  const ideal = Math.max(18, Math.round(bandH * 0.85))
  let y0 = Math.max(0, bounds.y - ideal)
  for (const s of all) {
    if (s.y + s.h <= bounds.y && s.y + s.h > y0) {
      const overlap = Math.min(bounds.x + bounds.w, s.x + s.w) - Math.max(bounds.x, s.x)
      if (overlap > bounds.w * 0.2) y0 = Math.max(y0, s.y + s.h + 2)
    }
  }
  const h = bounds.y - y0
  if (h < 12) return null
  // Narrow horizontally toward the center — titles are centered above bands
  const inset = Math.round(bounds.w * 0.18)
  const x = Math.max(0, bounds.x + inset)
  const w = Math.min(imageW - x, bounds.w - inset * 2)
  if (w < 40) {
    return {
      x: Math.max(0, bounds.x),
      y: y0,
      w: Math.min(imageW, bounds.w),
      h: Math.min(h, imageH - y0),
    }
  }
  return { x, y: y0, w, h: Math.min(h, imageH - y0) }
}

/** Upscale + threshold dark text on light paper for OCR. */
function cropNameCanvas(
  image: ImageData,
  box: { x: number; y: number; w: number; h: number },
): HTMLCanvasElement {
  const scale = 4
  const sw = Math.max(1, Math.floor(box.w))
  const sh = Math.max(1, Math.floor(box.h))
  const src = document.createElement('canvas')
  src.width = image.width
  src.height = image.height
  const sctx = src.getContext('2d')
  if (!sctx) throw new Error('No canvas context')
  sctx.putImageData(image, 0, 0)

  const canvas = document.createElement('canvas')
  canvas.width = sw * scale
  canvas.height = sh * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No canvas context')
  ctx.imageSmoothingEnabled = true
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(src, box.x, box.y, sw, sh, 0, 0, canvas.width, canvas.height)

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    const v = y < 140 ? 0 : 255
    d[i] = v
    d[i + 1] = v
    d[i + 2] = v
    d[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

function cleanOcrName(raw: string, fallback: string): string {
  const line =
    raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /[a-zA-Z]{2,}/.test(l)) ?? ''
  let cleaned = line
    .replace(/[^a-zA-Z0-9 \-_'']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Drop hex-ish garbage / single letters from reading band labels
  if (!cleaned || cleaned.length < 2) return fallback
  if (/^[0-9A-Fa-f#]+$/.test(cleaned)) return fallback
  if (/^[A-Fa-f0-9]{3,8}$/.test(cleaned)) return fallback
  if (cleaned.length <= 24 && cleaned === cleaned.toLowerCase()) {
    cleaned = cleaned.replace(/\b[a-z]/g, (c) => c.toUpperCase())
  }
  return cleaned
}

let sharedWorker: Worker | null = null
let workerPromise: Promise<Worker> | null = null

async function getOcrWorker(): Promise<Worker> {
  if (sharedWorker) return sharedWorker
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng', 1, { logger: () => undefined })
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_WORD,
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
      })
      sharedWorker = worker
      return worker
    })()
  }
  return workerPromise
}

export async function ocrPaletteName(
  image: ImageData,
  box: { x: number; y: number; w: number; h: number },
  fallback = 'Palette',
): Promise<string> {
  const canvas = cropNameCanvas(image, box)
  const worker = await getOcrWorker()
  const {
    data: { text },
  } = await worker.recognize(canvas)
  return cleanOcrName(text, fallback)
}

export async function parsePaletteSheet(
  image: ImageData,
  opts?: { ocr?: boolean },
): Promise<ParseSheetResult> {
  const doOcr = opts?.ocr !== false
  const swatches = detectSwatches(image)
  const stacks = groupSwatchesIntoPalettes(swatches)
  const palettes: DetectedPalette[] = []

  for (let i = 0; i < stacks.length; i++) {
    const stack = stacks[i]
    const bounds = stackBounds(stack)
    const nameBounds = nameCropBounds(stack, swatches, image.width, image.height)
    const fallback = `Palette ${i + 1}`
    let name = fallback
    if (doOcr && nameBounds) {
      try {
        name = await ocrPaletteName(image, nameBounds, fallback)
      } catch {
        // keep fallback
      }
    }
    palettes.push({
      name,
      colors: stack.map((s) => normalizeHex(s.hex)),
      bounds,
      nameBounds,
    })
  }

  return { palettes, swatches }
}

export function detectedToPalettes(detected: DetectedPalette[]): Palette[] {
  return detected.map((d) => createPalette(d.name, d.colors))
}
