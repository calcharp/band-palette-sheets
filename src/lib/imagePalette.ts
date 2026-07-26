import {
  dist2,
  oklabToRgb,
  rgbToHex,
  rgbToOklab,
  type Oklab,
  type Rgb,
} from './colorSpace'

export type ClusterReduce = 'mean' | 'median' | 'mode'

export interface Sample {
  lab: Oklab
  rgb: Rgb
}

function seededRand(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

/** k-means++ in OKLab. Returns cluster index per sample and centroids. */
export function kmeansOklab(
  samples: Sample[],
  k: number,
  maxIter = 24,
  seed = 1,
): { labels: Int32Array; centroids: Oklab[] } {
  const n = samples.length
  const kk = Math.max(1, Math.min(k, n))
  const rand = seededRand(seed)
  const labels = new Int32Array(n)

  // k-means++ init
  const centroids: Oklab[] = []
  const first = Math.floor(rand() * n)
  centroids.push({ ...samples[first].lab })

  const nearestD = new Float64Array(n)
  for (let c = 1; c < kk; c++) {
    let sum = 0
    for (let i = 0; i < n; i++) {
      let best = Infinity
      for (const cen of centroids) {
        const d = dist2(samples[i].lab, cen)
        if (d < best) best = d
      }
      nearestD[i] = best
      sum += best
    }
    let target = rand() * sum
    let pick = n - 1
    for (let i = 0; i < n; i++) {
      target -= nearestD[i]
      if (target <= 0) {
        pick = i
        break
      }
    }
    centroids.push({ ...samples[pick].lab })
  }

  for (let iter = 0; iter < maxIter; iter++) {
    let moved = 0
    for (let i = 0; i < n; i++) {
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < kk; c++) {
        const d = dist2(samples[i].lab, centroids[c])
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      if (labels[i] !== best) {
        labels[i] = best
        moved++
      }
    }

    const sums = Array.from({ length: kk }, () => ({ L: 0, a: 0, b: 0, n: 0 }))
    for (let i = 0; i < n; i++) {
      const c = labels[i]
      const lab = samples[i].lab
      sums[c].L += lab.L
      sums[c].a += lab.a
      sums[c].b += lab.b
      sums[c].n++
    }
    for (let c = 0; c < kk; c++) {
      if (sums[c].n === 0) continue
      centroids[c] = {
        L: sums[c].L / sums[c].n,
        a: sums[c].a / sums[c].n,
        b: sums[c].b / sums[c].n,
      }
    }

    if (iter > 0 && moved === 0) break
  }

  return { labels, centroids }
}

function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function reduceCluster(members: Sample[], method: ClusterReduce): Rgb {
  if (!members.length) return { r: 0, g: 0, b: 0 }

  if (method === 'mode') {
    const counts = new Map<string, { count: number; rgb: Rgb }>()
    for (const m of members) {
      // Light quantization so near-identical means collapse
      const key = `${m.rgb.r >> 2},${m.rgb.g >> 2},${m.rgb.b >> 2}`
      const prev = counts.get(key)
      if (prev) prev.count++
      else counts.set(key, { count: 1, rgb: m.rgb })
    }
    let best: { count: number; rgb: Rgb } | null = null
    for (const v of counts.values()) {
      if (!best || v.count > best.count) best = v
    }
    return best!.rgb
  }

  if (method === 'median') {
    const lab: Oklab = {
      L: median(members.map((m) => m.lab.L)),
      a: median(members.map((m) => m.lab.a)),
      b: median(members.map((m) => m.lab.b)),
    }
    return oklabToRgb(lab)
  }

  // mean in OKLab
  let L = 0
  let a = 0
  let b = 0
  for (const m of members) {
    L += m.lab.L
    a += m.lab.a
    b += m.lab.b
  }
  const n = members.length
  return oklabToRgb({ L: L / n, a: a / n, b: b / n })
}

/** Aggregate samples in OKLab via mean / median / mode → hex. */
export function aggregateSamples(samples: Sample[], method: ClusterReduce): string {
  if (!samples.length) return '#000000'
  return rgbToHex(reduceCluster(samples, method))
}

function pointInPoly(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function sampleAt(data: ImageData, x: number, y: number): Sample | null {
  const { width, height, data: px } = data
  if (x < 0 || y < 0 || x >= width || y >= height) return null
  const i = (y * width + x) * 4
  const a = px[i + 3] / 255
  if (a < 0.08) return null
  const r = px[i] * a + 255 * (1 - a)
  const g = px[i + 1] * a + 255 * (1 - a)
  const b = px[i + 2] * a + 255 * (1 - a)
  const rgb = { r: Math.round(r), g: Math.round(g), b: Math.round(b) }
  return { rgb, lab: rgbToOklab(rgb.r, rgb.g, rgb.b) }
}

export function samplePixel(data: ImageData, x: number, y: number): string | null {
  const s = sampleAt(data, Math.floor(x), Math.floor(y))
  return s ? rgbToHex(s.rgb) : null
}

/** Freehand / polygon region → OKLab aggregate. */
export function sampleRegion(
  data: ImageData,
  poly: { x: number; y: number }[],
  method: ClusterReduce,
): string | null {
  if (poly.length < 3) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of poly) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const x0 = Math.max(0, Math.floor(minX))
  const y0 = Math.max(0, Math.floor(minY))
  const x1 = Math.min(data.width - 1, Math.ceil(maxX))
  const y1 = Math.min(data.height - 1, Math.ceil(maxY))
  const samples: Sample[] = []
  // Subsample large regions for responsiveness
  const area = (x1 - x0 + 1) * (y1 - y0 + 1)
  const step = area > 80_000 ? 2 : 1
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      if (!pointInPoly(x + 0.5, y + 0.5, poly)) continue
      const s = sampleAt(data, x, y)
      if (s) samples.push(s)
    }
  }
  if (!samples.length) return null
  return aggregateSamples(samples, method)
}

