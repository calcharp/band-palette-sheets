import { useEffect, useMemo, useRef, useState } from 'react'
import { mixOklab } from '../lib/colorSpace'
import { contrastInk } from '../lib/render'
import { normalizeHex, parseHex, uid } from '../lib/palette'
import type { Palette } from '../types'

interface MixSlot {
  id: string
  hex: string
  weight: number
  label: string
}

interface ColorMixToolProps {
  palette: Palette
  allPalettes: Palette[]
  onAddColor: (hex: string) => void
}

type PickerMode = 'this' | 'other' | 'image' | null

export function ColorMixTool({ palette, allPalettes, onAddColor }: ColorMixToolProps) {
  const [slots, setSlots] = useState<MixSlot[]>([])
  const [picker, setPicker] = useState<PickerMode>(null)
  const [otherId, setOtherId] = useState(
    () => allPalettes.find((p) => p.id !== palette.id)?.id ?? '',
  )
  const [imageData, setImageData] = useState<ImageData | null>(null)
  const imgCanvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const mixed = useMemo(() => {
    if (slots.length < 2) return null
    return mixOklab(slots.map((s) => ({ hex: s.hex, weight: s.weight })))
  }, [slots])

  useEffect(() => {
    const host = imgCanvasRef.current
    if (!host || !imageData) return
    host.width = imageData.width
    host.height = imageData.height
    const ctx = host.getContext('2d')
    if (!ctx) return
    ctx.putImageData(imageData, 0, 0)
  }, [imageData])

  useEffect(() => {
    if (picker !== 'image') return
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (!item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (file) void loadImage(file)
        e.preventDefault()
        return
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [picker])

  function addSlot(hex: string, label: string) {
    setSlots((prev) => [
      ...prev,
      { id: uid('mix'), hex: normalizeHex(hex), weight: 1, label },
    ])
    setPicker(null)
  }

  function updateSlot(id: string, patch: Partial<MixSlot>) {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  function removeSlot(id: string) {
    setSlots((prev) => prev.filter((s) => s.id !== id))
  }

  async function loadImage(file: File) {
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('load failed'))
        el.src = url
      })
      const maxSide = 360
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(img, 0, 0, w, h)
      setImageData(ctx.getImageData(0, 0, w, h))
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  function sampleImage(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!imageData) return
    const canvas = imgCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.min(
      imageData.width - 1,
      Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * imageData.width)),
    )
    const y = Math.min(
      imageData.height - 1,
      Math.max(0, Math.floor(((e.clientY - rect.top) / rect.height) * imageData.height)),
    )
    const i = (y * imageData.width + x) * 4
    const a = imageData.data[i + 3] / 255
    const r = Math.round(imageData.data[i] * a + 255 * (1 - a))
    const g = Math.round(imageData.data[i + 1] * a + 255 * (1 - a))
    const b = Math.round(imageData.data[i + 2] * a + 255 * (1 - a))
    const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
    addSlot(hex, 'Image')
  }

  const otherPalettes = allPalettes.filter((p) => p.id !== palette.id)
  const other = otherPalettes.find((p) => p.id === otherId) ?? otherPalettes[0]

  return (
    <section className="palette-panel__section mix-tool">
      <h3>Mix</h3>
      <p className="palette-panel__help">
        Weighted OKLab blend of 2+ colors from this palette, another palette, or an image.
      </p>

      {slots.length === 0 && (
        <p className="mix-tool__empty">Add at least two colors to mix.</p>
      )}

      <ul className="mix-tool__slots">
        {slots.map((slot) => (
          <li key={slot.id} className="mix-tool__slot">
            <span className="mix-tool__swatch" style={{ background: slot.hex }} title={slot.hex} />
            <div className="mix-tool__slot-body">
              <div className="mix-tool__slot-head">
                <span className="mix-tool__label">{slot.label}</span>
                <span className="mix-tool__hex">{slot.hex}</span>
                <button
                  type="button"
                  className="icon-btn icon-btn--tiny"
                  onClick={() => removeSlot(slot.id)}
                  aria-label="Remove from mix"
                >
                  ×
                </button>
              </div>
              <label className="mix-tool__weight">
                <span>Weight {slot.weight.toFixed(1)}</span>
                <input
                  type="range"
                  min={0.1}
                  max={4}
                  step={0.1}
                  value={slot.weight}
                  onChange={(e) => updateSlot(slot.id, { weight: Number(e.target.value) })}
                />
              </label>
            </div>
          </li>
        ))}
      </ul>

      <div className="mix-tool__add-row">
        <button
          type="button"
          className={`chip ${picker === 'this' ? 'chip--on' : ''}`}
          onClick={() => setPicker(picker === 'this' ? null : 'this')}
        >
          + This palette
        </button>
        <button
          type="button"
          className={`chip ${picker === 'other' ? 'chip--on' : ''}`}
          disabled={otherPalettes.length === 0}
          onClick={() => setPicker(picker === 'other' ? null : 'other')}
        >
          + Other palette
        </button>
        <button
          type="button"
          className={`chip ${picker === 'image' ? 'chip--on' : ''}`}
          onClick={() => setPicker(picker === 'image' ? null : 'image')}
        >
          + Image
        </button>
      </div>

      {picker === 'this' && (
        <div className="mix-tool__picker">
          <p className="mix-tool__picker-label">This palette</p>
          <div className="mix-tool__swatch-grid">
            {palette.colors.map((hex, i) => (
              <button
                key={`${hex}-${i}`}
                type="button"
                className="mix-tool__pick"
                style={{ background: hex, color: contrastInk(hex) }}
                onClick={() => addSlot(hex, `${palette.name} ${i + 1}`)}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      {picker === 'other' && other && (
        <div className="mix-tool__picker">
          <label className="mix-tool__picker-label">
            Palette
            <select
              value={other.id}
              onChange={(e) => setOtherId(e.target.value)}
            >
              {otherPalettes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="mix-tool__swatch-grid">
            {other.colors.map((hex, i) => (
              <button
                key={`${hex}-${i}`}
                type="button"
                className="mix-tool__pick"
                style={{ background: hex, color: contrastInk(hex) }}
                onClick={() => addSlot(hex, `${other.name} ${i + 1}`)}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      {picker === 'image' && (
        <div className="mix-tool__picker">
          <div className="mix-tool__image-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void loadImage(f)
              }}
            />
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => fileRef.current?.click()}
            >
              Upload
            </button>
            <span className="mix-tool__hint">or paste · click to sample</span>
          </div>
          {imageData ? (
            <canvas
              ref={imgCanvasRef}
              className="mix-tool__image"
              onClick={sampleImage}
            />
          ) : (
            <p className="mix-tool__empty">Upload or paste an image, then click a pixel.</p>
          )}
        </div>
      )}

      {mixed && (
        <div className="mix-tool__result">
          <div
            className="mix-tool__result-swatch"
            style={{ background: mixed, color: contrastInk(mixed) }}
          >
            {mixed}
          </div>
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={() => {
              const hex = parseHex(mixed) ?? mixed
              onAddColor(hex)
            }}
          >
            Add to palette
          </button>
        </div>
      )}
    </section>
  )
}
