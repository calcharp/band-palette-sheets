import { useEffect, useRef, useState } from 'react'
import { parseHex } from '../lib/palette'
import type { NamePosition, SheetLayout } from '../types'

interface ToolbarProps {
  layout: SheetLayout
  paletteCount: number
  onLayoutChange: (layout: SheetLayout) => void
  onAddPalette: () => void
  onExport: () => void
}

export function Toolbar({
  layout,
  paletteCount,
  onLayoutChange,
  onAddPalette,
  onExport,
}: ToolbarProps) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function patch(patch: Partial<SheetLayout>) {
    onLayoutChange({ ...layout, ...patch })
  }

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <p className="toolbar__mark">Band</p>
        <p className="toolbar__tag">Drag to rearrange · Ctrl+Z undo</p>
      </div>

      <div className="toolbar__actions">
        <button type="button" className="btn btn--ghost btn--small" onClick={onAddPalette}>
          + Palette
        </button>

        <div className="toolbar__layout" ref={panelRef}>
          <button
            type="button"
            className={`btn btn--ghost btn--small ${open ? 'btn--active' : ''}`}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            Layout
          </button>
          {open && (
            <div className="layout-pop">
              <label className="field">
                <span>Columns</span>
                <select
                  value={layout.columns ?? 'auto'}
                  onChange={(e) =>
                    patch({
                      columns: e.target.value === 'auto' ? null : Number(e.target.value),
                    })
                  }
                >
                  <option value="auto">Auto</option>
                  {Array.from({ length: Math.max(12, paletteCount) }, (_, i) => i + 1).map(
                    (n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ),
                  )}
                </select>
              </label>

              <Slider
                label="Column gap"
                min={0}
                max={120}
                value={layout.colGap}
                onChange={(colGap) => patch({ colGap })}
              />
              <Slider
                label="Row gap"
                min={0}
                max={160}
                value={layout.rowGap}
                onChange={(rowGap) => patch({ rowGap })}
              />
              <Slider
                label="Band width"
                min={40}
                max={480}
                value={layout.bandWidth}
                onChange={(bandWidth) => patch({ bandWidth })}
              />
              <Slider
                label="Band height"
                min={8}
                max={80}
                value={layout.bandHeight}
                onChange={(bandHeight) => patch({ bandHeight })}
              />

              <fieldset className="name-pos">
                <legend>Name position</legend>
                <div className="chip-row">
                  {(['above', 'below', 'left', 'right'] as NamePosition[]).map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      className={`chip ${layout.namePosition === pos ? 'chip--on' : ''}`}
                      onClick={() => patch({ namePosition: pos })}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </fieldset>

              <Slider
                label="Name gap"
                min={0}
                max={48}
                value={layout.nameGap}
                onChange={(nameGap) => patch({ nameGap })}
              />
              <Slider
                label="Padding"
                min={0}
                max={120}
                value={layout.padding}
                onChange={(padding) => patch({ padding })}
              />

              <label className="field">
                <span>Background</span>
                <div className="field__color">
                  <input
                    type="color"
                    value={layout.background}
                    onChange={(e) => patch({ background: e.target.value })}
                  />
                  <input
                    className="swatch__hex"
                    value={layout.background}
                    onChange={(e) => {
                      const ok = parseHex(e.target.value)
                      if (ok) patch({ background: ok.toLowerCase() })
                      else patch({ background: e.target.value })
                    }}
                  />
                </div>
              </label>
            </div>
          )}
        </div>

        <button type="button" className="btn btn--primary btn--small" onClick={onExport}>
          Export JPG
        </button>
      </div>
    </header>
  )
}

function Slider({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string
  min: number
  max: number
  value: number
  onChange: (n: number) => void
}) {
  return (
    <label className="field">
      <span>
        {label} <em>{value}px</em>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
