import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FromImageModal,
  type FromImageResume,
  type FromImageSeed,
} from './components/FromImageModal'
import { SheetPreview } from './components/SheetPreview'
import { Toolbar } from './components/Toolbar'
import { clipboardImageLabel } from './lib/clipboardImage'
import {
  createHistoryStack,
  historyCanRedo,
  historyCanUndo,
  historyCommit,
  historyRedo,
  historyUndo,
  useHistoryKeyboard,
  type HistoryCommitOpts,
  type HistoryStack,
} from './lib/history'
import { tryImportPaletteSheetPng, diagnosePaletteSheetPng } from './lib/importSheet'
import { loadImageFile } from './lib/imagePalette'
import type { LibraryEntry } from './lib/library'
import {
  entriesInFolder,
  loadFileHandle,
  loadLibraryMeta,
  makeLibraryPreview,
  revealLibraryEntry,
  storeEntryThumb,
} from './lib/library'
import { createPalette, uid } from './lib/palette'
import { attachImagePasteListeners } from './lib/pasteImage'
import { pngBlobWithSheetMeta } from './lib/pngMeta'
import { renderSheet } from './lib/render'
import { savePngBlob, suggestedPngFileName, type SavePngResult } from './lib/saveFile'
import { DEFAULT_LAYOUT, type Palette, type SheetLayout } from './types'

/** Old paper defaults → white sheet. */
const LEGACY_SHEET_BG = new Set(['#f4f0e8', '#f7f3eb', '#ebe4d6', '#faf7f1'])

interface DocState {
  title: string
  palettes: Palette[]
  layout: SheetLayout
}

interface OpenSheet {
  id: string
  libraryEntryId: string | null
  handle: FileSystemFileHandle | null
  history: HistoryStack<DocState>
}

function emptyDoc(): DocState {
  return { title: '', palettes: [], layout: DEFAULT_LAYOUT }
}

function createOpenSheet(
  doc: DocState = emptyDoc(),
  opts?: {
    libraryEntryId?: string | null
    handle?: FileSystemFileHandle | null
  },
): OpenSheet {
  return {
    id: uid('sheet'),
    libraryEntryId: opts?.libraryEntryId ?? null,
    handle: opts?.handle ?? null,
    history: createHistoryStack(doc),
  }
}

function isBlankSheet(sheet: OpenSheet): boolean {
  const { present, past } = sheet.history
  return (
    !present.title.trim() &&
    present.palettes.length === 0 &&
    !sheet.handle &&
    !sheet.libraryEntryId &&
    past.length === 0
  )
}

