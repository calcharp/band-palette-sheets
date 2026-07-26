import { assertPng } from './imagePalette'
import { readSheetMetaFromPng } from './pngMeta'
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
