import { useState } from 'react'
import { FromImageModal } from './components/FromImageModal'
import { SheetPreview } from './components/SheetPreview'
import { Toolbar } from './components/Toolbar'
import { useHistory } from './lib/history'
import { createPalette, downloadCanvasJpg } from './lib/palette'
import { renderSheet } from './lib/render'
import { DEFAULT_LAYOUT, type Palette, type SheetLayout } from './types'

const STARTER: Palette[] = [
  createPalette('Ink', ['#1c1917', '#44403c', '#a8a29e', '#e7e5e4']),
  createPalette('Clay', ['#7c2d12', '#c2410c', '#fb923c', '#ffedd5']),
  createPalette('Sea', ['#0c4a6e', '#0369a1', '#38bdf8', '#e0f2fe']),
]

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
  const [fromImageOpen, setFromImageOpen] = useState(false)

  function handleExport() {
    const canvas = renderSheet(palettes, layout, 2)
    downloadCanvasJpg(canvas, 'palette-sheet')
  }

  return (
    <div className="app">
      <Toolbar
        layout={layout}
        paletteCount={palettes.length}
        onLayoutChange={(next) => set((d) => ({ ...d, layout: next }))}
        onAddPalette={() =>
          set((d) => ({
            ...d,
            palettes: [...d.palettes, createPalette(`Palette ${d.palettes.length + 1}`)],
          }))
        }
        onFromImage={() => setFromImageOpen(true)}
        onExport={handleExport}
      />
      <main className="workspace">
        <div className="workspace__stage">
          <SheetPreview
            palettes={palettes}
            layout={layout}
            onPalettesChange={(next) => set((d) => ({ ...d, palettes: next }))}
          />
        </div>
      </main>

      <FromImageModal
        open={fromImageOpen}
        onClose={() => setFromImageOpen(false)}
        onAdd={(palette) => set((d) => ({ ...d, palettes: [...d.palettes, palette] }))}
      />
    </div>
  )
}
