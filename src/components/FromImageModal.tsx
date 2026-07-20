import { useEffect, useMemo, useRef, useState } from 'react'
import {
  downsampleMean,
  downsampleToCanvas,
  extractPalette,
  loadImageBlob,
  loadImageFile,
  type ClusterReduce,
} from '../lib/imagePalette'
import { createPalette } from '../lib/palette'
import type { Palette } from '../types'

interface FromImageModalProps {
  open: boolean
  onClose: () => void
  onAdd: (palette: Palette) => void
}

export function FromImageModal({ open, onClose, onAdd }: FromImageModalProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const downCanvasRef = useRef<HTMLCanvasElement>(null)
  const [source, setSource] = useState<ImageData | null>(null)
  const [fileName, setFileName] = useState('Image')
  const [maxSide, setMaxSide] = useState(48)
  const [k, setK] = useState(6)
  const [reduce, setReduce] = useState<ClusterReduce>('mean')
  const [error, setError] = useState<string | null>(null)

  const downsampled = useMemo(() => {
    if (!source) return null
    return downsampleMean(source, maxSide)
  }, [source, maxSide])

  const colors = useMemo(() => {
    if (!downsampled) return []
    return extractPalette(downsampled.samples, { k, reduce })
  }, [downsampled, k, reduce])

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
        void ingestBlob(blob, 'Pasted')
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
    const host = downCanvasRef.current
    if (!host || !downsampled) return
    const sheet = downsampleToCanvas(downsampled)
    host.width = sheet.width
    host.height = sheet.height
    const ctx = host.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, host.width, host.height)
    ctx.drawImage(sheet, 0, 0)
  }, [downsampled])

  async function ingestBlob(blob: Blob, label: string) {
    setError(null)
    try {
      const data = await loadImageBlob(blob)
      setSource(data)
      setFileName(label.replace(/\.[^.]+$/, '') || 'Image')
    } catch {
      setError('Could not read that image.')
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const data = await loadImageFile(file)
      setSource(data)
      setFileName(file.name.replace(/\.[^.]+$/, '') || 'Image')
    } catch {
      setError('Could not read that image.')
    }
  }

  function handleAdd() {
    if (!colors.length) return
    onAdd(createPalette(fileName, colors))
    onClose()
    setSource(null)
    setError(null)
  }

  function handleClose() {
    onClose()
  }

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onClick={handleClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="from-image-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__head">
          <div>
            <h2 id="from-image-title">Palette from image</h2>
            <p className="modal__sub">
              Mean downsample → OKLab k-means. Paste an image or upload a file.
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
            accept="image/*"
            hidden
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => fileRef.current?.click()}
          >
            Upload
          </button>
          <span className="modal__hint">or Ctrl+V to paste</span>
          {error && <span className="modal__error">{error}</span>}
        </div>

        <div className="modal__controls">
          <label className="field">
            <span>
              Downsample <em>{maxSide}px</em>
            </span>
            <input
              type="range"
              min={12}
              max={96}
              value={maxSide}
              disabled={!source}
              onChange={(e) => setMaxSide(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>
              Colors <em>{k}</em>
            </span>
            <input
              type="range"
              min={2}
              max={16}
              value={k}
              disabled={!source}
              onChange={(e) => setK(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Cluster color</span>
            <select
              value={reduce}
              disabled={!source}
              onChange={(e) => setReduce(e.target.value as ClusterReduce)}
            >
              <option value="mean">Mean</option>
              <option value="median">Median</option>
              <option value="mode">Mode</option>
            </select>
          </label>
          <label className="field">
            <span>Palette name</span>
            <input
              className="modal__name"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
          </label>
        </div>

        <div className="modal__split">
          <section className="modal__pane">
            <h3>Downsampled</h3>
            <div className="modal__preview modal__preview--down">
              {source && downsampled ? (
                <canvas ref={downCanvasRef} className="modal__down-canvas" />
              ) : (
                <p className="modal__empty">Upload or paste an image</p>
              )}
            </div>
            {downsampled && (
              <p className="modal__meta">
                {downsampled.width}×{downsampled.height} · mean blocks
              </p>
            )}
          </section>

          <section className="modal__pane">
            <h3>Palette preview</h3>
            <div className="modal__preview modal__preview--palette">
              {colors.length ? (
                <div className="modal__bands">
                  <p className="modal__band-name">{fileName || 'Palette'}</p>
                  {colors.map((hex) => (
                    <div key={hex} className="modal__band" style={{ background: hex }}>
                      <span>{hex}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="modal__empty">Palette appears here</p>
              )}
            </div>
            {colors.length > 0 && (
              <p className="modal__meta">
                {colors.length} colors · OKLab k-means · {reduce}
              </p>
            )}
          </section>
        </div>

        <footer className="modal__foot">
          <button type="button" className="btn btn--ghost btn--small" onClick={handleClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary btn--small"
            disabled={!colors.length}
            onClick={handleAdd}
          >
            Add palette
          </button>
        </footer>
      </div>
    </div>
  )
}
