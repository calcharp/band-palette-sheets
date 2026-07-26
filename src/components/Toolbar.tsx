import { useEffect, useRef, useState } from 'react'
import { parseHex } from '../lib/palette'
import type { LibraryEntry } from '../lib/library'
import type { NamePosition, Palette, SheetLayout } from '../types'
import { JsonPanel } from './JsonPanel'
import { LibraryPanel } from './LibraryPanel'

interface ToolbarProps {
  title: string
  layout: SheetLayout
  palettes: Palette[]
  selectedId: string | null
  onSelectPalette: (id: string | null) => void
  onTitleChange: (title: string) => void
  onLayoutChange: (layout: SheetLayout) => void
  onPalettesChange: (palettes: Palette[]) => void
  onAddPalette: () => void
  onFromImage: () => void
  onImportSheet: () => void
  onSave: () => void
  saveBusy?: boolean
  onEditSlot: (el: HTMLDivElement | null) => void
  /** Ask Layout tab to open with the sheet-title fold expanded. */
  layoutFocus?: 'sheet-title' | null
  onLayoutFocusHandled?: () => void
  onAddToLibrary: (folderId: string | null) => Promise<{
    name: string
    fileName: string
    handle: FileSystemFileHandle | null
  } | null>
  onOpenLibraryEntry: (entry: LibraryEntry) => void
}

type SideTab = 'add' | 'edit' | 'layout' | 'json' | 'library'

function FloppyIcon() {
  return (
    <svg
      className="side-panel__save-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M4 2h12l4 4v16H4V2zm2 2v5h9V4H6zm0 14h12v-7H6v7zm2-5h2v3H8v-3zm4 0h4v2h-4v-2z"
      />
    </svg>
  )
}

export function Toolbar({
  title,
  layout,
  palettes,
  selectedId,
  onSelectPalette,
  onTitleChange,
  onLayoutChange,
  onPalettesChange,
  onAddPalette,
  onFromImage,
  onImportSheet,
  onSave,
  saveBusy = false,
  onEditSlot,
  layoutFocus = null,
  onLayoutFocusHandled,
  onAddToLibrary,
  onOpenLibraryEntry,
}: ToolbarProps) {
  const [tab, setTab] = useState<SideTab>('add')
  const [sheetTitleOpen, setSheetTitleOpen] = useState(true)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (selectedId) setTab('edit')
  }, [selectedId])

  useEffect(() => {
    if (tab !== 'edit' || !selectedId) onEditSlot(null)
  }, [tab, selectedId, onEditSlot])

  useEffect(() => {
    if (layoutFocus !== 'sheet-title') return
    setTab('layout')
    setSheetTitleOpen(true)
    const id = window.requestAnimationFrame(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
      onLayoutFocusHandled?.()
    })
    return () => window.cancelAnimationFrame(id)
  }, [layoutFocus, onLayoutFocusHandled])

  function patch(next: Partial<SheetLayout>) {
    onLayoutChange({ ...layout, ...next })
  }

  return (
    <>
      <header className="toolbar">
        <div className="toolbar__brand">
          <p className="toolbar__mark">Paletter</p>
        </div>
      </header>

      <aside className="side-panel" aria-label="Tools">
        <div className="side-panel__tabs-row">
          <div className="side-panel__tabs" role="tablist">
            {(
              [
                ['add', 'Add'],
                ['edit', 'Edit'],
                ['layout', 'Layout'],
                ['json', 'JSON'],
                ['library', 'Library'],
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
          <button
            type="button"
            className="side-panel__save"
            onClick={onSave}
            disabled={saveBusy}
            aria-label="Save PNG"
            title="Save PNG (Ctrl+S)"
          >
            <FloppyIcon />
          </button>
        </div>

        <div
          className={`side-panel__body ${
            tab === 'edit' && selectedId ? 'side-panel__body--edit-detail' : ''
          } ${tab === 'library' ? 'side-panel__body--library' : ''}`}
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
                      <div className="side-panel__palette">
                        <button
                          type="button"
                          className="side-panel__palette-main"
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
                        <button
                          type="button"
                          className="side-panel__palette-remove"
                          aria-label={`Delete ${palette.name}`}
                          title="Delete palette"
                          onClick={() =>
                            onPalettesChange(palettes.filter((p) => p.id !== palette.id))
                          }
                        >
                          ×
                        </button>
                      </div>
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

          {tab === 'json' && (
            <JsonPanel
              title={title}
              layout={layout}
              palettes={palettes}
              onTitleChange={onTitleChange}
              onLayoutChange={onLayoutChange}
              onPalettesChange={onPalettesChange}
            />
          )}

          {tab === 'library' && (
            <LibraryPanel
              active={tab === 'library'}
              onAddCurrent={onAddToLibrary}
              onOpenEntry={onOpenLibraryEntry}
              addBusy={saveBusy}
            />
          )}

          {tab === 'layout' && (
            <>
              <details
                className="side-panel__fold"
                open={sheetTitleOpen}
                onToggle={(e) => setSheetTitleOpen(e.currentTarget.open)}
              >
                <summary className="side-panel__fold-sum">
                  <span>Sheet title</span>
                  <span className="side-panel__fold-caret" aria-hidden />
                </summary>
                <div className="side-panel__fold-body">
                  <label className="field">
                    <span>Title</span>
                    <input
                      ref={titleInputRef}
                      className="swatch__hex"
                      value={title}
                      placeholder="<title>"
                      onChange={(e) => onTitleChange(e.target.value)}
                      aria-label="Sheet title"
                    />
                  </label>
                  <Slider
                    label="Title size"
                    min={14}
                    max={64}
                    value={layout.titleSize}
                    onChange={(titleSize) => patch({ titleSize })}
                  />
                  <Slider
                    label="Title gap"
                    min={0}
                    max={80}
                    value={layout.titleGap}
                    onChange={(titleGap) => patch({ titleGap })}
                  />
                  <Slider
                    label="H adjust"
                    min={-200}
                    max={200}
                    value={layout.titleHAdjust}
                    onChange={(titleHAdjust) => patch({ titleHAdjust })}
                  />
                  <Slider
                    label="V adjust"
                    min={-80}
                    max={120}
                    value={layout.titleVAdjust}
                    onChange={(titleVAdjust) => patch({ titleVAdjust })}
                  />
                </div>
              </details>

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
