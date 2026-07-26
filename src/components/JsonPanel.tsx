import { useState } from 'react'
import type { HistoryCommitOpts } from '../lib/history'
import { createPalette, parseHex } from '../lib/palette'
import { serializeSheetDocument } from '../lib/pngMeta'
import {
  DEFAULT_LAYOUT,
  type NamePosition,
  type Palette,
  type SheetLayout,
} from '../types'

interface JsonPanelProps {
  title: string
  layout: SheetLayout
  palettes: Palette[]
  onTitleChange: (title: string) => void
  onLayoutChange: (layout: SheetLayout) => void
  onPalettesChange: (
    palettes: Palette[] | ((prev: Palette[]) => Palette[]),
    opts?: HistoryCommitOpts,
  ) => void
}

const NAME_POSITIONS: NamePosition[] = ['above', 'below', 'left', 'right']

const LAYOUT_NUM: {
  key: keyof SheetLayout
  label: string
  min: number
  max: number
  nullable?: boolean
}[] = [
  { key: 'columns', label: 'columns', min: 1, max: 24, nullable: true },
  { key: 'colGap', label: 'colGap', min: 0, max: 120 },
  { key: 'rowGap', label: 'rowGap', min: 0, max: 160 },
  { key: 'bandWidth', label: 'bandWidth', min: 40, max: 480 },
  { key: 'bandHeight', label: 'bandHeight', min: 8, max: 80 },
  { key: 'nameGap', label: 'nameGap', min: 0, max: 48 },
  { key: 'titleSize', label: 'titleSize', min: 14, max: 64 },
  { key: 'titleGap', label: 'titleGap', min: 0, max: 80 },
  { key: 'titleHAdjust', label: 'titleHAdjust', min: -200, max: 200 },
  { key: 'titleVAdjust', label: 'titleVAdjust', min: -80, max: 120 },
  { key: 'padding', label: 'padding', min: 0, max: 120 },
]

export function JsonPanel({
  title,
  layout,
  palettes,
  onTitleChange,
  onLayoutChange,
  onPalettesChange,
}: JsonPanelProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  function patchLayout(next: Partial<SheetLayout>) {
    onLayoutChange({ ...layout, ...next })
  }

  function updatePalette(index: number, next: Palette) {
    const list = [...palettes]
    list[index] = next
    onPalettesChange(list)
  }

  function removePalette(index: number) {
    onPalettesChange(palettes.filter((_, i) => i !== index))
  }

  function movePalette(index: number, dir: -1 | 1) {
    const j = index + dir
    if (j < 0 || j >= palettes.length) return
    const list = [...palettes]
    const tmp = list[index]!
    list[index] = list[j]!
    list[j] = tmp
    onPalettesChange(list)
  }

  async function copyJson() {
    try {
      const doc = await serializeSheetDocument(palettes, layout, title)
      await navigator.clipboard.writeText(JSON.stringify(doc, null, 2))
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1600)
    } catch {
      setCopyState('failed')
      window.setTimeout(() => setCopyState('idle'), 2000)
    }
  }

  return (
    <div className="json-panel" aria-label="Sheet JSON">
      <button type="button" className="json-panel__copy" onClick={() => void copyJson()}>
        {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : 'Copy'}
      </button>

      <div className="json-block">
        <div className="json-block__brace">{'{'}</div>
        <div className="json-block__body">
          <JsonLockedRow keyName="app" value='"paletter"' />
          <JsonLockedRow keyName="version" value="1" />
          <JsonTextRow keyName="title" value={title} onChange={onTitleChange} />

          <details className="json-fold" open>
            <summary className="json-fold__sum">
              <span className="json-key">"layout"</span>
              <span className="json-punct">: {'{'}</span>
              <span className="json-fold__meta">sheet</span>
            </summary>
            <div className="json-fold__body">
              {LAYOUT_NUM.map(({ key, label, min, max, nullable }) => (
                <JsonNumberRow
                  key={key}
                  keyName={label}
                  value={layout[key] as number | null}
                  min={min}
                  max={max}
                  nullable={nullable}
                  onChange={(n) => patchLayout({ [key]: n } as Partial<SheetLayout>)}
                />
              ))}
              <JsonSelectRow
                keyName="namePosition"
                value={layout.namePosition}
                options={NAME_POSITIONS}
                onChange={(namePosition) => patchLayout({ namePosition })}
              />
              <JsonHexRow
                keyName="background"
                value={layout.background}
                onChange={(background) => patchLayout({ background })}
              />
              <JsonBoolRow
                keyName="showHexLabels"
                value={layout.showHexLabels !== false}
                onChange={(showHexLabels) => patchLayout({ showHexLabels })}
              />
              <div className="json-row json-row--close">
                <span className="json-punct">{'}'}</span>
                <span className="json-punct">,</span>
              </div>
            </div>
          </details>

          <div className="json-array-head">
            <span className="json-key">"palettes"</span>
            <span className="json-punct">: [</span>
            <span className="json-fold__meta">{palettes.length}</span>
            <button
              type="button"
              className="json-btn"
              onClick={() =>
                onPalettesChange([
                  ...palettes,
                  createPalette(`Palette ${palettes.length + 1}`),
                ])
              }
            >
              + palette
            </button>
          </div>

          {palettes.map((palette, i) => (
            <PaletteJsonBlock
              key={palette.id}
              palette={palette}
              index={i}
              isLast={i === palettes.length - 1}
              onChange={(next) => updatePalette(i, next)}
              onRemove={() => removePalette(i)}
              onMove={(dir) => movePalette(i, dir)}
              canMoveUp={i > 0}
              canMoveDown={i < palettes.length - 1}
            />
          ))}

          <div className="json-row json-row--close">
            <span className="json-punct">]</span>
          </div>
        </div>
        <div className="json-block__brace">{'}'}</div>
      </div>

      <button
        type="button"
        className="btn btn--ghost btn--small json-panel__reset"
        onClick={() => onLayoutChange({ ...DEFAULT_LAYOUT })}
      >
        Reset layout defaults
      </button>
    </div>
  )
}

