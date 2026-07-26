import { cloneImageData, imageDataFromBitmap } from './imagePalette'
import { uid } from './palette'
import type { Palette, PaletteSourcePick, SheetLayout } from '../types'
import { DEFAULT_LAYOUT } from '../types'

export const SHEET_META_KEYWORD = 'Paletter'
export const SHEET_META_VERSION = 1 as const

export interface SerializedPalette {
  id: string
  name: string
  colors: string[]
  sourcePicks?: PaletteSourcePick[]
  /** Lossless PNG of the from-image working bitmap, base64 (no data-URL prefix). */
  sourcePng?: string
  /** Absolute local path or http(s) URL the source was loaded from. */
  sourcePath?: string
}

export interface SheetDocument {
  version: typeof SHEET_META_VERSION
  app: 'paletter'
  title: string
  layout: SheetLayout
  palettes: SerializedPalette[]
}

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
}

function readU32be(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset]! << 24) | (buf[offset + 1]! << 16) | (buf[offset + 2]! << 8) | buf[offset + 3]!) >>>
    0
  )
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let len = 0
  for (const p of parts) len += p.length
  const out = new Uint8Array(len)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function latin1Encode(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

function latin1Decode(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return s
}

function buildItxtChunk(keyword: string, text: string): Uint8Array {
  const type = latin1Encode('iTXt')
  const utf8 = new TextEncoder().encode(text)
  const data = concatBytes([
    latin1Encode(keyword),
    new Uint8Array([0]), // null
    new Uint8Array([0]), // compression flag = none
    new Uint8Array([0]), // compression method
    new Uint8Array([0]), // language tag empty + null
    new Uint8Array([0]), // translated keyword empty + null
    utf8,
  ])
  const crc = crc32(concatBytes([type, data]))
  return concatBytes([u32be(data.length), type, data, u32be(crc)])
}

/** Insert or replace an iTXt chunk with `keyword` just before IEND. */
export function embedPngText(png: Uint8Array, keyword: string, text: string): Uint8Array {
  if (png.length < 8 || !PNG_SIG.every((b, i) => png[i] === b)) {
    throw new Error('Not a PNG')
  }
  const parts: Uint8Array[] = [png.subarray(0, 8)]
  let offset = 8
  const chunk = buildItxtChunk(keyword, text)
  let inserted = false

  while (offset + 12 <= png.length) {
    const len = readU32be(png, offset)
    const type = latin1Decode(png.subarray(offset + 4, offset + 8))
    const next = offset + 12 + len
    if (next > png.length) break

    if (type === 'IEND') {
      parts.push(chunk)
      parts.push(png.subarray(offset, next))
      inserted = true
      break
    }

    if (type === 'iTXt' || type === 'tEXt' || type === 'zTXt') {
      const data = png.subarray(offset + 8, offset + 8 + len)
      const nul = data.indexOf(0)
      const key = nul >= 0 ? latin1Decode(data.subarray(0, nul)) : latin1Decode(data)
      if (key === keyword) {
        offset = next
        continue
      }
    }

    parts.push(png.subarray(offset, next))
    offset = next
  }

  if (!inserted) throw new Error('PNG missing IEND')
  return concatBytes(parts)
}

function readItxtValue(data: Uint8Array): string | null {
  // keyword\0 flag\0 method\0 lang\0 translated\0 text
  let i = 0
  while (i < data.length && data[i] !== 0) i++
  if (i >= data.length) return null
  i++ // keyword null
  if (i + 2 > data.length) return null
  const compressed = data[i]!
  i += 2 // flag + method
  while (i < data.length && data[i] !== 0) i++ // lang
  if (i >= data.length) return null
  i++
  while (i < data.length && data[i] !== 0) i++ // translated
  if (i >= data.length) return null
  i++
  if (compressed !== 0) return null // compressed iTXt not supported
  return new TextDecoder().decode(data.subarray(i))
}

/** Read the first iTXt/tEXt value for `keyword`, or null. */
export function readPngText(png: Uint8Array, keyword: string): string | null {
  if (png.length < 8 || !PNG_SIG.every((b, i) => png[i] === b)) return null
  let offset = 8
  while (offset + 12 <= png.length) {
    const len = readU32be(png, offset)
    const type = latin1Decode(png.subarray(offset + 4, offset + 8))
    const next = offset + 12 + len
    if (next > png.length) break
    if (type === 'IEND') break
    const data = png.subarray(offset + 8, offset + 8 + len)
    if (type === 'iTXt') {
      const nul = data.indexOf(0)
      if (nul >= 0 && latin1Decode(data.subarray(0, nul)) === keyword) {
        return readItxtValue(data)
      }
    } else if (type === 'tEXt') {
      const nul = data.indexOf(0)
      if (nul >= 0 && latin1Decode(data.subarray(0, nul)) === keyword) {
        return latin1Decode(data.subarray(nul + 1))
      }
    }
    offset = next
  }
  return null
}

export async function imageDataToPngBase64(data: ImageData): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = data.width
  canvas.height = data.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No canvas context')
  ctx.putImageData(data, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png')
  })
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!)
  return btoa(bin)
}