export interface PixelColor {
  hex: string
  x: number
  y: number
}

/** Cluster image samples and return k actual pixels (nearest to each centroid). */
export function seedPaletteFromImage(data: ImageData, k = 4): PixelColor[] {
  const area = data.width * data.height
  const step = Math.max(1, Math.floor(Math.sqrt(area / 10_000)))
  const samples: (Sample & { x: number; y: number })[] = []
  for (let y = 0; y < data.height; y += step) {
    for (let x = 0; x < data.width; x += step) {
      const s = sampleAt(data, x, y)
      if (s) samples.push({ ...s, x, y })
    }
  }
  if (!samples.length) return []

  const target = Math.max(1, Math.min(k, samples.length))
  const { labels, centroids } = kmeansOklab(samples, target, 24, 42)
  const picks: PixelColor[] = []

  for (let c = 0; c < centroids.length; c++) {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < samples.length; i++) {
      if (labels[i] !== c) continue
      const d = dist2(samples[i].lab, centroids[c])
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best < 0) continue
    const { x, y } = samples[best]
    const hex = samplePixel(data, x, y)
    if (!hex) continue
    picks.push({ hex, x, y })
  }

  picks.sort((a, b) => {
    const La = hexToSample(a.hex).lab.L
    const Lb = hexToSample(b.hex).lab.L
    return La - Lb
  })

  const seen = new Set<string>()
  const out: PixelColor[] = []
  for (const p of picks) {
    if (seen.has(p.hex)) continue
    seen.add(p.hex)
    out.push(p)
    if (out.length >= k) break
  }
  return out
}