function sheetTabLabel(sheet: OpenSheet): string {
  const title = sheet.history.present.title.trim()
  if (title) return title
  if (sheet.handle?.name) return sheet.handle.name.replace(/\.png$/i, '')
  return 'Untitled'
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
  const initialSheetRef = useRef<OpenSheet | null>(null)
  if (!initialSheetRef.current) initialSheetRef.current = createOpenSheet()
  const [sheets, setSheets] = useState<OpenSheet[]>([initialSheetRef.current])
  const [activeSheetId, setActiveSheetId] = useState(initialSheetRef.current.id)
  const activeSheet = sheets.find((s) => s.id === activeSheetId) ?? sheets[0]!
  const { title, palettes, layout } = activeSheet.history.present

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editSlot, setEditSlot] = useState<HTMLDivElement | null>(null)
  const [fromImageOpen, setFromImageOpen] = useState(false)
  const [fromImageResume, setFromImageResume] = useState<FromImageResume | null>(null)
  const [fromImageSeed, setFromImageSeed] = useState<FromImageSeed | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [toastTone, setToastTone] = useState<'warn' | 'error'>('error')
  const [libraryTabActive, setLibraryTabActive] = useState(false)
  /** Bumps on undo/redo so editors drop ephemeral overlays. */
  const [historyGen, setHistoryGen] = useState(0)
  const importInputRef = useRef<HTMLInputElement>(null)
  const fromImageOpenRef = useRef(false)
  const sheetActiveRef = useRef(false)
  const importPngRef = useRef<(file: File, sourcePath?: string) => Promise<void>>(
    async () => {},
  )
  const tryApplySheetMetaRef = useRef<(file: File) => Promise<boolean>>(async () => false)
  const sheetsRef = useRef(sheets)
  const activeSheetIdRef = useRef(activeSheetId)
  sheetsRef.current = sheets
  activeSheetIdRef.current = activeSheetId
  fromImageOpenRef.current = fromImageOpen

  const onEditSlot = useCallback((el: HTMLDivElement | null) => {
    setEditSlot(el)
  }, [])

  const patchActiveHistory = useCallback(
    (updater: (history: HistoryStack<DocState>) => HistoryStack<DocState>) => {
      setSheets((prev) =>
        prev.map((s) =>
          s.id === activeSheetIdRef.current ? { ...s, history: updater(s.history) } : s,
        ),
      )
    },
    [],
  )

  const set = useCallback(
    (
      next: DocState | ((prev: DocState) => DocState),
      opts?: HistoryCommitOpts,
    ) => {
      patchActiveHistory((history) => historyCommit(history, next, opts))
    },
    [patchActiveHistory],
  )

  useHistoryKeyboard({
    enabled: !libraryTabActive,
    canUndo: () => {
      const sheet = sheetsRef.current.find((s) => s.id === activeSheetIdRef.current)
      return sheet ? historyCanUndo(sheet.history) : false
    },
    canRedo: () => {
      const sheet = sheetsRef.current.find((s) => s.id === activeSheetIdRef.current)
      return sheet ? historyCanRedo(sheet.history) : false
    },
    undo: () => {
      patchActiveHistory((history) => historyUndo(history) ?? history)
      setHistoryGen((n) => n + 1)
    },
    redo: () => {
      patchActiveHistory((history) => historyRedo(history) ?? history)
      setHistoryGen((n) => n + 1)
    },
  })

  useEffect(() => {
    const bg = layout.background.trim().toLowerCase()
    if (!LEGACY_SHEET_BG.has(bg)) return
    set((d) => ({ ...d, layout: { ...d.layout, background: '#ffffff' } }))
  }, [layout.background, set])

  useEffect(() => {
    setSelectedId(null)
  }, [activeSheetId])

  async function handleSave(): Promise<SavePngResult> {
    const sheet = sheetsRef.current.find((s) => s.id === activeSheetIdRef.current)
    if (!sheet) return { status: 'cancelled' }
    if (saveBusy) {
      return sheet.handle
        ? { status: 'saved', handle: sheet.handle }
        : { status: 'cancelled' }
    }
    setSaveBusy(true)
    try {
      const { title: t, palettes: pals, layout: lay } = sheet.history.present
      const canvas = renderSheet(pals, lay, 2, t)
      const raw = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png'),
      )
      if (!raw) return { status: 'failed', message: 'Could not render sheet.' }
      const blob = await pngBlobWithSheetMeta(raw, pals, lay, t)
      const result = await savePngBlob(
        blob,
        suggestedPngFileName(t),
        sheet.handle,
      )
      if (result.status === 'saved') {
        setSheets((prev) =>
          prev.map((s) =>
            s.id === sheet.id ? { ...s, handle: result.handle } : s,
          ),
        )
      }
      if (result.status === 'failed') {
        showToast(result.message, 'error')
      }
      return result
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

  /** True when the PNG had Paletter metadata and was merged into the sheet. */
  async function tryApplySheetMeta(file: File): Promise<boolean> {
    const sheet = await tryImportPaletteSheetPng(file)
    if (!sheet) return false
    setImportError(null)
    applyImportedSheet(sheet)
    setFromImageOpen(false)
    setFromImageResume(null)
    setFromImageSeed(null)
    return true
  }

  async function importPngFile(file: File, sourcePath?: string) {
    try {
      if (await tryApplySheetMeta(file)) return
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

  const showToastRef = useRef(showToast)
  function showToast(message: string, tone: 'warn' | 'error' = 'error', ms = 5000) {
    setToastTone(tone)
    setImportError(message)
    window.setTimeout(() => setImportError(null), ms)
  }
  showToastRef.current = showToast

  importPngRef.current = importPngFile
  tryApplySheetMetaRef.current = tryApplySheetMeta

  useEffect(() => {
    return attachImagePasteListeners({
      isFromImageOpen: () => fromImageOpenRef.current,
      isSheetActive: () => sheetActiveRef.current,
      onPathImage: (file, sourcePath) => {
        // Always try embedded Paletter metadata first; plain images open From image.
        void importPngRef.current(file, sourcePath)
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

  function addNewSheet() {
    const sheet = createOpenSheet()
    setSheets((prev) => [...prev, sheet])
    setActiveSheetId(sheet.id)
  }

  function closeSheet(id: string) {
    setSheets((prev) => {
      if (prev.length === 1) {
        const blank = createOpenSheet()
        setActiveSheetId(blank.id)
        return [blank]
      }
      const idx = prev.findIndex((s) => s.id === id)
      const next = prev.filter((s) => s.id !== id)
      if (activeSheetIdRef.current === id) {
        const fallback = next[Math.max(0, idx - 1)] ?? next[0]!
        setActiveSheetId(fallback.id)
      }
      return next
    })
  }

  async function revealLibrarySheet(entry: LibraryEntry) {
    const result = await revealLibraryEntry(entry.id)
    if (result === 'ok') return
    if (result === 'no-handle') {
      showToast(
        `No file link for “${entry.name}”. Re-add it after saving.`,
        'warn',
        6000,
      )
      return
    }
    if (result === 'denied') {
      showToast(`Could not access “${entry.name}”.`, 'error')
      return
    }
    if (result === 'unsupported') {
      showToast(
        'This browser can’t open the system folder picker.',
        'warn',
        5000,
      )
      return
    }
    showToast(`Could not show “${entry.name}” in a folder.`, 'error')
  }

  async function addCurrentToLibrary(_folderId: string | null) {
    const result = await handleSave()
    if (result.status === 'cancelled') {
      showToast('Save the sheet first to add it to the library.', 'warn', 5000)
      return null
    }
    if (result.status === 'failed') return null

    const sheet = sheetsRef.current.find((s) => s.id === activeSheetIdRef.current)
    const handle =
      result.status === 'saved' ? result.handle : sheet?.handle ?? null
    if (!handle) {
      showToast(
        'No file link after save. Use Save (file picker), then Add open sheet again.',
        'warn',
        6000,
      )
      return null
    }

    let preview: Blob | null = null
    try {
      const file = await handle.getFile()
      const check = await diagnosePaletteSheetPng(file)
      if (check !== 'ok') {
        showToast(
          'Save finished but the PNG is missing Paletter data. Try Save again, then Add open sheet.',
          'error',
          7000,
        )
        return null
      }
      preview = file
    } catch {
      showToast('Could not verify the saved file.', 'error')
      return null
    }

    const t = sheet?.history.present.title ?? ''
    const fileName = handle.name || suggestedPngFileName(t)
    const name = t.trim() || fileName.replace(/\.png$/i, '') || 'Untitled'
    return { name, fileName, handle, preview }
  }

  async function addPngFileToLibrary(_folderId: string | null) {
    type OpenPicker = (options?: {
      multiple?: boolean
      types?: { description: string; accept: Record<string, string[]> }[]
    }) => Promise<FileSystemFileHandle[]>

    const openPicker =
      typeof window !== 'undefined' && 'showOpenFilePicker' in window
        ? (window.showOpenFilePicker as OpenPicker).bind(window)
        : null

    let handle: FileSystemFileHandle | null = null
    let file: File | null = null

    if (openPicker) {
      try {
        const handles = await openPicker({
          multiple: false,
          types: [
            {
              description: 'PNG image',
              accept: { 'image/png': ['.png'] },
            },
          ],
        })
        handle = handles[0] ?? null
        if (!handle) return null
        file = await handle.getFile()
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return null
        showToast('Could not open that file.', 'error')
        return null
      }
    } else {
      file = await new Promise<File | null>((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/png,.png'
        input.onchange = () => resolve(input.files?.[0] ?? null)
        input.oncancel = () => resolve(null)
        input.click()
      })
      if (!file) return null
    }

    try {
      const sheet = await tryImportPaletteSheetPng(file)
      if (!sheet) {
        showToast('That file is not a Paletter sheet PNG.', 'error')
        return null
      }
      const fileName = handle?.name || file.name
      const name =
        sheet.title?.trim() || fileName.replace(/\.png$/i, '') || 'Untitled'
      return { name, fileName, handle, preview: file }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not read that PNG.', 'error')
      return null
    }
  }

  async function loadEntryAsDoc(entry: LibraryEntry): Promise<{
    doc: DocState
    handle: FileSystemFileHandle
  } | null> {
    const handle = await loadFileHandle(entry.id)
    if (!handle) {
      showToast(
        `No file link for “${entry.name}”. Re-add it after saving.`,
        'warn',
        6000,
      )
      return null
    }
    const query = await handle.queryPermission({ mode: 'read' })
    if (
      query !== 'granted' &&
      (await handle.requestPermission({ mode: 'read' })) !== 'granted'
    ) {
      showToast(`Could not access “${entry.name}”.`, 'error')
      return null
    }
    const file = await handle.getFile()
    const sheet = await tryImportPaletteSheetPng(file)
    if (!sheet) {
      const why = await diagnosePaletteSheetPng(file)
      if (why === 'no-meta' || why === 'bad-meta') {
        showToast(
          `“${entry.name}” has no Paletter sheet data. Open it only works for PNGs saved from this app — re-save the sheet, then Add open sheet again.`,
          'error',
          8000,
        )
      } else {
        showToast(`“${entry.name}” is not a readable PNG.`, 'error')
      }
      return null
    }
    void makeLibraryPreview(file)
      .then((thumb) => storeEntryThumb(entry.id, thumb))
      .catch(() => {})
    return {
      handle,
      doc: {
        title: sheet.title ?? entry.name,
        layout: sheet.layout ?? DEFAULT_LAYOUT,
        palettes: sheet.palettes,
      },
    }
  }

  async function openLibraryEntry(entry: LibraryEntry) {
    try {
      const loaded = await loadEntryAsDoc(entry)
      if (!loaded) return
      const existing = sheetsRef.current.find((s) => s.libraryEntryId === entry.id)
      if (existing) {
        setSheets((prev) =>
          prev.map((s) =>
            s.id === existing.id
              ? {
                  ...s,
                  handle: loaded.handle,
                  history: createHistoryStack(loaded.doc),
                }
              : s,
          ),
        )
        setActiveSheetId(existing.id)
        return
      }
      const next = createOpenSheet(loaded.doc, {
        libraryEntryId: entry.id,
        handle: loaded.handle,
      })
      setSheets((prev) => {
        if (prev.length === 1 && isBlankSheet(prev[0]!)) {
          setActiveSheetId(next.id)
          return [next]
        }
        setActiveSheetId(next.id)
        return [...prev, next]
      })
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not open that sheet.', 'error')
    }
  }

  async function openLibraryFolder(folderId: string) {
    const entries = entriesInFolder(loadLibraryMeta().entries, folderId)
    if (!entries.length) {
      showToast('That folder has no sheets.', 'warn', 4000)
      return
    }
    const opened: OpenSheet[] = []
    const reloads: { id: string; handle: FileSystemFileHandle; doc: DocState }[] = []
    let focused: string | null = null
    for (const entry of entries) {
      try {
        const loaded = await loadEntryAsDoc(entry)
        if (!loaded) continue
        const existing = sheetsRef.current.find((s) => s.libraryEntryId === entry.id)
        if (existing) {
          reloads.push({ id: existing.id, handle: loaded.handle, doc: loaded.doc })
          if (!focused) focused = existing.id
          continue
        }
        const sheet = createOpenSheet(loaded.doc, {
          libraryEntryId: entry.id,
          handle: loaded.handle,
        })
        opened.push(sheet)
        if (!focused) focused = sheet.id
      } catch {
        // continue with remaining
      }
    }
    if (!opened.length && !reloads.length) return
    setSheets((prev) => {
      let next = prev.map((s) => {
        const reload = reloads.find((r) => r.id === s.id)
        if (!reload) return s
        return {
          ...s,
          handle: reload.handle,
          history: createHistoryStack(reload.doc),
        }
      })
      if (opened.length) {
        if (next.length === 1 && isBlankSheet(next[0]!)) next = []
        next = [...next, ...opened]
      }
      const id = focused ?? next[next.length - 1]!.id
      setActiveSheetId(id)
      return next
    })
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
        onPalettesChange={(next, opts) =>
          set(
            (d) => ({
              ...d,
              palettes: typeof next === 'function' ? next(d.palettes) : next,
            }),
            opts,
          )
        }
        onSave={() => void handleSave()}
        saveBusy={saveBusy}
        onEditSlot={onEditSlot}
        onAddToLibrary={addCurrentToLibrary}
        onAddPngToLibrary={addPngFileToLibrary}
        onOpenLibraryEntry={(entry) => void openLibraryEntry(entry)}
        onOpenLibraryFolder={(folderId) => void openLibraryFolder(folderId)}
        onRevealLibraryEntry={(entry) => void revealLibrarySheet(entry)}
        onLinkedLibraryEntry={(entryId) => {
          setSheets((prev) =>
            prev.map((s) =>
              s.id === activeSheetIdRef.current
                ? { ...s, libraryEntryId: entryId }
                : s,
            ),
          )
        }}
        onLibraryTabActiveChange={setLibraryTabActive}
        openSheets={sheets.map((s) => ({
          id: s.id,
          label: sheetTabLabel(s),
          libraryEntryId: s.libraryEntryId,
          handle: s.handle,
        }))}
        activeSheetId={activeSheetId}
        onSelectSheet={setActiveSheetId}
        onCloseSheet={closeSheet}
        onNewSheet={addNewSheet}
      />
      <main className="workspace">
        <div className="workspace__stage">
          <SheetPreview
            title={title}
            palettes={palettes}
            layout={layout}
            onTitleChange={(next) => set((d) => ({ ...d, title: next }))}
            onPalettesChange={(next, opts) =>
              set(
                (d) => ({
                  ...d,
                  palettes: typeof next === 'function' ? next(d.palettes) : next,
                }),
                opts,
              )
            }
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
            selectedId={selectedId}
            onSelectedIdChange={setSelectedId}
            editSlot={editSlot}
            historyGen={historyGen}
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
        onTryImportSheet={(file) => tryApplySheetMetaRef.current(file)}
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
