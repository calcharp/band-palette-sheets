import { useEffect, useRef, useState } from 'react'
import { loadPngBlob, loadPngFile } from '../lib/imagePalette'
import {
  detectedToPalettes,
  parsePaletteSheet,
  type DetectedPalette,
} from '../lib/parsePaletteSheet'
import { contrastInk } from '../lib/render'
import type { Palette } from '../types'

interface ImportSheetModalProps {
  open: boolean
  onClose: () => void
  onAdd: (palettes: Palette[]) => void
}

export function ImportSheetModal({ open, onClose, onAdd }: ImportSheetModalProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState<ImageData | null>(null)
  const [detected, setDetected] = useState<DetectedPalette[]>([])
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
    if (!open || !source) return
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
  }, [open, source])

  async function ingestBlob(blob: Blob) {
    setError(null)
    setDetected([])
    setSource(null)
    try {
      const data = await loadPngBlob(blob)
      setSource(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that PNG.')
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setDetected([])
    setSource(null)
    try {
      const data = await loadPngFile(file)
      setSource(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that PNG.')
    }
  }

  function rename(index: number, name: string) {
    setDetected((prev) => prev.map((p, i) => (i === index ? { ...p, name } : p)))
  }

  function removeAt(index: number) {
    setDetected((prev) => prev.filter((_, i) => i !== index))
  }

  function handleAdd() {
    if (!detected.length) return
    onAdd(detectedToPalettes(detected))
    handleClose()
  }

  function handleClose() {
    onClose()
    setSource(null)
    setDetected([])
    setError(null)
    setStatus(null)
    setBusy(false)
  }

  if (!open) return null

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
                  PNG only — solid bands keep exact hexes. OCR reads names above each stack.
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
          {error && <span className="modal__error">{error}</span>}
        </div>

        <div className="sheet-import__list">
          {!source && !busy && (
            <p className="modal__empty">Upload or paste a palette sheet PNG</p>
          )}
          {busy && !detected.length && (
            <p className="modal__empty">{status ?? 'Working…'}</p>
          )}
          {detected.map((pal, i) => (
            <article key={`${pal.bounds.x}-${pal.bounds.y}-${i}`} className="sheet-import__card">
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
                {pal.colors.map((hex) => (
                  <div
                    key={hex}
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
            disabled={!detected.length || busy}
            onClick={handleAdd}
          >
            Add {detected.length || ''} palette{detected.length === 1 ? '' : 's'}
          </button>
        </footer>
      </div>
    </div>
  )
}
