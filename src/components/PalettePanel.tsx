import { useEffect } from 'react'
import type { ClusterReduce } from '../lib/imagePalette'
import type { ColorSortKey } from '../lib/palette'
import type { Palette } from '../types'
import { ColorMixTool } from './ColorMixTool'

interface PalettePanelProps {
  palette: Palette
  allPalettes: Palette[]
  /** Original color count (before live simplify preview). */
  sourceColorCount: number
  previewColorCount: number
  canDelete: boolean
  sortState: { key: ColorSortKey; dir: 1 | -1 } | undefined
  simplifyK: number
  simplifyReduce: ClusterReduce
  simplifyLive: boolean
  onSort: (key: ColorSortKey) => void
  onSimplifyK: (k: number) => void
  onSimplifyReduce: (m: ClusterReduce) => void
  onApplySimplify: () => void
  onResetSimplify: () => void
  onAddMixedColor: (hex: string) => void
  onDelete: () => void
  onClose: () => void
}

export function PalettePanel({
  palette,
  allPalettes,
  sourceColorCount,
  previewColorCount,
  canDelete,
  sortState,
  simplifyK,
  simplifyReduce,
  simplifyLive,
  onSort,
  onSimplifyK,
  onSimplifyReduce,
  onApplySimplify,
  onResetSimplify,
  onAddMixedColor,
  onDelete,
  onClose,
}: PalettePanelProps) {
  const simplifyMax = Math.max(1, sourceColorCount - 1)
  const k = Math.min(simplifyK, simplifyMax)

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

  return (
    <aside className="palette-panel" aria-label="Palette tools">
      <header className="palette-panel__head">
        <div>
          <p className="palette-panel__eyebrow">Palette</p>
          <h2 className="palette-panel__title">{palette.name}</h2>
          <p className="palette-panel__meta">
            {simplifyLive
              ? `${sourceColorCount} → ${previewColorCount} colors`
              : `${sourceColorCount} colors`}
          </p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      <div className="palette-panel__stripes" aria-hidden>
        {palette.colors.map((hex, i) => (
          <div key={`${hex}-${i}`} className="palette-panel__stripe" style={{ background: hex }} />
        ))}
      </div>

      <section className="palette-panel__section">
        <h3>Sort</h3>
        <div className="palette-panel__chips" role="group" aria-label="Sort colors">
          {(
            [
              ['hue', 'Hue'],
              ['saturation', 'Sat'],
              ['brightness', 'Bright'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`chip ${sortState?.key === key ? 'chip--on' : ''}`}
              disabled={sourceColorCount < 2}
              onClick={() => onSort(key)}
            >
              {label}
              {sortState?.key === key ? (sortState.dir === 1 ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
        </div>
      </section>

      <ColorMixTool
        palette={palette}
        allPalettes={allPalettes}
        onAddColor={onAddMixedColor}
      />

      <section className="palette-panel__section">
        <h3>Simplify</h3>
        <p className="palette-panel__help">
          OKLab k-means compression. Preview updates on the sheet as you adjust.
        </p>
        <label className="palette-panel__field">
          <span>
            Colors <em>{k}</em>
            <span className="palette-panel__of">/ {sourceColorCount}</span>
          </span>
          <input
            type="range"
            min={1}
            max={simplifyMax}
            value={k}
            disabled={sourceColorCount < 2}
            onChange={(e) => onSimplifyK(Number(e.target.value))}
          />
        </label>
        <div className="palette-panel__chips" role="group" aria-label="Cluster color">
          {(['mean', 'median', 'mode'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`chip ${simplifyReduce === m ? 'chip--on' : ''}`}
              disabled={sourceColorCount < 2}
              onClick={() => onSimplifyReduce(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="palette-panel__actions">
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={!simplifyLive}
            onClick={onResetSimplify}
          >
            Reset
          </button>
          <button
            type="button"
            className="btn btn--primary btn--small"
            disabled={!simplifyLive || sourceColorCount < 2}
            onClick={onApplySimplify}
          >
            Apply
          </button>
        </div>
      </section>

      <button
        type="button"
        className="btn btn--ghost palette-panel__delete"
        disabled={!canDelete}
        onClick={onDelete}
      >
        Delete palette
      </button>
    </aside>
  )
}
