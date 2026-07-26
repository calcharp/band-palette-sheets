import { gridDims } from './palette'
import type { NamePosition, Palette, SheetLayout } from '../types'

export const NAME_FONT = '600 18px "DM Sans", sans-serif'
/** Fixed line box so names with descenders (e.g. “Clay”) don’t shift bands. */
const NAME_LINE_HEIGHT = 22
const NAME_BASELINE = 16
const HEX_FONT = '500 11px "IBM Plex Mono", monospace'
const NAME_COLOR = '#1c1917'

/** Relative luminance 0–1 (sRGB). */
function relativeLuminance(hex: string): number {
  const n = hex.replace('#', '')
  const full =
    n.length === 3 ? `${n[0]}${n[0]}${n[1]}${n[1]}${n[2]}${n[2]}` : n
  const channel = (i: number) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const r = channel(0)
  const g = channel(2)
  const b = channel(4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Black or white text for maximum contrast on `hex` background. */
export function contrastInk(hex: string): string {
  return relativeLuminance(hex) > 0.45 ? '#1c1917' : '#fafaf9'
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface PaletteHit {
  paletteId: string
  paletteIndex: number
  /** Full grid cell (for drag / hover chrome). */
  cell: Rect
  name: Rect
  bands: Rect[]
  stripes: Rect
}

interface CellMetrics {
  contentW: number
  contentH: number
  nameW: number
  nameH: number
  stripesW: number
  stripesH: number
}

export interface SheetLayoutInfo {
  width: number
  height: number
  hits: PaletteHit[]
}

function measureName(ctx: CanvasRenderingContext2D, name: string): { w: number; h: number } {
  ctx.font = NAME_FONT
  const m = ctx.measureText(name || ' ')
  return {
    w: Math.ceil(m.width),
    h: NAME_LINE_HEIGHT,
  }
}

function cellMetrics(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  layout: SheetLayout,
): CellMetrics {
  const stripesW = layout.bandWidth
  const stripesH = Math.max(1, palette.colors.length) * layout.bandHeight
  const name = measureName(ctx, palette.name)
  const pos = layout.namePosition

  let contentW = stripesW
  let contentH = stripesH

  if (pos === 'above' || pos === 'below') {
    contentW = Math.max(stripesW, name.w)
    contentH = stripesH + layout.nameGap + name.h
  } else {
    contentW = stripesW + layout.nameGap + name.w
    contentH = Math.max(stripesH, name.h)
  }

  return {
    contentW,
    contentH,
    nameW: name.w,
    nameH: name.h,
    stripesW,
    stripesH,
  }
}

function nameOffset(
  pos: NamePosition,
  m: CellMetrics,
  nameGap: number,
): { nameX: number; nameY: number; stripeX: number; stripeY: number } {
  switch (pos) {
    case 'above':
      return {
        nameX: (m.contentW - m.nameW) / 2,
        nameY: NAME_BASELINE,
        stripeX: (m.contentW - m.stripesW) / 2,
        stripeY: m.nameH + nameGap,
      }
    case 'below':
      return {
        nameX: (m.contentW - m.nameW) / 2,
        nameY: m.stripesH + nameGap + NAME_BASELINE,
        stripeX: (m.contentW - m.stripesW) / 2,
        stripeY: 0,
      }
    case 'left':
      return {
        nameX: 0,
        nameY: (m.contentH - m.nameH) / 2 + NAME_BASELINE,
        stripeX: m.nameW + nameGap,
        stripeY: (m.contentH - m.stripesH) / 2,
      }
    case 'right':
      return {
        nameX: m.stripesW + nameGap,
        nameY: (m.contentH - m.nameH) / 2 + NAME_BASELINE,
        stripeX: 0,
        stripeY: (m.contentH - m.stripesH) / 2,
      }
  }
}

function drawPalette(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  layout: SheetLayout,
  originX: number,
  originY: number,
  metrics: CellMetrics,
) {
  const off = nameOffset(layout.namePosition, metrics, layout.nameGap)

  ctx.font = NAME_FONT
  ctx.fillStyle = NAME_COLOR
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(palette.name, originX + off.nameX, originY + off.nameY)

  const colors = palette.colors.length ? palette.colors : ['#cccccc']
  colors.forEach((hex, i) => {
    const y = originY + off.stripeY + i * layout.bandHeight
    const x = originX + off.stripeX
    ctx.fillStyle = hex
    ctx.fillRect(x, y, layout.bandWidth, layout.bandHeight)

    if (layout.showHexLabels !== false && layout.bandHeight >= 14) {
      const label = hex.toUpperCase().startsWith('#') ? hex.toUpperCase() : `#${hex.toUpperCase()}`
      ctx.font = HEX_FONT
      ctx.fillStyle = contrastInk(hex)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, x + layout.bandWidth / 2, y + layout.bandHeight / 2)
      ctx.textAlign = 'start'
      ctx.textBaseline = 'alphabetic'
    }
  })
}

function buildGrid(palettes: Palette[], layout: SheetLayout) {
  const measure = document.createElement('canvas').getContext('2d')
  if (!measure) throw new Error('No canvas context')

  if (!palettes.length) {
    return {
      cols: 1,
      list: [] as Palette[],
      metricsList: [] as ReturnType<typeof cellMetrics>[],
      colWidths: [layout.bandWidth],
      rowHeights: [layout.bandHeight],
      gridW: layout.bandWidth,
      gridH: layout.bandHeight,
    }
  }

  const { cols, rows } = gridDims(palettes.length, layout.columns)
  const list = palettes
  const metricsList = list.map((p) => cellMetrics(measure, p, layout))

  const colWidths = Array.from({ length: cols }, (_, c) => {
    let max = 0
    for (let r = 0; r < rows; r++) {
      const i = r * cols + c
      if (i < metricsList.length) max = Math.max(max, metricsList[i].contentW)
    }
    return max
  })

  const rowHeights = Array.from({ length: rows }, (_, r) => {
    let max = 0
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (i < metricsList.length) max = Math.max(max, metricsList[i].contentH)
    }
    return max
  })

  const gridW =
    colWidths.reduce((a, b) => a + b, 0) + layout.colGap * Math.max(0, cols - 1)
  const gridH =
    rowHeights.reduce((a, b) => a + b, 0) + layout.rowGap * Math.max(0, rows - 1)

  return { cols, list, metricsList, colWidths, rowHeights, gridW, gridH }
}

/** Hit regions in unscaled sheet coordinates. */
export function computeSheetHits(
  palettes: Palette[],
  layout: SheetLayout,
): SheetLayoutInfo {
  const { cols, list, metricsList, colWidths, rowHeights, gridW, gridH } = buildGrid(
    palettes,
    layout,
  )

  const hits: PaletteHit[] = list.map((palette, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    const x =
      layout.padding +
      colWidths.slice(0, c).reduce((a, b) => a + b, 0) +
      layout.colGap * c
    const y =
      layout.padding +
      rowHeights.slice(0, r).reduce((a, b) => a + b, 0) +
      layout.rowGap * r
    const m = metricsList[i]
    const ox = x + (colWidths[c] - m.contentW) / 2
    // Top-align in the row so band tops stay level across columns.
    const oy = y
    const off = nameOffset(layout.namePosition, m, layout.nameGap)

    const name: Rect = {
      x: ox + off.nameX,
      y: oy + off.nameY - m.nameH,
      w: Math.max(m.nameW, 48),
      h: m.nameH + 6,
    }

    const colors = palette.colors.length ? palette.colors : ['#cccccc']
    const bands = colors.map((_, bi) => ({
      x: ox + off.stripeX,
      y: oy + off.stripeY + bi * layout.bandHeight,
      w: layout.bandWidth,
      h: layout.bandHeight,
    }))

    const stripes: Rect = {
      x: ox + off.stripeX,
      y: oy + off.stripeY,
      w: layout.bandWidth,
      h: Math.max(1, colors.length) * layout.bandHeight,
    }

    return {
      paletteId: palette.id,
      paletteIndex: i,
      cell: { x, y, w: colWidths[c], h: rowHeights[r] },
      name,
      bands,
      stripes,
    }
  })

  return {
    width: Math.ceil(gridW + layout.padding * 2),
    height: Math.ceil(gridH + layout.padding * 2),
    hits,
  }
}

/**
 * Grid cell for the next empty palette slot (same columns as the current
 * sheet — does not reflow existing palettes). Sheet size may grow by a row.
 */
export function computeAddPaletteSlot(
  palettes: Palette[],
  layout: SheetLayout,
): { cell: Rect; width: number; height: number } {
  const measure = document.createElement('canvas').getContext('2d')
  if (!measure) throw new Error('No canvas context')

  const phantomColors =
    palettes[palettes.length - 1]?.colors?.length
      ? palettes[palettes.length - 1]!.colors.map(() => '#e8e8e8')
      : ['#e8e8e8', '#d4d4d4']
  const phantom: Palette = { id: '__add__', name: 'Palette', colors: phantomColors }
  const phantomMetrics = cellMetrics(measure, phantom, layout)

  if (!palettes.length) {
    const w = phantomMetrics.contentW
    const h = phantomMetrics.contentH
    return {
      cell: { x: layout.padding, y: layout.padding, w, h },
      width: Math.ceil(w + layout.padding * 2),
      height: Math.ceil(h + layout.padding * 2),
    }
  }

  const { cols, list, colWidths, rowHeights, gridW, gridH } = buildGrid(palettes, layout)
  const rows = Math.max(1, Math.ceil(list.length / cols))
  const nextIndex = list.length
  const c = nextIndex % cols
  const r = Math.floor(nextIndex / cols)

  let widths = colWidths
  let heights = rowHeights
  let nextGridW = gridW
  let nextGridH = gridH

  if (r >= rows) {
    heights = [...rowHeights, phantomMetrics.contentH]
    nextGridH = gridH + layout.rowGap + phantomMetrics.contentH
  }

  // Column may be unused in earlier rows only when count is small; widen if needed.
  if (phantomMetrics.contentW > (widths[c] ?? 0)) {
    widths = [...widths]
    widths[c] = phantomMetrics.contentW
    nextGridW =
      widths.reduce((a, b) => a + b, 0) + layout.colGap * Math.max(0, cols - 1)
  }

  const x =
    layout.padding +
    widths.slice(0, c).reduce((a, b) => a + b, 0) +
    layout.colGap * c
  const y =
    layout.padding +
    heights.slice(0, r).reduce((a, b) => a + b, 0) +
    layout.rowGap * r

  return {
    cell: {
      x,
      y,
      w: widths[c] ?? phantomMetrics.contentW,
      h: heights[r] ?? phantomMetrics.contentH,
    },
    width: Math.ceil(nextGridW + layout.padding * 2),
    height: Math.ceil(nextGridH + layout.padding * 2),
  }
}

export type HitTarget =
  | { kind: 'name'; paletteId: string; rect: Rect }
  | { kind: 'band'; paletteId: string; colorIndex: number; rect: Rect; hex: string }
  | { kind: 'add-band'; paletteId: string; rect: Rect }

function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
}

