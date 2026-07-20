import { useEffect } from 'react'
import { hexToHsb, hsbToHex, parseHex } from '../lib/palette'
import { ColorWheel } from './ColorWheel'

interface ColorPanelProps {
  hex: string
  paletteName: string
  colorIndex: number
  canDelete: boolean
  onChange: (hex: string) => void
  onClose: () => void
  onInsertAbove: () => void
  onInsertBelow: () => void
  onDelete: () => void
}

export function ColorPanel({
  hex,
  paletteName,
  colorIndex,
  canDelete,
  onChange,
  onClose,
  onInsertAbove,
  onInsertBelow,
  onDelete,
}: ColorPanelProps) {
  const valid = parseHex(hex) ?? '#000000'
  const hsb = hexToHsb(valid)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function setHsb(patch: Partial<{ h: number; s: number; b: number }>) {
    const next = { ...hsb, ...patch }
    onChange(hsbToHex(next.h, next.s, next.b))
  }

  return (
    <aside className="color-panel" aria-label="Color editor">
      <header className="color-panel__head">
        <div>
          <p className="color-panel__eyebrow">Edit color</p>
          <h2 className="color-panel__title">
            {paletteName}
            <span> · {colorIndex + 1}</span>
          </h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      <div className="color-panel__swatch" style={{ background: valid }} />

      <div className="color-panel__wheel-wrap">
        <ColorWheel hex={valid} onChange={onChange} size={236} />
      </div>

      <label className="color-panel__bright">
        <span>Brightness</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(hsb.b * 100)}
          onChange={(e) => setHsb({ b: Number(e.target.value) / 100 })}
          style={{
            background: `linear-gradient(to right, #000, ${hsbToHex(hsb.h, hsb.s, 1)})`,
          }}
          aria-label="Brightness"
        />
        <em>{Math.round(hsb.b * 100)}</em>
      </label>

      <div className="color-panel__hsb">
        <label>
          <span>H</span>
          <input
            type="range"
            min={0}
            max={360}
            value={Math.round(hsb.h)}
            onChange={(e) => setHsb({ h: Number(e.target.value) })}
            aria-label="Hue"
          />
          <em>{Math.round(hsb.h)}</em>
        </label>
        <label>
          <span>S</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(hsb.s * 100)}
            onChange={(e) => setHsb({ s: Number(e.target.value) / 100 })}
            aria-label="Saturation"
          />
          <em>{Math.round(hsb.s * 100)}</em>
        </label>
        <label>
          <span>Hex</span>
          <input
            className="color-panel__hex"
            value={hex}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            onBlur={(e) => {
              const ok = parseHex(e.target.value)
              if (ok) onChange(ok)
            }}
            aria-label="Hex color"
          />
        </label>
      </div>

      <div className="color-panel__actions">
        <button type="button" className="btn btn--ghost btn--small" onClick={onInsertAbove}>
          + Above
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={onInsertBelow}>
          + Below
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--small color-panel__delete"
          disabled={!canDelete}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>

      <button type="button" className="btn btn--primary color-panel__done" onClick={onClose}>
        Done
      </button>
    </aside>
  )
}
