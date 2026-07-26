import { useEffect, useRef, useState } from 'react'
import type { ClusterReduce } from '../lib/imagePalette'
import { PALETTER_COLOR_MIME, parseHex } from '../lib/palette'
import type { ColorSortKey } from '../lib/palette'
import { contrastInk } from '../lib/render'
import type { Palette } from '../types'
import { ColorPicker } from './ColorPicker'

interface PalettePanelProps {
  palette: Palette
  sourceColorCount: number
  previewColorCount: number
  sortState: { key: ColorSortKey; dir: 1 | -1 } | undefined
  simplifyK: number
  simplifyReduce: ClusterReduce
  simplifyLive: boolean
  embedded?: boolean
  onSort: (key: ColorSortKey) => void
  onSimplifyK: (k: number) => void
  onSimplifyReduce: (m: ClusterReduce) => void
  onApplySimplify: () => void
  onResetSimplify: () => void
  onAddMixedColor: (hex: string) => void
  onRemoveColor?: (index: number) => void
  onEditColor?: (index: number) => void
  onReorderColors?: (from: number, to: number) => void
  onRename?: (name: string) => void
  onOpenSourceImage?: () => void
  onClose: () => void
}

export function PalettePanel({
  palette,
  sourceColorCount,
  previewColorCount,
  sortState,
  simplifyK,
  simplifyReduce,
  simplifyLive,
  embedded = false,
  onSort,
  onSimplifyK,
  onSimplifyReduce,
  onApplySimplify,
  onResetSimplify,
  onAddMixedColor,
  onRemoveColor,
  onEditColor,
  onReorderColors,
  onRename,
  onOpenSourceImage,
  onClose,
}: PalettePanelProps) {
  const simplifyMax = Math.max(1, sourceColorCount - 1)
  const k = Math.min(simplifyK, simplifyMax)
  const [draft, setDraft] = useState('#888888')
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOrder, setDragOrder] = useState<number[] | null>(null)
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null)
  const [dragSize, setDragSize] = useState<{ w: number; h: number } | null>(null)
  const dragMoved = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const sortKey = sortState?.key ?? 'hue'
  const sortDir = sortState?.dir ?? 1
  const hasSourceImage = Boolean(palette.sourceImage)

  function clearDrag() {
    setDragFrom(null)
    setDragOrder(null)
    setDragPointer(null)
    setDragSize(null)
  }

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
    <aside
      className={`palette-panel ${embedded ? 'palette-panel--embedded' : ''}`}
      aria-label="Palette tools"
    >
      {embedded ? (
        <div className="palette-panel__hud">
          <div className="palette-panel__name-row">
            <button
              type="button"
              className="palette-panel__back"
              onClick={onClose}
              aria-label="Back to palettes"
            >
              ←
            </button>
            <input
              className="palette-panel__name"
              value={palette.name}
              onChange={(e) => onRename?.(e.target.value)}
              aria-label="Palette name"
            />
          </div>
          <div className="palette-panel__hud-top">
            {hasSourceImage && (
              <button
                type="button"
                className="palette-panel__image"
                onClick={onOpenSourceImage}
                aria-label="Edit from source image"
                title="Edit from source image"
              >
                <svg
                  className="palette-panel__image-icon"
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  aria-hidden
                >
                  <path
                    fill="currentColor"
                    d="M2.5 2.5h11A1.5 1.5 0 0 1 15 4v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12V4a1.5 1.5 0 0 1 1.5-1.5Zm0 1a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V4a.5.5 0 0 0-.5-.5h-11Zm8.1 2.1a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3ZM3.2 11.2l2.7-3.1a.6.6 0 0 1 .9 0l1.55 1.8 1.35-1.55a.6.6 0 0 1 .9.05l2.2 2.8H3.2Z"
                  />
                </svg>
              </button>
            )}
            <div className="palette-panel__sort" role="group" aria-label="Sort colors">
              <div className="side-panel__select palette-panel__sort-select-wrap">
                <select
                  className="palette-panel__sort-select"
                  value={sortKey}
                  disabled={sourceColorCount < 2}
                  aria-label="Sort by"
                  onChange={(e) => onSort(e.target.value as ColorSortKey)}
                >
                  <option value="hue">Hue</option>
                  <option value="saturation">Sat</option>
                  <option value="brightness">Bright</option>
                </select>
              </div>
              <button
                type="button"
                className="palette-panel__sort-dir"
                disabled={sourceColorCount < 2}
                aria-label={sortDir === -1 ? 'Ascending' : 'Descending'}
                title="Reverse sort"
                onClick={() => onSort(sortKey)}
              >
                {sortDir === -1 ? '↓' : '↑'}
              </button>
            </div>
          </div>
        </div>
      ) : (
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
      )}

      {!embedded && (
        <div className="palette-panel__stripes" aria-hidden>
          {palette.colors.map((hex, i) => (
            <div key={`${hex}-${i}`} className="palette-panel__stripe" style={{ background: hex }} />
          ))}
        </div>
      )}

      {embedded ? (
        <div
          className={`palette-panel__swatches${dragFrom !== null ? ' palette-panel__swatches--dragging' : ''}`}
          role="list"
          aria-label="Palette colors"
        >
          {(dragOrder ?? palette.colors.map((_, src) => src)).map((src, displayIndex) => {
            const hex = palette.colors[src]
            const isDragged = dragFrom === src
            return (
              <div
                key={src}
                className={`palette-panel__swatch-row${
                  isDragged && dragMoved.current ? ' palette-panel__swatch-row--slot' : ''
                }`}
                role="listitem"
                draggable
                onDragStart={(e) => {
                  dragMoved.current = false
                  const rect = e.currentTarget.getBoundingClientRect()
                  dragOffset.current = {
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                  }
                  setDragSize({ w: rect.width, h: rect.height })
                  setDragFrom(src)
                  setDragOrder(palette.colors.map((_, i) => i))
                  setDragPointer({ x: e.clientX, y: e.clientY })
                  e.dataTransfer.effectAllowed = onReorderColors ? 'copyMove' : 'copy'
                  e.dataTransfer.setData(PALETTER_COLOR_MIME, hex)
                  e.dataTransfer.setData('text/plain', hex)
                  const blank = document.createElement('canvas')
                  blank.width = 1
                  blank.height = 1
                  e.dataTransfer.setDragImage(blank, 0, 0)
                }}
                onDrag={(e) => {
                  if (e.clientX === 0 && e.clientY === 0) return
                  dragMoved.current = true
                  setDragPointer({ x: e.clientX, y: e.clientY })
                }}
                onDragEnd={() => clearDrag()}
                onDragOver={(e) => {
                  if (dragFrom === null || !onReorderColors || !dragOrder) return
                  if (palette.colors.length < 2) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  const fromPos = dragOrder.indexOf(dragFrom)
                  if (fromPos < 0 || fromPos === displayIndex) return
                  dragMoved.current = true
                  setDragOrder((prev) => {
                    if (!prev) return prev
                    const at = prev.indexOf(dragFrom)
                    if (at < 0 || at === displayIndex) return prev
                    const next = [...prev]
                    const [moved] = next.splice(at, 1)
                    next.splice(displayIndex, 0, moved)
                    return next
                  })
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragFrom === null || !onReorderColors || !dragOrder) {
                    clearDrag()
                    return
                  }
                  const to = dragOrder.indexOf(dragFrom)
                  if (to >= 0 && to !== dragFrom) onReorderColors(dragFrom, to)
                  clearDrag()
                }}
              >
                {isDragged && dragMoved.current ? (
                  <div className="palette-panel__insert-ghost" aria-hidden>
                    <span className="palette-panel__remove palette-panel__remove--ghost">
                      ×
                    </span>
                    <div
                      className="palette-panel__swatch palette-panel__swatch--ghost"
                      style={{ background: hex, color: contrastInk(hex) }}
                    >
                      {hex}
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="palette-panel__remove"
                      disabled={palette.colors.length <= 1}
                      draggable={false}
                      onClick={() => onRemoveColor?.(src)}
                      aria-label={`Remove ${hex}`}
                    >
                      ×
                    </button>
                    <div
                      className="palette-panel__swatch"
                      style={{ background: hex, color: contrastInk(hex) }}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (dragMoved.current) {
                          dragMoved.current = false
                          return
                        }
                        onEditColor?.(src)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onEditColor?.(src)
                        }
                      }}
                    >
                      {hex}
                    </div>
                  </>
                )}
              </div>
            )
          })}

          {dragFrom !== null && dragPointer && dragSize && dragMoved.current && (
            <div
              className="palette-panel__follow-ghost"
              style={{
                left: dragPointer.x - dragOffset.current.x,
                top: dragPointer.y - dragOffset.current.y,
                width: dragSize.w,
                height: dragSize.h,
              }}
              aria-hidden
            >
              <span className="palette-panel__remove palette-panel__remove--ghost">×</span>
              <div
                className="palette-panel__swatch"
                style={{
                  background: palette.colors[dragFrom],
                  color: contrastInk(palette.colors[dragFrom]),
                }}
              >
                {palette.colors[dragFrom]}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {embedded ? (
        <details className="side-panel__fold palette-panel__add-fold">
          <summary className="side-panel__fold-sum">
            <span>Add color</span>
            <span className="side-panel__fold-caret" aria-hidden />
          </summary>
          <div className="side-panel__fold-body palette-panel__add">
            <p className="palette-panel__help">
              Pick any color and append it to this palette
              {hasSourceImage ? ' (works alongside image picks).' : '.'}
            </p>
            <ColorPicker value={draft} onChange={setDraft} />
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => onAddMixedColor(parseHex(draft) ?? draft)}
            >
              Add to palette
            </button>
          </div>
        </details>
      ) : (
        <>
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

          <section className="palette-panel__section">
            <h3>Add color</h3>
            <p className="palette-panel__help">Pick a color, then add it to this palette.</p>
            <ColorPicker value={draft} onChange={setDraft} />
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => onAddMixedColor(parseHex(draft) ?? draft)}
            >
              Add to palette
            </button>
          </section>
        </>
      )}

      {embedded ? (
        <details className="side-panel__fold">
          <summary className="side-panel__fold-sum">
            <span>Simplify</span>
            <span className="side-panel__fold-caret" aria-hidden />
          </summary>
          <div className="side-panel__fold-body palette-panel__simplify">
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
            <div
              className="palette-panel__simplify-methods"
              role="group"
              aria-label="Cluster color"
            >
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
            <div className="palette-panel__simplify-actions">
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
          </div>
        </details>
      ) : (
        <section className="palette-panel__section palette-panel__simplify">
          <h3>Simplify</h3>
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
          <div
            className="palette-panel__simplify-methods"
            role="group"
            aria-label="Cluster color"
          >
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
          <div className="palette-panel__simplify-actions">
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
      )}
    </aside>
  )
}
