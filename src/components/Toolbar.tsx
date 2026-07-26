import { useEffect, useState } from 'react'
import { parseHex } from '../lib/palette'
import type { NamePosition, Palette, SheetLayout } from '../types'

interface ToolbarProps {
  layout: SheetLayout
  palettes: Palette[]
  selectedId: string | null
  onSelectPalette: (id: string | null) => void
  onLayoutChange: (layout: SheetLayout) => void
  onAddPalette: () => void
  onFromImage: () => void
  onImportSheet: () => void
  onExport: () => void
  onEditSlot: (el: HTMLDivElement | null) => void
}

type SideTab = 'add' | 'edit' | 'layout'

export function Toolbar({
  layout,
  palettes,
  selectedId,
  onSelectPalette,
  onLayoutChange,
  onAddPalette,
  onFromImage,
  onImportSheet,
  onExport,
  onEditSlot,
}: ToolbarProps) {
  const [tab, setTab] = useState<SideTab>('add')

  useEffect(() => {
    if (selectedId) setTab('edit')
  }, [selectedId])

  useEffect(() => {
    if (tab !== 'edit' || !selectedId) onEditSlot(null)
  }, [tab, selectedId, onEditSlot])

  function patch(next: Partial<SheetLayout>) {
    onLayoutChange({ ...layout, ...next })
  }

  return (
    <>
      <header className="toolbar">
        <div className="toolbar__brand">
          <p className="toolbar__mark">Paletter</p>
        </div>
        <div className="toolbar__actions">
          <button type="button" className="btn btn--primary btn--small" onClick={onExport}>
            Export PNG
          </button>
        </div>
      </header>

      <aside className="side-panel" aria-label="Tools">
        <div className="side-panel__tabs" role="tablist">
          {(
            [
              ['add', 'Add'],
              ['edit', 'Edit'],
              ['layout', 'Layout'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`side-panel__tab ${tab === id ? 'side-panel__tab--on' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div
          className={`side-panel__body ${
            tab === 'edit' && selectedId ? 'side-panel__body--edit-detail' : ''
          }`}
          role="tabpanel"
        >
          {tab === 'add' && (
            <div className="side-panel__actions">
              <button type="button" className="side-panel__action" onClick={onAddPalette}>
                + Palette
              </button>
              <button type="button" className="side-panel__action" onClick={onFromImage}>
                From image
              </button>
              <button type="button" className="side-panel__action" onClick={onImportSheet}>
                Import sheet
              </button>
            </div>
          )}

          {tab === 'edit' && !selectedId && (
            <div className="side-panel__edit">
              {palettes.length ? (
                <ul className="side-panel__palette-list">
                  {palettes.map((palette) => (
                    <li key={palette.id}>
                      <button
                        type="button"
                        className="side-panel__palette"
                        onClick={() => onSelectPalette(palette.id)}
                      >
                        <span className="side-panel__palette-swatch" aria-hidden>
                          {palette.colors.map((hex, i) => (
                            <span
                              key={`${hex}-${i}`}
                              className="side-panel__palette-chip"
                              style={{ background: hex }}
                            />
                          ))}
                        </span>
                        <span className="side-panel__palette-name">{palette.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="side-panel__empty">No palettes yet</p>
              )}
            </div>
          )}

          {tab === 'edit' && selectedId ? (
            <div className="side-panel__edit-slot" ref={onEditSlot} />
          ) : null}

          {tab === 'layout' && (
            <>
              <label className="field">
                <span>Columns</span>
                <div className="side-panel__select">
                  <select
                    value={layout.columns ?? 'auto'}
                    onChange={(e) =>
                      patch({
                        columns: e.target.value === 'auto' ? null : Number(e.target.value),
                      })
                    }
                  >
                    <option value="auto">Auto</option>
                    {Array.from({ length: Math.max(12, palettes.length) }, (_, i) => i + 1).map(
                      (n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              </label>

              <details className="side-panel__fold">
                <summary className="side-panel__fold-sum">
                  <span>Bands & gaps</span>
                  <span className="side-panel__fold-caret" aria-hidden />
                </summary>
                <div className="side-panel__fold-body">
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
                </div>
              </details>
              <details className="side-panel__fold">
                <summary className="side-panel__fold-sum">
                  <span>Name & padding</span>
                  <span className="side-panel__fold-caret" aria-hidden />
                </summary>
                <div className="side-panel__fold-body">
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
                </div>
              </details>
              <label className="field field--check">
                <span>Hex labels on bands</span>
                <input
                  type="checkbox"
                  checked={layout.showHexLabels !== false}
                  onChange={(e) => patch({ showHexLabels: e.target.checked })}
                />
              </label>

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
            </>
          )}
        </div>
      </aside>
    </>
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