export function hitTest(
  x: number,
  y: number,
  palettes: Palette[],
  layout: SheetLayout,
): HitTarget | null {
  const { hits } = computeSheetHits(palettes, layout)
  for (const hit of hits) {
    if (pointInRect(x, y, hit.name)) {
      return { kind: 'name', paletteId: hit.paletteId, rect: hit.name }
    }
    for (let i = 0; i < hit.bands.length; i++) {
      if (pointInRect(x, y, hit.bands[i])) {
        const pal = palettes.find((p) => p.id === hit.paletteId)
        return {
          kind: 'band',
          paletteId: hit.paletteId,
          colorIndex: i,
          rect: hit.bands[i],
          hex: pal?.colors[i] ?? '#888888',
        }
      }
    }
    const addZone: Rect = {
      x: hit.stripes.x,
      y: hit.stripes.y + hit.stripes.h,
      w: hit.stripes.w,
      h: Math.max(14, layout.bandHeight * 0.55),
    }
    if (pointInRect(x, y, addZone)) {
      return { kind: 'add-band', paletteId: hit.paletteId, rect: addZone }
    }
  }
  return null
}

/** Which palette cell contains the point (for drag reorder). */
export function cellAtPoint(
  x: number,
  y: number,
  palettes: Palette[],
  layout: SheetLayout,
): PaletteHit | null {
  const { hits } = computeSheetHits(palettes, layout)
  for (const hit of hits) {
    if (pointInRect(x, y, hit.cell)) return hit
  }
  return null
}