function PaletteJsonBlock({
  palette,
  index,
  isLast,
  onChange,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  palette: Palette
  index: number
  isLast: boolean
  onChange: (p: Palette) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
  canMoveUp: boolean
  canMoveDown: boolean
}) {
  function setColor(ci: number, hex: string) {
    const colors = [...palette.colors]
    colors[ci] = hex
    const next: Palette = { ...palette, colors }
    if (next.sourcePicks?.[ci]) {
      next.sourcePicks = next.sourcePicks.map((pick, i) =>
        i === ci ? { ...pick, hex } : pick,
      )
    }
    onChange(next)
  }

  function addColor() {
    onChange({
      ...palette,
      colors: [...palette.colors, '#808080'],
    })
  }

  function removeColor(ci: number) {
    if (palette.colors.length <= 1) return
    onChange({
      ...palette,
      colors: palette.colors.filter((_, i) => i !== ci),
      sourcePicks: palette.sourcePicks?.filter((_, i) => i !== ci),
    })
  }

  function clearSource() {
    const { sourceImage: _img, sourcePicks: _picks, sourcePath: _path, ...rest } = palette
    onChange(rest)
  }

  return (
    <details className="json-fold json-fold--palette" open={index < 3}>
      <summary className="json-fold__sum">
        <span className="json-punct">{'{'}</span>
        <span className="json-fold__meta">{palette.name || `palette ${index + 1}`}</span>
        <span className="json-fold__swatches" aria-hidden>
          {palette.colors.slice(0, 6).map((hex, i) => (
            <span key={`${hex}-${i}`} style={{ background: hex }} />
          ))}
        </span>
      </summary>
      <div className="json-fold__body">
        <div className="json-row json-row--actions">
          <button
            type="button"
            className="json-btn"
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="json-btn"
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
          <button type="button" className="json-btn json-btn--danger" onClick={onRemove}>
            Remove
          </button>
        </div>

        <JsonLockedRow keyName="id" value={`"${palette.id}"`} />
        <JsonTextRow
          keyName="name"
          value={palette.name}
          onChange={(name) => onChange({ ...palette, name })}
        />

        <div className="json-array-head">
          <span className="json-key">"colors"</span>
          <span className="json-punct">: [</span>
          <button type="button" className="json-btn" onClick={addColor}>
            + color
          </button>
        </div>
        {palette.colors.map((hex, ci) => (
          <JsonHexRow
            key={`${palette.id}-c-${ci}`}
            keyName={String(ci)}
            value={hex}
            indexed
            onChange={(h) => setColor(ci, h)}
            onRemove={palette.colors.length > 1 ? () => removeColor(ci) : undefined}
          />
        ))}
        <div className="json-row json-row--close">
          <span className="json-punct">]</span>
          <span className="json-punct">,</span>
        </div>

        {palette.sourceImage || palette.sourcePath ? (
          <>
            {palette.sourcePath ? (
              <JsonLockedRow keyName="sourcePath" value={`"${palette.sourcePath}"`} />
            ) : null}
            {palette.sourceImage ? (
              <JsonLockedRow
                keyName="sourceImage"
                value={`${palette.sourceImage.width}×${palette.sourceImage.height} png`}
              />
            ) : null}
            <JsonLockedRow
              keyName="sourcePicks"
              value={String(palette.sourcePicks?.length ?? 0)}
            />
            <div className="json-row json-row--actions">
              <button type="button" className="json-btn" onClick={clearSource}>
                Clear source image
              </button>
            </div>
          </>
        ) : null}

        <div className="json-row json-row--close">
          <span className="json-punct">{'}'}</span>
          {!isLast && <span className="json-punct">,</span>}
        </div>
      </div>
    </details>
  )
}

