import { useEffect, useRef, useState } from 'react'
import { normalizeHex, parseHex, sortColors, type ColorSortKey } from '../lib/palette'
import {
  cellAtPoint,
  computeSheetHits,
  hitTest,
  movePalette,
  renderSheet,
  type PaletteHit,
  type Rect,
} from '../lib/render'
import type { Palette, SheetLayout } from '../types'

interface SheetPreviewProps {
  palettes: Palette[]
  layout: SheetLayout
  onPalettesChange: (palettes: Palette[]) => void
}

type NameEdit = {
  kind: 'name'
  paletteId: string
  value: string
  box: Rect
}

type ColorEdit = {
  kind: 'color'
  paletteId: string
  colorIndex: number
  value: string
  box: Rect
}

type ActiveEdit = NameEdit | ColorEdit

type DragState = {
  paletteId: string
  fromIndex: number
  overId: string | null
  pointerX: number
  pointerY: number
  offsetX: number
  offsetY: number
}

const DRAG_THRESHOLD = 6

export function SheetPreview({ palettes, layout, onPalettesChange }: SheetPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editRef = useRef<ActiveEdit | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const pendingDrag = useRef<{
    paletteId: string
    index: number
    startX: number
    startY: number
    offsetX: number
    offsetY: number
  } | null>(null)

  const [edit, setEdit] = useState<ActiveEdit | null>(null)
  const [displayScale, setDisplayScale] = useState(1)
  const [hits, setHits] = useState<PaletteHit[]>([])
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [sortState, setSortState] = useState<
    Record<string, { key: ColorSortKey; dir: 1 | -1 }>
  >({})

  editRef.current = edit
  dragRef.current = drag

  useEffect(() => {
    const host = canvasRef.current
    if (!host) return
    const info = computeSheetHits(palettes, layout)
    setHits(info.hits)

    const sheet = renderSheet(palettes, layout, 1)
    host.width = sheet.width
    host.height = sheet.height
    const ctx = host.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, host.width, host.height)
    ctx.drawImage(sheet, 0, 0)

    // Dim source + highlight drop target while dragging
    const d = dragRef.current
    if (d) {
      const source = info.hits.find((h) => h.paletteId === d.paletteId)
      if (source) {
        ctx.fillStyle = layout.background
        ctx.fillRect(source.cell.x, source.cell.y, source.cell.w, source.cell.h)
        ctx.strokeStyle = 'rgba(15, 118, 110, 0.35)'
        ctx.lineWidth = 1.5
        ctx.setLineDash([5, 4])
        ctx.strokeRect(source.cell.x + 1, source.cell.y + 1, source.cell.w - 2, source.cell.h - 2)
        ctx.setLineDash([])
      }
      if (d.overId && d.overId !== d.paletteId) {
        const over = info.hits.find((h) => h.paletteId === d.overId)
        if (over) {
          ctx.fillStyle = 'rgba(247, 243, 235, 0.45)'
          ctx.fillRect(over.cell.x, over.cell.y, over.cell.w, over.cell.h)
          ctx.strokeStyle = '#0f766e'
          ctx.lineWidth = 2
          ctx.setLineDash([6, 4])
          ctx.strokeRect(over.cell.x + 1, over.cell.y + 1, over.cell.w - 2, over.cell.h - 2)
          ctx.setLineDash([])
        }
      }
    }

    updateScale()
  }, [palettes, layout, drag?.overId, drag?.paletteId])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const ro = new ResizeObserver(() => updateScale())
    ro.observe(frame)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (edit) inputRef.current?.select()
  }, [
    edit?.kind,
    edit && 'paletteId' in edit ? edit.paletteId : null,
    edit && edit.kind === 'color' ? edit.colorIndex : null,
  ])

  useEffect(() => {
    if (!edit) return
    function onPointerDown(e: PointerEvent) {
      const node = editorRef.current
      if (node && !node.contains(e.target as Node)) commitEdit()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setEdit(null)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        commitEdit()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [edit, palettes])

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const pending = pendingDrag.current
      if (pending && !dragRef.current) {
        const dx = e.clientX - pending.startX
        const dy = e.clientY - pending.startY
        if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
          const next: DragState = {
            paletteId: pending.paletteId,
            fromIndex: pending.index,
            overId: pending.paletteId,
            pointerX: e.clientX,
            pointerY: e.clientY,
            offsetX: pending.offsetX,
            offsetY: pending.offsetY,
          }
          pendingDrag.current = null
          setDrag(next)
          setHoverId(null)
          setEdit(null)
        }
        return
      }

      const d = dragRef.current
      if (!d) return
      const pt = clientToSheet(e.clientX, e.clientY)
      const over = pt ? cellAtPoint(pt.x, pt.y, palettes, layout) : null
      setDrag({
        ...d,
        pointerX: e.clientX,
        pointerY: e.clientY,
        overId: over?.paletteId ?? d.overId,
      })
    }

    function onUp() {
      const d = dragRef.current
      pendingDrag.current = null
      if (d) {
        if (d.overId && d.overId !== d.paletteId) {
          onPalettesChange(movePalette(palettes, d.paletteId, d.overId))
        }
        setDrag(null)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [palettes, layout, onPalettesChange])

  function updateScale() {
    const host = canvasRef.current
    if (!host || !host.width) return
    const rect = host.getBoundingClientRect()
    setDisplayScale(rect.width / host.width)
  }

  function clientToSheet(clientX: number, clientY: number): { x: number; y: number } | null {
    const host = canvasRef.current
    if (!host) return null
    const rect = host.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    return {
      x: ((clientX - rect.left) / rect.width) * host.width,
      y: ((clientY - rect.top) / rect.height) * host.height,
    }
  }

  function sheetPoint(e: React.MouseEvent | React.PointerEvent): { x: number; y: number } | null {
    return clientToSheet(e.clientX, e.clientY)
  }

  function commitEdit() {
    const next = editRef.current
    if (!next) return
    if (next.kind === 'name') {
      onPalettesChange(
        palettes.map((p) => (p.id === next.paletteId ? { ...p, name: next.value } : p)),
      )
    } else {
      const hex = parseHex(next.value) ?? normalizeHex(next.value)
      onPalettesChange(
        palettes.map((p) => {
          if (p.id !== next.paletteId) return p
          const colors = [...p.colors]
          if (next.colorIndex >= colors.length) return p
          colors[next.colorIndex] = hex
          return { ...p, colors }
        }),
      )
    }
    setEdit(null)
  }

  function insertColor(where: 'above' | 'below') {
    const current = editRef.current
    if (!current || current.kind !== 'color') return
    // Save current color edit first so we don't lose in-progress hex
    const hex = parseHex(current.value) ?? normalizeHex(current.value)
    const insertAt = where === 'above' ? current.colorIndex : current.colorIndex + 1
    const nextPalettes = palettes.map((p) => {
      if (p.id !== current.paletteId) return p
      const colors = [...p.colors]
      if (current.colorIndex < colors.length) colors[current.colorIndex] = hex
      colors.splice(insertAt, 0, '#000000')
      return { ...p, colors }
    })
    onPalettesChange(nextPalettes)
    setEdit({
      kind: 'color',
      paletteId: current.paletteId,
      colorIndex: insertAt,
      value: '#000000',
      box: {
        ...current.box,
        y:
          where === 'above'
            ? current.box.y - layout.bandHeight
            : current.box.y + layout.bandHeight,
      },
    })
  }

  function deleteColor() {
    const current = editRef.current
    if (!current || current.kind !== 'color') return
    const pal = palettes.find((p) => p.id === current.paletteId)
    if (!pal || pal.colors.length <= 1) return
    onPalettesChange(
      palettes.map((p) => {
        if (p.id !== current.paletteId) return p
        return { ...p, colors: p.colors.filter((_, i) => i !== current.colorIndex) }
      }),
    )
    setEdit(null)
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0 || edit) return
    const pt = sheetPoint(e)
    if (!pt) return
    const cell = cellAtPoint(pt.x, pt.y, palettes, layout)
    if (!cell) return
    pendingDrag.current = {
      paletteId: cell.paletteId,
      index: cell.paletteIndex,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: (pt.x - cell.cell.x) * displayScale,
      offsetY: (pt.y - cell.cell.y) * displayScale,
    }
  }

  function onPointerMoveHover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (drag || pendingDrag.current) return
    const pt = sheetPoint(e)
    if (!pt) {
      setHoverId(null)
      return
    }
    const cell = cellAtPoint(pt.x, pt.y, palettes, layout)
    setHoverId(cell?.paletteId ?? null)
  }

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    pendingDrag.current = null
    const pt = sheetPoint(e)
    if (!pt) return
    const hit = hitTest(pt.x, pt.y, palettes, layout)
    if (!hit) return
    e.preventDefault()

    if (hit.kind === 'name') {
      const pal = palettes.find((p) => p.id === hit.paletteId)
      setEdit({
        kind: 'name',
        paletteId: hit.paletteId,
        value: pal?.name ?? '',
        box: hit.rect,
      })
      return
    }

    if (hit.kind === 'band') {
      setEdit({
        kind: 'color',
        paletteId: hit.paletteId,
        colorIndex: hit.colorIndex,
        value: hit.hex,
        box: hit.rect,
      })
      return
    }

    let newIndex = 0
    const nextPalettes = palettes.map((p) => {
      if (p.id !== hit.paletteId) return p
      newIndex = p.colors.length
      return { ...p, colors: [...p.colors, '#000000'] }
    })
    onPalettesChange(nextPalettes)
    setEdit({
      kind: 'color',
      paletteId: hit.paletteId,
      colorIndex: newIndex,
      value: '#000000',
      box: {
        x: hit.rect.x,
        y: hit.rect.y,
        w: hit.rect.w,
        h: layout.bandHeight,
      },
    })
  }

  function sortPalette(id: string, key: ColorSortKey) {
    const prev = sortState[id]
    const dir: 1 | -1 = prev?.key === key ? (prev.dir === 1 ? -1 : 1) : 1
    setSortState((s) => ({ ...s, [id]: { key, dir } }))
    onPalettesChange(
      palettes.map((p) =>
        p.id === id ? { ...p, colors: sortColors(p.colors, key, dir) } : p,
      ),
    )
  }

  function removePalette(id: string) {
    if (palettes.length <= 1) return
    onPalettesChange(palettes.filter((p) => p.id !== id))
    setHoverId(null)
  }

  const editStyle =
    edit && displayScale > 0
      ? edit.kind === 'name'
        ? {
            left: (edit.box.x + edit.box.w / 2) * displayScale,
            top: edit.box.y * displayScale,
            minWidth: Math.max(edit.box.w * displayScale, 72),
            transform: 'translate(-50%, -2px)',
          }
        : {
            left: edit.box.x * displayScale,
            top: edit.box.y * displayScale,
            minWidth: Math.max(edit.box.w * displayScale, 132),
          }
      : undefined

  const hoverHit = hoverId && !drag ? hits.find((h) => h.paletteId === hoverId) : null
  const dragHit = drag ? hits.find((h) => h.paletteId === drag.paletteId) : null
  const swapPalette =
    drag && drag.overId && drag.overId !== drag.paletteId
      ? palettes.find((p) => p.id === drag.overId)
      : null
  const frameRect = frameRef.current?.getBoundingClientRect()
  const chromeLift = 44

  return (
    <div className="preview">
      <p className="preview__hint">
        Drag to rearrange · double-click to edit · Ctrl+Z to undo
      </p>
      <div className="preview__frame" ref={frameRef}>
        <canvas
          ref={canvasRef}
          className={`preview__canvas ${drag ? 'preview__canvas--dragging' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMoveHover}
          onPointerLeave={(e) => {
            if (drag) return
            const next = e.relatedTarget as Node | null
            if (next && (e.currentTarget.parentElement?.querySelector('.palette-chrome')?.contains(next))) {
              return
            }
            setHoverId(null)
          }}
          onDoubleClick={onDoubleClick}
        />

        {hoverHit && displayScale > 0 && (
          <div
            className="palette-chrome"
            style={{
              left: hoverHit.cell.x * displayScale,
              top: hoverHit.cell.y * displayScale - chromeLift,
              width: hoverHit.cell.w * displayScale,
              height: hoverHit.cell.h * displayScale + chromeLift,
            }}
            onPointerEnter={() => setHoverId(hoverHit.paletteId)}
            onPointerLeave={(e) => {
              const next = e.relatedTarget as Node | null
              if (next && canvasRef.current?.contains(next)) return
              setHoverId(null)
            }}
          >
            <div className="palette-chrome__hit">
              <div className="palette-chrome__bar">
                <span className="palette-chrome__label">Sort</span>
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
                    className={`chip chip--compact ${
                      sortState[hoverHit.paletteId]?.key === key ? 'chip--on' : ''
                    }`}
                    onClick={() => sortPalette(hoverHit.paletteId, key)}
                  >
                    {label}
                    {sortState[hoverHit.paletteId]?.key === key
                      ? sortState[hoverHit.paletteId].dir === 1
                        ? ' ↑'
                        : ' ↓'
                      : ''}
                  </button>
                ))}
                <button
                  type="button"
                  className="icon-btn icon-btn--tiny"
                  disabled={palettes.length <= 1}
                  onClick={() => removePalette(hoverHit.paletteId)}
                  aria-label="Remove palette"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        )}

        {edit && editStyle && (
          <div
            ref={editorRef}
            className={`preview__editor preview__editor--${edit.kind}`}
            style={editStyle}
          >
            {edit.kind === 'name' ? (
              <input
                ref={inputRef}
                className="preview__name-input"
                value={edit.value}
                onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                aria-label="Palette name"
              />
            ) : (
              <div className="preview__color-edit">
                <input
                  type="color"
                  value={parseHex(edit.value) ?? '#000000'}
                  onChange={(e) =>
                    setEdit({ ...edit, value: e.target.value.toUpperCase() })
                  }
                  aria-label="Pick color"
                />
                <input
                  ref={inputRef}
                  className="preview__hex-input"
                  value={edit.value}
                  spellCheck={false}
                  onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                  aria-label="Hex color"
                />
                <div className="preview__color-insert" role="group" aria-label="Insert color">
                  <button
                    type="button"
                    className="chip chip--compact"
                    onClick={() => insertColor('above')}
                  >
                    + Above
                  </button>
                  <button
                    type="button"
                    className="chip chip--compact"
                    onClick={() => insertColor('below')}
                  >
                    + Below
                  </button>
                  <button
                    type="button"
                    className="chip chip--compact chip--danger"
                    disabled={
                      (palettes.find((p) => p.id === edit.paletteId)?.colors.length ?? 0) <= 1
                    }
                    onClick={() => deleteColor()}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {drag && dragHit && swapPalette && (
          <div
            className="drag-ghost drag-ghost--swap"
            style={{
              left: dragHit.cell.x * displayScale,
              top: dragHit.cell.y * displayScale,
              width: dragHit.cell.w * displayScale,
              height: dragHit.cell.h * displayScale,
            }}
          >
            <DragGhostCanvas palette={swapPalette} layout={layout} />
          </div>
        )}

        {drag && dragHit && frameRect && (
          <div
            className="drag-ghost drag-ghost--follow"
            style={{
              left: drag.pointerX - frameRect.left - drag.offsetX,
              top: drag.pointerY - frameRect.top - drag.offsetY,
              width: dragHit.cell.w * displayScale,
              height: dragHit.cell.h * displayScale,
            }}
          >
            <DragGhostCanvas
              palette={palettes.find((p) => p.id === drag.paletteId)!}
              layout={layout}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function DragGhostCanvas({ palette, layout }: { palette: Palette; layout: SheetLayout }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const host = ref.current
    if (!host) return
    const sheet = renderSheet([palette], { ...layout, columns: 1, padding: 8 }, 1)
    host.width = sheet.width
    host.height = sheet.height
    const ctx = host.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, host.width, host.height)
    ctx.drawImage(sheet, 0, 0)
  }, [palette, layout])
  return <canvas ref={ref} className="drag-ghost__canvas" />
}
