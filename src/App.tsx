import { useCallback, useEffect, useState } from 'react'
import { FromImageModal, type FromImageResume } from './components/FromImageModal'
import { ImportSheetModal } from './components/ImportSheetModal'
import { SheetPreview } from './components/SheetPreview'
import { Toolbar } from './components/Toolbar'
import { useHistory } from './lib/history'
import { createPalette, downloadCanvasPngAsync, uid } from './lib/palette'
import { pngBlobWithSheetMeta } from './lib/pngMeta'
import { renderSheet } from './lib/render'
import { DEFAULT_LAYOUT, type Palette, type SheetLayout } from './types'

const STARTER: Palette[] = [
  createPalette('Ink', ['#1c1917', '#44403c', '#a8a29e', '#e7e5e4']),
  createPalette('Clay', ['#7c2d12', '#c2410c', '#fb923c', '#ffedd5']),
  createPalette('Sea', ['#0c4a6e', '#0369a1', '#38bdf8', '#e0f2fe']),
]

/** Old paper defaults → white sheet. */
const LEGACY_SHEET_BG = new Set(['#f4f0e8', '#f7f3eb', '#ebe4d6', '#faf7f1'])

interface DocState {
  palettes: Palette[]
  layout: SheetLayout
}

export default function App() {
  const { present, set } = useHistory<DocState>({
    palettes: STARTER,
    layout: DEFAULT_LAYOUT,
  })
  const { palettes, layout } = present
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editSlot, setEditSlot] = useState<HTMLDivElement | null>(null)
  const [fromImageOpen, setFromImageOpen] = useState(false)
  const [fromImageResume, setFromImageResume] = useState<FromImageResume | null>(null)
  const [importSheetOpen, setImportSheetOpen] = useState(false)
  const onEditSlot = useCallback((el: HTMLDivElement | null) => {
    setEditSlot(el)
  }, [])

  useEffect(() => {
    const bg = layout.background.trim().toLowerCase()
    if (!LEGACY_SHEET_BG.has(bg)) return
    set((d) => ({ ...d, layout: { ...d.layout, background: '#ffffff' } }))
  }, [layout.background, set])

  async function handleExport() {
    const canvas = renderSheet(palettes, layout, 2)
    await downloadCanvasPngAsync(canvas, 'palette-sheet', (blob) =>
      pngBlobWithSheetMeta(blob, palettes, layout),
    )
  }

  function openFromImage() {
    setFromImageResume(null)
    setFromImageOpen(true)
  }

  function openFromImageResume(palette: Palette) {
    if (!palette.sourceImage) return
    setFromImageResume({
      paletteId: palette.id,
      name: palette.name,
      image: palette.sourceImage,
      picks:
        palette.sourcePicks ??
        palette.colors.map((hex, i) => ({ hex, x: i, y: 0 })),
    })
    setFromImageOpen(true)
  }

  function saveFromImage(palette: Palette) {
    set((d) => {
      const idx = d.palettes.findIndex((p) => p.id === palette.id)
      if (idx >= 0) {
        const next = [...d.palettes]
        next[idx] = palette
        return { ...d, palettes: next }
      }
      return { ...d, palettes: [...d.palettes, palette] }
    })
  }

  function importSheet(payload: { palettes: Palette[]; layout?: SheetLayout }) {
    set((d) => ({
      layout: payload.layout ?? d.layout,
      palettes: [
        ...d.palettes,
        ...payload.palettes.map((p) => ({
          ...p,
          id: uid('pal'),
        })),
      ],
    }))
  }

  return (
    <div className="app">
      <Toolbar
        layout={layout}
        palettes={palettes}
        selectedId={selectedId}
        onSelectPalette={setSelectedId}
        onLayoutChange={(next) => set((d) => ({ ...d, layout: next }))}
        onPalettesChange={(next) => set((d) => ({ ...d, palettes: next }))}
        onAddPalette={() =>
          set((d) => ({
            ...d,
            palettes: [...d.palettes, createPalette(`Palette ${d.palettes.length + 1}`)],
          }))
        }
        onFromImage={openFromImage}
        onImportSheet={() => setImportSheetOpen(true)}
        onExport={() => void handleExport()}
        onEditSlot={onEditSlot}
      />
      <main className="workspace">
        <div className="workspace__stage">
          <SheetPreview
            palettes={palettes}
            layout={layout}
            onPalettesChange={(next) => set((d) => ({ ...d, palettes: next }))}
            selectedId={selectedId}
            onSelectedIdChange={setSelectedId}
            editSlot={editSlot}
            onOpenSourceImage={openFromImageResume}
          />
        </div>
      </main>

      <FromImageModal
        open={fromImageOpen}
        resume={fromImageResume}
        onClose={() => {
          setFromImageOpen(false)
          setFromImageResume(null)
        }}
        onSave={saveFromImage}
      />
      <ImportSheetModal
        open={importSheetOpen}
        onClose={() => setImportSheetOpen(false)}
        onImport={importSheet}
      />
    </div>
  )
}
