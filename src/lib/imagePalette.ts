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

export interface DownsampleResult {
  width: number
  height: number
  /** Flat RGBA for preview (opaque). */
  rgba: Uint8ClampedArray
  samples: Sample[]
}

/**
 * Mean-block downsample. `maxSide` is the longest output edge in pixels.
 * Averages in OKLab, then converts back for display samples.
 */
export function downsampleMean(
  imageData: ImageData,
  maxSide: number,
): DownsampleResult {
  const { width: sw, height: sh, data } = imageData
  const scale = Math.min(1, maxSide / Math.max(sw, sh))
  const dw = Math.max(1, Math.round(sw * scale))
  const dh = Math.max(1, Math.round(sh * scale))

  const rgba = new Uint8ClampedArray(dw * dh * 4)
  const samples: Sample[] = []

  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh)
    const y1 = Math.floor(((y + 1) * sh) / dh)
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw)
      const x1 = Math.floor(((x + 1) * sw) / dw)
      let sumL = 0
      let sumA = 0
      let sumB = 0
      let n = 0
      for (let sy = y0; sy < Math.max(y1, y0 + 1); sy++) {
        for (let sx = x0; sx < Math.max(x1, x0 + 1); sx++) {
          const i = (sy * sw + sx) * 4
          const a = data[i + 3] / 255
          if (a < 0.08) continue
          // Composite on white for transparent pixels
          const r = data[i] * a + 255 * (1 - a)
          const g = data[i + 1] * a + 255 * (1 - a)
          const b = data[i + 2] * a + 255 * (1 - a)
          const lab = rgbToOklab(r, g, b)
          sumL += lab.L
          sumA += lab.a
          sumB += lab.b
          n++
        }
      }
      const lab: Oklab =
        n > 0
          ? { L: sumL / n, a: sumA / n, b: sumB / n }
          : { L: 1, a: 0, b: 0 }
      const rgb = oklabToRgb(lab)
      const o = (y * dw + x) * 4
      rgba[o] = rgb.r
      rgba[o + 1] = rgb.g
      rgba[o + 2] = rgb.b
      rgba[o + 3] = 255
      samples.push({ lab, rgb })
    }
  }

  return { width: dw, height: dh, rgba, samples }
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

export interface ExtractOptions {
  k: number
  reduce: ClusterReduce
  /** Stable-ish seed so tweaking k feels consistent. */
  seed?: number
}

/** Cluster downsampled samples → hex palette, ordered dark→light. */
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
  // Dedupe identical hexes while preserving order
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

export function downsampleToCanvas(result: DownsampleResult): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = result.width
  canvas.height = result.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No canvas context')
  const img = ctx.createImageData(result.width, result.height)
  img.data.set(result.rgba)
  ctx.putImageData(img, 0, 0)
  return canvas
}