export async function pngBase64ToImageData(b64: string): Promise<ImageData> {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const blob = new Blob([bytes], { type: 'image/png' })
  const bmp = await createImageBitmap(blob)
  try {
    return imageDataFromBitmap(bmp)
  } finally {
    bmp.close()
  }
}

export async function serializeSheetDocument(
  palettes: Palette[],
  layout: SheetLayout,
  title = '',
): Promise<SheetDocument> {
  const out: SerializedPalette[] = []
  for (const p of palettes) {
    const entry: SerializedPalette = {
      id: p.id,
      name: p.name,
      colors: [...p.colors],
    }
    if (p.sourcePicks?.length) entry.sourcePicks = structuredClone(p.sourcePicks)
    if (p.sourcePath) entry.sourcePath = p.sourcePath
    if (p.sourceImage) {
      try {
        entry.sourcePng = await imageDataToPngBase64(p.sourceImage)
      } catch {
        // Skip source image if encode fails; colors still export.
      }
    }
    out.push(entry)
  }
  return {
    version: SHEET_META_VERSION,
    app: 'paletter',
    title,
    layout: { ...layout },
    palettes: out,
  }
}

export async function deserializeSheetDocument(doc: SheetDocument): Promise<{
  palettes: Palette[]
  layout: SheetLayout
  title: string
}> {
  const layout: SheetLayout = { ...DEFAULT_LAYOUT, ...doc.layout }
  const palettes: Palette[] = []
  for (const p of doc.palettes ?? []) {
    const palette: Palette = {
      id: p.id || uid('pal'),
      name: p.name || 'Palette',
      colors: Array.isArray(p.colors) ? p.colors.map(String) : [],
    }
    if (p.sourcePicks?.length) palette.sourcePicks = structuredClone(p.sourcePicks)
    if (typeof p.sourcePath === 'string' && p.sourcePath.trim()) {
      palette.sourcePath = p.sourcePath.trim()
    }
    if (p.sourcePng) {
      try {
        palette.sourceImage = cloneImageData(await pngBase64ToImageData(p.sourcePng))
      } catch {
        // Ignore corrupt source images.
      }
    }
    palettes.push(palette)
  }
  return { palettes, layout, title: typeof doc.title === 'string' ? doc.title : '' }
}

export function parseSheetDocumentJson(raw: string): SheetDocument | null {
  try {
    const data = JSON.parse(raw) as Partial<SheetDocument>
    if (data?.app !== 'paletter') return null
    if (data.version !== 1) return null
    if (!Array.isArray(data.palettes)) return null
    return data as SheetDocument
  } catch {
    return null
  }
}

/** Embed sheet JSON into a PNG blob (tEXt before IEND). */
export async function pngBlobWithSheetMeta(
  pngBlob: Blob,
  palettes: Palette[],
  layout: SheetLayout,
  title = '',
): Promise<Blob> {
  const bytes = new Uint8Array(await pngBlob.arrayBuffer())
  const doc = await serializeSheetDocument(palettes, layout, title)
  // iTXt carries UTF-8 JSON (names, hex, optional base64 source PNGs).
  const json = JSON.stringify(doc)
  const next = embedPngText(bytes, SHEET_META_KEYWORD, json)
  // Copy into a fresh ArrayBuffer so Blob doesn't share a larger underlying buffer.
  const copy = new Uint8Array(next.byteLength)
  copy.set(next)
  return new Blob([copy], { type: 'image/png' })
}

/** Try to read an embedded Paletter document from a PNG file/blob. */
export async function readSheetMetaFromPng(
  file: Blob,
): Promise<{ palettes: Palette[]; layout: SheetLayout; title: string } | null> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const raw = readPngText(bytes, SHEET_META_KEYWORD)
  if (!raw) return null
  const doc = parseSheetDocumentJson(raw)
  if (!doc) return null
  return deserializeSheetDocument(doc)
}
