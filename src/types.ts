export type NamePosition = 'above' | 'below' | 'left' | 'right'

/** Pixel sample from a from-image session (hex + image coordinates). */
export interface PaletteSourcePick {
  hex: string
  x: number
  y: number
}

export interface Palette {
  id: string
  name: string
  /** Hex colors like #AABBCC (normalized with leading #). */
  colors: string[]
  /** Working image when this palette was created/updated via From image. */
  sourceImage?: ImageData
  /** Eyedropper picks with positions, matching `colors` when saved from image. */
  sourcePicks?: PaletteSourcePick[]
}

export interface SheetLayout {
  /** Override auto grid columns. null = auto (most even rows×cols). */
  columns: number | null
  /** Horizontal gap between palette cells (px in export canvas). */
  colGap: number
  /** Vertical gap between palette cells (px). */
  rowGap: number
  /** Height of each color band (px). */
  bandHeight: number
  /** Width of each palette stripe stack (px). */
  bandWidth: number
  namePosition: NamePosition
  /** Space between name label and stripes (px). */
  nameGap: number
  /** Outer margin around the sheet (px). */
  padding: number
  /** Background behind the sheet. */
  background: string
  /** Draw hex codes on each color band. */
  showHexLabels: boolean
}

export const DEFAULT_LAYOUT: SheetLayout = {
  columns: null,
  colGap: 32,
  rowGap: 40,
  bandHeight: 28,
  bandWidth: 220,
  namePosition: 'above',
  nameGap: 10,
  padding: 48,
  background: '#ffffff',
  showHexLabels: true,
}