/** Pixel in a polygon closest (OKLab) to the region's aggregate color. */
export function sampleRegionPixel(
  data: ImageData,
  poly: { x: number; y: number }[],
  method: ClusterReduce,
): PixelColor | null {
  if (poly.length < 3) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of poly) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const x0 = Math.max(0, Math.floor(minX))
  const y0 = Math.max(0, Math.floor(minY))
  const x1 = Math.min(data.width - 1, Math.ceil(maxX))
  const y1 = Math.min(data.height - 1, Math.ceil(maxY))
  const samples: (Sample & { x: number; y: number })[] = []
  const area = (x1 - x0 + 1) * (y1 - y0 + 1)
  const step = area > 80_000 ? 2 : 1
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      if (!pointInPoly(x + 0.5, y + 0.5, poly)) continue
      const s = sampleAt(data, x, y)
      if (s) samples.push({ ...s, x, y })
    }
  }
  if (!samples.length) return null
  const agg = reduceCluster(
    samples.map(({ lab, rgb }) => ({ lab, rgb })),
    method,
  )
  const target = rgbToOklab(agg.r, agg.g, agg.b)
  let best = samples[0]
  let bestD = Infinity
  for (const s of samples) {
    const d = dist2(s.lab, target)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  const hex = samplePixel(data, best.x, best.y)
  if (!hex) return null
  return { hex, x: best.x, y: best.y }
}

export interface ExtractOptions {
  k: number
  reduce: ClusterReduce
  /** Stable-ish seed so tweaking k feels consistent (k-means path). */
  seed?: number
}

/** Cluster downsampled samples → hex palette via OKLab k-means, ordered dark→light. */
export function extractPalette(
  samples: Sample[],
  { k, reduce, seed = 42 }: ExtractOptions,
): string[] {
  if (!samples.length) return ['#000000']
  const { labels, centroids } = kmeansOklab(samples, k, 24, seed)
  const kk = centroids.length
  const buckets: Sample[][] = Array.from({ length: kk }, () => [])
  for (let i = 0; i < samples.length; i++) {
    buckets[labels[i]].push(samples[i])
  }

  const colors: { hex: string; L: number }[] = []
  for (let c = 0; c < kk; c++) {
    if (!buckets[c].length) continue
    const rgb = reduceCluster(buckets[c], reduce)
    colors.push({ hex: rgbToHex(rgb), L: rgbToOklab(rgb.r, rgb.g, rgb.b).L })
  }

  colors.sort((a, b) => a.L - b.L)
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of colors) {
    if (seen.has(c.hex)) continue
    seen.add(c.hex)
    out.push(c.hex)
  }
  return out.length ? out : ['#000000']
}

function hexToSample(hex: string): Sample {
  const s = hex.trim().replace(/^#/, '')
  const full =
    s.length === 3
      ? `${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`
      : s.padStart(6, '0').slice(0, 6)
  const r = parseInt(full.slice(0, 2), 16) || 0
  const g = parseInt(full.slice(2, 4), 16) || 0
  const b = parseInt(full.slice(4, 6), 16) || 0
  return { rgb: { r, g, b }, lab: rgbToOklab(r, g, b) }
}

/**
 * Compress an existing palette with OKLab k-means.
 * Each input color is one sample (equal weight).
 */
export function simplifyPalette(
  colors: string[],
  k: number,
  reduce: ClusterReduce,
): string[] {
  if (colors.length <= 1) return colors.map((c) => c.toUpperCase())
  const samples = colors.map(hexToSample)
  const target = Math.max(1, Math.min(k, samples.length))
  return extractPalette(samples, { k: target, reduce })
}

export interface Pt {
  x: number
  y: number
}

/** Normalize drag corners; optional square/circle constraint (Shift). */
export function normalizeDragRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  constrained: boolean,
): { left: number; top: number; right: number; bottom: number } {
  if (constrained) {
    const dx = x1 - x0
    const dy = y1 - y0
    const s = Math.max(Math.abs(dx), Math.abs(dy))
    x1 = x0 + (dx < 0 ? -s : s)
    y1 = y0 + (dy < 0 ? -s : s)
  }
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    right: Math.max(x0, x1),
    bottom: Math.max(y0, y1),
  }
}

