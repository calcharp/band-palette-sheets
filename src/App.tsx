import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FromImageModal,
  type FromImageResume,
  type FromImageSeed,
} from './components/FromImageModal'
import { SheetPreview } from './components/SheetPreview'
import { Toolbar } from './components/Toolbar'
import { clipboardImageLabel } from './lib/clipboardImage'
import { useHistory } from './lib/history'
import { tryImportPaletteSheetPng } from './lib/importSheet'
import { loadImageFile } from './lib/imagePalette'
import { createPalette, uid } from './lib/palette'
import { attachImagePasteListeners } from './lib/pasteImage'
import { pngBlobWithSheetMeta } from './lib/pngMeta'
import { renderSheet } from './lib/render'
import { savePngBlob, suggestedPngFileName } from './lib/saveFile'
import { DEFAULT_LAYOUT, type Palette, type SheetLayout } from './types'

/** Old paper defaults → white sheet. */
const LEGACY_SHEET_BG = new Set(['#f4f0e8', '#f7f3eb', '#ebe4d6', '#faf7f1'])

interface DocState {
  title: string
  palettes: Palette[]
  layout: SheetLayout
}

async function imageDataForFromImage(
  file: File,
  sourcePath?: string,
): Promise<FromImageSeed> {
  const data = await loadImageFile(file)
  const maxSide = 900
  const scale = Math.min(1, maxSide / Math.max(data.width, data.height))
  const name = clipboardImageLabel(file).replace(/\.[^.]+$/, '') || 'Image'
  const path = sourcePath?.trim() || undefined
  if (scale >= 1) return { name, image: data, sourcePath: path }
  const w = Math.max(1, Math.round(data.width * scale))
  const h = Math.max(1, Math.round(data.height * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return { name, image: data, sourcePath: path }
  const tmp = document.createElement('canvas')
  tmp.width = data.width
  tmp.height = data.height
  tmp.getContext('2d')!.putImageData(data, 0, 0)
  ctx.drawImage(tmp, 0, 0, w, h)
  return { name, image: ctx.getImageData(0, 0, w, h), sourcePath: path }
}

export default function App() {
  const { present, set } = useHistory<DocState>({
    title: '',
    palettes: [],
    layout: DEFAULT_LAYOUT,
  })
  const { title, palettes, layout } = present
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editSlot, setEditSlot] = useState<HTMLDivElement | null>(null)
  const [fromImageOpen, setFromImageOpen] = useState(false)
  const [fromImageResume, setFromImageResume] = useState<FromImageResume | null>(null)
  const [fromImageSeed, setFromImageSeed] = useState<FromImageSeed | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const [layoutFocus, setLayoutFocus] = useState<'sheet-title' | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [toastTone, setToastTone] = useState<'warn' | 'error'>('error')
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const fromImageOpenRef = useRef(false)
  const sheetActiveRef = useRef(false)
  const importPngRef = useRef<(file: File, sourcePath?: string) => Promise<void>>(
    async () => {},
  )
  const openPastedInFromImageRef = useRef<
    (file: File, sourcePath: string) => Promise<void>
  >(async () => {})
  fromImageOpenRef.current = fromImageOpen

  const onEditSlot = useCallback((el: HTMLDivElement | null) => {
    setEditSlot(el)
  }, [])

  useEffect(() => {
    const bg = layout.background.trim().toLowerCase()
    if (!LEGACY_SHEET_BG.has(bg)) return
    set((d) => ({ ...d, layout: { ...d.layout, background: '#ffffff' } }))
  }, [layout.background, set])

  async function handleSave() {
    if (saveBusy) return
    setSaveBusy(true)
    try {
      const canvas = renderSheet(palettes, layout, 2, title)
      const raw = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png'),
      )
      if (!raw) return
      const blob = await pngBlobWithSheetMeta(raw, palettes, layout, title)
      const handle = await savePngBlob(
        blob,
        suggestedPngFileName(title),
        fileHandleRef.current,
      )
      if (handle) fileHandleRef.current = handle
    } finally {
      setSaveBusy(false)
    }
  }

  const handleSaveRef = useRef(handleSave)
  handleSaveRef.current = handleSave

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void handleSaveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function openFromImage() {
    setFromImageResume(null)
    setFromImageSeed(null)
    setFromImageOpen(true)
  }

  function openFromImageResume(palette: Palette) {
    if (!palette.sourceImage) return
    setFromImageSeed(null)
    setFromImageResume({
      paletteId: palette.id,
      name: palette.name,
      image: palette.sourceImage,
      picks:
        palette.sourcePicks ??
        palette.colors.map((hex, i) => ({ hex, x: i, y: 0 })),
      sourcePath: palette.sourcePath,
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

  function applyImportedSheet(payload: {
    palettes: Palette[]
    layout?: SheetLayout
    title?: string
  }) {
    set((d) => ({
      title: payload.title !== undefined ? payload.title : d.title,
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

  async function importPngFile(file: File, sourcePath?: string) {
    try {
      const sheet = await tryImportPaletteSheetPng(file)
      if (sheet) {
        setImportError(null)
        applyImportedSheet(sheet)
        return
      }
      const seed = await imageDataForFromImage(file, sourcePath)
      setFromImageResume(null)
      setFromImageSeed(seed)
      setFromImageOpen(true)
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Could not import that image.',
        'error',
        4000,
      )
    }
  }

  async function openPastedInFromImage(file: File, sourcePath: string) {
    try {
      const seed = await imageDataForFromImage(file, sourcePath)
      setFromImageResume(null)
      setFromImageSeed(seed)
      setFromImageOpen(true)
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Could not read that image.',
        'error',
        4000,
      )
    }
  }

  const showToastRef = useRef(showToast)
  function showToast(message: string, tone: 'warn' | 'error' = 'error', ms = 5000) {
    setToastTone(tone)
    setImportError(message)
    window.setTimeout(() => setImportError(null), ms)
  }
  showToastRef.current = showToast

  importPngRef.current = importPngFile
  openPastedInFromImageRef.current = openPastedInFromImage

  useEffect(() => {
    return attachImagePasteListeners({
      isFromImageOpen: () => fromImageOpenRef.current,
      isSheetActive: () => sheetActiveRef.current,
      onPathImage: (file, sourcePath) => {
        if (fromImageOpenRef.current) {
          void openPastedInFromImageRef.current(file, sourcePath)
        } else {
          void (async () => {
            try {
              const seed = await imageDataForFromImage(file, sourcePath)
              setFromImageResume(null)
              setFromImageSeed(seed)
              setFromImageOpen(true)
            } catch (e) {
              showToastRef.current(
                e instanceof Error ? e.message : 'Could not import that image.',
                'error',
                4000,
              )
            }
          })()
        }
      },
      onError: (message) => {
        showToastRef.current(message, 'error', 5000)
      },
    })
  }, [])

  function warnDropMissingPath() {
    showToast(
      'Dragged file has no path in this browser — sourcePath will not be saved in metadata. Paste the full path or URL if you need it.',
      'warn',
      7000,
    )
  }

  function openImportPicker() {
    setImportError(null)
    importInputRef.current?.click()
  }

  return (
    <div className="app">
      <input
        ref={importInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void importPngFile(file)
        }}
      />
      <Toolbar
        title={title}
        layout={layout}
        palettes={palettes}
        selectedId={selectedId}
        onSelectPalette={setSelectedId}
        onTitleChange={(next) => set((d) => ({ ...d, title: next }))}
        onLayoutChange={(next) => set((d) => ({ ...d, layout: next }))}
        onPalettesChange={(next) => set((d) => ({ ...d, palettes: next }))}
        onAddPalette={() =>
          set((d) => ({
            ...d,
            palettes: [...d.palettes, createPalette(`Palette ${d.palettes.length + 1}`)],
          }))
        }
        onFromImage={openFromImage}
        onImportSheet={openImportPicker}
        onSave={() => void handleSave()}
        saveBusy={saveBusy}
        onEditSlot={onEditSlot}
        layoutFocus={layoutFocus}
        onLayoutFocusHandled={() => setLayoutFocus(null)}
      />
      <main className="workspace">
        <div className="workspace__stage">
          <SheetPreview
            title={title}
            palettes={palettes}
            layout={layout}
            onTitleChange={(next) => set((d) => ({ ...d, title: next }))}
            onPalettesChange={(next) => set((d) => ({ ...d, palettes: next }))}
            onAddPalette={() =>
              set((d) => ({
                ...d,
                palettes: [...d.palettes, createPalette(`Palette ${d.palettes.length + 1}`)],
              }))
            }
            onFromImage={openFromImage}
            onImportSheet={openImportPicker}
            onImportPng={importPngFile}
            onDropMissingPath={warnDropMissingPath}
            onSheetActiveChange={(active) => {
              sheetActiveRef.current = active
            }}
            onRequestSheetTitleEdit={() => setLayoutFocus('sheet-title')}
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
        seed={fromImageSeed}
        onClose={() => {
          setFromImageOpen(false)
          setFromImageResume(null)
          setFromImageSeed(null)
        }}
        onSave={saveFromImage}
        onDropMissingPath={warnDropMissingPath}
      />

      {importError && (
        <p
          className={`workspace__toast ${
            toastTone === 'error' ? 'workspace__toast--error' : ''
          }`}
          role="status"
        >
          {importError}
        </p>
      )}
    </div>
  )
}
