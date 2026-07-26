import { useEffect, useRef, useState } from 'react'
import { assertPng, loadPngBlob } from '../lib/imagePalette'
import {
  detectedToPalettes,
  parsePaletteSheet,
  type DetectedPalette,
} from '../lib/parsePaletteSheet'
import { readSheetMetaFromPng } from '../lib/pngMeta'
import { contrastInk } from '../lib/render'
import type { Palette, SheetLayout } from '../types'

interface ImportSheetModalProps {
  open: boolean
  onClose: () => void
  onImport: (payload: { palettes: Palette[]; layout?: SheetLayout }) => void
}

export function ImportSheetModal({ open, onClose, onImport }: ImportSheetModalProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState<ImageData | null>(null)
  const [detected, setDetected] = useState<DetectedPalette[]>([])
  const [metaPalettes, setMetaPalettes] = useState<Palette[] | null>(null)
  const [metaLayout, setMetaLayout] = useState<SheetLayout | null>(null)
  const [fromMeta, setFromMeta] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (!item.type.startsWith('image/')) continue
        const blob = item.getAsFile()
        if (!blob) continue
        e.preventDefault()
        void ingestBlob(blob)
        return
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open || !source || fromMeta) return
    let cancelled = false
    setBusy(true)
    setStatus('Detecting swatches…')
    setError(null)
    void (async () => {
      try {
        setStatus('Reading palette names…')
        const result = await parsePaletteSheet(source, { ocr: true })
        if (cancelled) return
        if (!result.palettes.length) {
          setDetected([])
          setError('No color rectangles found. Try a clearer sheet export.')
        } else {
          setDetected(result.palettes)
          setError(null)
        }
      } catch (e) {
        if (cancelled) return
        setDetected([])
        setError(e instanceof Error ? e.message : 'Could not parse that sheet.')
      } finally {
        if (!cancelled) {
          setBusy(false)
          setStatus(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, source, fromMeta])

  function resetPreview() {
    setSource(null)
    setDetected([])
    setMetaPalettes(null)
    setMetaLayout(null)
    setFromMeta(false)
    setBusy(false)
    setStatus(null)
  }

  async function ingestBlob(blob: Blob) {
    setError(null)
    resetPreview()
    setBusy(true)
    setStatus('Reading PNG…')
    try {
      await assertPng(blob)
      const embedded = await readSheetMetaFromPng(blob)
      if (embedded?.palettes.length) {
        setMetaPalettes(embedded.palettes)
        setMetaLayout(embedded.layout)
        setFromMeta(true)
        setSource(null)
        setStatus(null)
        setBusy(false)
        return
      }
      const data = await loadPngBlob(blob)
      setFromMeta(false)
      setSource(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that PNG.')
      setBusy(false)
      setStatus(null)
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    await ingestBlob(file)
  }

  function rename(index: number, name: string) {
    if (fromMeta && metaPalettes) {
      setMetaPalettes((prev) =>
        prev ? prev.map((p, i) => (i === index ? { ...p, name } : p)) : prev,
      )
      return
    }
    setDetected((prev) => prev.map((p, i) => (i === index ? { ...p, name } : p)))
  }

  function removeAt(index: number) {
    if (fromMeta && metaPalettes) {
      setMetaPalettes((prev) => (prev ? prev.filter((_, i) => i !== index) : prev))
      return
    }
    setDetected((prev) => prev.filter((_, i) => i !== index))
  }

  function handleAdd() {
    if (fromMeta && metaPalettes?.length) {
      onImport({
        palettes: metaPalettes,
        layout: metaLayout ?? undefined,
      })
      handleClose()
      return
    }
    if (!detected.length) return
    onImport({ palettes: detectedToPalettes(detected) })
    handleClose()
  }

  function handleClose() {
    onClose()
    resetPreview()
    setError(null)
  }

  if (!open) return null

  const previewPalettes: { name: string; colors: string[]; key: string }[] = fromMeta
    ? (metaPalettes ?? []).map((p, i) => ({
        name: p.name,
        colors: p.colors,
        key: p.id || `meta-${i}`,
      }))
    : detected.map((p, i) => ({
        name: p.name,
        colors: p.colors,
        key: `${p.bounds.x}-${p.bounds.y}-${i}`,
      }))

  const count = previewPalettes.length
  const canAdd = count > 0 && !busy

  return (
    <div className="modal-backdrop" role="presentation" onClick={handleClose}>
      <div
        className="modal modal--sheet-import"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__head">
          <div>
            <h2 id="import-sheet-title">Import palette sheet</h2>
            <p className="modal__sub">
              {fromMeta
                ? 'Embedded Paletter data found — palettes, layout, and reference images will import exactly.'
                : 'PNG from this app embeds exact data. Other PNGs are scanned for solid bands (OCR for names).'}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={handleClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="modal__toolbar">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,.png"
            hidden
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => fileRef.current?.click()}
          >
            Upload PNG
          </button>
          <span className="modal__hint">PNG only · or Ctrl+V to paste</span>
          {busy && status && <span className="modal__hint">{status}</span>}
          {fromMeta && !busy && (
            <span className="modal__hint">Using embedded sheet data</span>
          )}
          {error && <span className="modal__error">{error}</span>}
        </div>

        <div className="sheet-import__list">
          {!source && !fromMeta && !busy && (
            <p className="modal__empty">Upload or paste a palette sheet PNG</p>
          )}
          {busy && !count && <p className="modal__empty">{status ?? 'Working…'}</p>}
          {previewPalettes.map((pal, i) => (
            <article key={pal.key} className="sheet-import__card">
              <div className="sheet-import__card-head">
                <input
                  className="modal__name"
                  value={pal.name}
                  aria-label={`Palette ${i + 1} name`}
                  onChange={(e) => rename(i, e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => removeAt(i)}
                >
                  Remove
                </button>
              </div>
              <div className="sheet-import__bands">
                {pal.colors.map((hex, ci) => (
                  <div
                    key={`${hex}-${ci}`}
                    className="modal__band"
                    style={{ background: hex, color: contrastInk(hex) }}
                  >
                    <span>{hex}</span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>

        <footer className="modal__foot">
          <button type="button" className="btn btn--ghost btn--small" onClick={handleClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary btn--small"
            disabled={!canAdd}
            onClick={handleAdd}
          >
            Add {count || ''} palette{count === 1 ? '' : 's'}
          </button>
        </footer>
      </div>
    </div>
  )
}