function copyCropped(
  data: ImageData,
  left: number,
  top: number,
  right: number,
  bottom: number,
  keep: (gx: number, gy: number) => boolean,
): ImageData | null {
  const x0 = Math.max(0, Math.floor(left))
  const y0 = Math.max(0, Math.floor(top))
  const x1 = Math.min(data.width, Math.ceil(right))
  const y1 = Math.min(data.height, Math.ceil(bottom))
  const w = x1 - x0
  const h = y1 - y0
  if (w < 2 || h < 2) return null
  const out = new ImageData(w, h)
  const src = data.data
  const dst = out.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x0 + x
      const gy = y0 + y
      const si = (gy * data.width + gx) * 4
      const di = (y * w + x) * 4
      if (!keep(gx, gy)) {
        dst[di + 3] = 0
        continue
      }
      dst[di] = src[si]
      dst[di + 1] = src[si + 1]
      dst[di + 2] = src[si + 2]
      dst[di + 3] = src[si + 3]
    }
  }
  return out
}

/** Axis-aligned crop; Shift → square. */
export function cropRect(
  data: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  square: boolean,
): ImageData | null {
  const r = normalizeDragRect(x0, y0, x1, y1, square)
  return copyCropped(data, r.left, r.top, r.right, r.bottom, () => true)
}

/** Ellipse crop to bbox with outside cleared; Shift → circle. */
export function cropEllipse(
  data: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  circle: boolean,
): ImageData | null {
  const r = normalizeDragRect(x0, y0, x1, y1, circle)
  const cx = (r.left + r.right) / 2
  const cy = (r.top + r.bottom) / 2
  const rx = Math.max(0.5, (r.right - r.left) / 2)
  const ry = Math.max(0.5, (r.bottom - r.top) / 2)
  return copyCropped(data, r.left, r.top, r.right, r.bottom, (gx, gy) => {
    const nx = (gx + 0.5 - cx) / rx
    const ny = (gy + 0.5 - cy) / ry
    return nx * nx + ny * ny <= 1
  })
}

/** Freehand polygon crop to bbox with outside cleared. */
export function cropFreehand(data: ImageData, points: Pt[]): ImageData | null {
  if (points.length < 3) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const p of points) {
    left = Math.min(left, p.x)
    top = Math.min(top, p.y)
    right = Math.max(right, p.x)
    bottom = Math.max(bottom, p.y)
  }
  return copyCropped(data, left, top, right, bottom, (gx, gy) =>
    pointInPoly(gx + 0.5, gy + 0.5, points),
  )
}

export function imageDataFromBitmap(bitmap: ImageBitmap | HTMLImageElement): ImageData {
  const w = 'width' in bitmap && typeof bitmap.width === 'number' ? bitmap.width : 1
  const h = 'height' in bitmap && typeof bitmap.height === 'number' ? bitmap.height : 1
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('No canvas context')
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0)
  return ctx.getImageData(0, 0, w, h)
}

export function cloneImageData(data: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(data.data), data.width, data.height)
}

export function loadImageFile(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        resolve(imageDataFromBitmap(img))
      } catch (e) {
        reject(e)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not load image'))
    }
    img.src = url
  })
}

export function loadImageBlob(blob: Blob): Promise<ImageData> {
  return loadImageFile(new File([blob], 'paste.png', { type: blob.type || 'image/png' }))
}

/** PNG signature — rejects JPEGs misnamed as .png. */
export async function assertPng(blob: Blob): Promise<void> {
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const ok = sig.every((b, i) => head[i] === b)
  if (!ok) {
    throw new Error('PNG only — JPEG and other formats shift colors and break exact hexes.')
  }
}

export async function loadPngFile(file: File): Promise<ImageData> {
  await assertPng(file)
  return loadImageFile(file)
}

export async function loadPngBlob(blob: Blob): Promise<ImageData> {
  await assertPng(blob)
  return loadImageBlob(blob)
}