function JsonLockedRow({ keyName, value }: { keyName: string; value: string }) {
  return (
    <div className="json-row">
      <span className="json-key">"{keyName}"</span>
      <span className="json-punct">:</span>
      <span className="json-locked">{value}</span>
      <span className="json-punct">,</span>
    </div>
  )
}

function JsonTextRow({
  keyName,
  value,
  onChange,
}: {
  keyName: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="json-row">
      <span className="json-key">"{keyName}"</span>
      <span className="json-punct">:</span>
      <span className="json-punct">"</span>
      <input
        className="json-input"
        value={value}
        aria-label={keyName}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="json-punct">"</span>
      <span className="json-punct">,</span>
    </label>
  )
}

function JsonNumberRow({
  keyName,
  value,
  min,
  max,
  nullable,
  onChange,
}: {
  keyName: string
  value: number | null
  min: number
  max: number
  nullable?: boolean
  onChange: (n: number | null) => void
}) {
  const isNull = value === null || value === undefined
  return (
    <label className="json-row">
      <span className="json-key">"{keyName}"</span>
      <span className="json-punct">:</span>
      {nullable ? (
        <select
          className="json-input json-input--select"
          value={isNull ? 'null' : 'num'}
          aria-label={`${keyName} mode`}
          onChange={(e) => {
            if (e.target.value === 'null') onChange(null)
            else onChange(typeof value === 'number' ? value : min)
          }}
        >
          <option value="null">null</option>
          <option value="num">number</option>
        </select>
      ) : null}
      {!isNull && (
        <input
          className="json-input json-input--num"
          type="number"
          min={min}
          max={max}
          value={value ?? min}
          aria-label={keyName}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n)) return
            onChange(Math.min(max, Math.max(min, Math.round(n))))
          }}
        />
      )}
      {isNull && <span className="json-locked">null</span>}
      <span className="json-punct">,</span>
    </label>
  )
}

function JsonSelectRow({
  keyName,
  value,
  options,
  onChange,
}: {
  keyName: string
  value: string
  options: string[]
  onChange: (v: NamePosition) => void
}) {
  return (
    <label className="json-row">
      <span className="json-key">"{keyName}"</span>
      <span className="json-punct">:</span>
      <span className="json-punct">"</span>
      <select
        className="json-input json-input--select"
        value={value}
        aria-label={keyName}
        onChange={(e) => onChange(e.target.value as NamePosition)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <span className="json-punct">"</span>
      <span className="json-punct">,</span>
    </label>
  )
}

function JsonBoolRow({
  keyName,
  value,
  onChange,
}: {
  keyName: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="json-row">
      <span className="json-key">"{keyName}"</span>
      <span className="json-punct">:</span>
      <select
        className="json-input json-input--select"
        value={value ? 'true' : 'false'}
        aria-label={keyName}
        onChange={(e) => onChange(e.target.value === 'true')}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
      <span className="json-punct">,</span>
    </label>
  )
}

function JsonHexRow({
  keyName,
  value,
  onChange,
  onRemove,
  indexed,
}: {
  keyName: string
  value: string
  onChange: (hex: string) => void
  onRemove?: () => void
  indexed?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  const shown = focused ? draft : value
  const ok = parseHex(shown)

  return (
    <div className={`json-row ${ok ? '' : 'json-row--bad'}`}>
      {indexed ? (
        <span className="json-index">{keyName}</span>
      ) : (
        <span className="json-key">"{keyName}"</span>
      )}
      {!indexed && <span className="json-punct">:</span>}
      <span
        className="json-swatch"
        style={{ background: ok ?? '#000' }}
        aria-hidden
      />
      <span className="json-punct">"</span>
      <input
        className="json-input json-input--hex"
        value={shown}
        aria-label={indexed ? `color ${keyName}` : keyName}
        spellCheck={false}
        onFocus={() => {
          setDraft(value)
          setFocused(true)
        }}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          const parsed = parseHex(raw)
          if (parsed) onChange(parsed.toLowerCase())
        }}
        onBlur={() => {
          setFocused(false)
          const parsed = parseHex(draft)
          if (parsed) onChange(parsed.toLowerCase())
          else setDraft(value)
        }}
      />
      <span className="json-punct">"</span>
      <span className="json-punct">,</span>
      {onRemove && (
        <button type="button" className="json-btn json-btn--icon" onClick={onRemove} aria-label="Remove color">
          ×
        </button>
      )}
    </div>
  )
}