/** Reorder so `fromId` lands at the index currently occupied by `toId`. */
export function movePalette(
  palettes: Palette[],
  fromId: string,
  toId: string,
): Palette[] {
  if (fromId === toId) return palettes
  const from = palettes.findIndex((p) => p.id === fromId)
  const to = palettes.findIndex((p) => p.id === toId)
  if (from < 0 || to < 0) return palettes
  const next = [...palettes]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** Render the full palette sheet onto a canvas (1× CSS pixels unless scale > 1). */
export function renderSheet(
  palettes: Palette[],
  layout: SheetLayout,
  scale = 1,
): HTMLCanvasElement {
  const { cols, list, metricsList, colWidths, rowHeights, gridW, gridH } = buildGrid(
    palettes,
    layout,
  )

  const width = Math.ceil((gridW + layout.padding * 2) * scale)
  const height = Math.ceil((gridH + layout.padding * 2) * scale)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No canvas context')

  ctx.scale(scale, scale)
  ctx.fillStyle = layout.background
  ctx.fillRect(0, 0, canvas.width / scale, canvas.height / scale)

  list.forEach((palette, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    const x =
      layout.padding +
      colWidths.slice(0, c).reduce((a, b) => a + b, 0) +
      layout.colGap * c
    const y =
      layout.padding +
      rowHeights.slice(0, r).reduce((a, b) => a + b, 0) +
      layout.rowGap * r
    const m = metricsList[i]
    const ox = x + (colWidths[c] - m.contentW) / 2
    // Top-align in the row so band tops stay level across columns.
    const oy = y
    drawPalette(ctx, palette, layout, ox, oy, m)
  })

  return canvas
}
