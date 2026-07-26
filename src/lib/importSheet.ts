import { assertPng } from './imagePalette'
import {
  parseSheetDocumentJson,
  readPngText,
  readSheetMetaFromPng,
  SHEET_META_KEYWORD,
} from './pngMeta'
import type { Palette, SheetLayout } from '../types'

export type ImportedSheet = {
  palettes: Palette[]
  layout?: SheetLayout
  title?: string
}

/**
 * Import a PNG sheet when it has embedded Paletter metadata.
 * Returns null for plain images (or non-PNGs) so the caller can open From image.
 */
export async function tryImportPaletteSheetPng(blob: Blob): Promise<ImportedSheet | null> {
  try {
    await assertPng(blob)
  } catch {
    return null
  }
  const embedded = await readSheetMetaFromPng(blob)
  if (!embedded?.palettes.length) return null
  return {
    palettes: embedded.palettes,
    layout: embedded.layout,
    title: embedded.title,
  }
}

/** Why a PNG is not openable as a Paletter sheet (for clearer toasts). */
export async function diagnosePaletteSheetPng(
  blob: Blob,
): Promise<'ok' | 'not-png' | 'no-meta' | 'bad-meta'> {
  try {
    await assertPng(blob)
  } catch {
    return 'not-png'
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const raw = readPngText(bytes, SHEET_META_KEYWORD)
  if (!raw) return 'no-meta'
  if (!parseSheetDocumentJson(raw)) return 'bad-meta'
  return 'ok'
}
