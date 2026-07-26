import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { imageFilesFromDataTransfer } from '../lib/clipboardImage'
import { sourcePathFromDrop } from '../lib/imageRef'
import { simplifyPalette, type ClusterReduce } from '../lib/imagePalette'
import { normalizeHex, parseHex, sortColors, type ColorSortKey } from '../lib/palette'
import {
  cellAtPoint,
  computeAddPaletteSlot,
  computeSheetHits,
  hitTest,
  movePalette,
  renderSheet,
  type PaletteHit,
  type Rect,
} from '../lib/render'
import type { Palette, SheetLayout } from '../types'
import { ColorPanel } from './ColorPanel'
import { PalettePanel } from './PalettePanel'

interface SheetPreviewProps {
  title: string
  palettes: Palette[]
  layout: SheetLayout
  onTitleChange: (title: string) => void
  onPalettesChange: (palettes: Palette[]) => void
  onAddPalette: () => void
  onFromImage: () => void
  onImportSheet: () => void
  onImportPng: (file: File, sourcePath?: string) => void
  /** Drag-drop loaded an image but the browser hid the filesystem path. */
  onDropMissingPath?: () => void
  /** Fired when the sheet gains/loses “last clicked” status for paste. */
  onSheetActiveChange?: (active: boolean) => void
  selectedId: string | null
  onSelectedIdChange: (id: string | null) => void
  editSlot: HTMLDivElement | null
  onOpenSourceImage?: (palette: Palette) => void
}

type NameEdit = {
  kind: 'name'
  paletteId: string
  value: string
  box: Rect
}

type SheetTitleEdit = {
  kind: 'sheet-title'
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

type ActiveEdit = NameEdit | ColorEdit | SheetTitleEdit

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

export function SheetPreview({
  title,
  palettes,
  layout,
  onTitleChange,
  onPalettesChange,
  onAddPalette,
  onFromImage,
  onImportSheet,
  onImportPng,
  onDropMissingPath,
  onSheetActiveChange,
  selectedId,
  onSelectedIdChange,
  editSlot,
  onOpenSourceImage,
}: SheetPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const sheetLogicalRef = useRef({ w: 1, h: 1 })
  const editorRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editRef = useRef<ActiveEdit | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const onSheetActiveChangeRef = useRef(onSheetActiveChange)
  onSheetActiveChangeRef.current = onSheetActiveChange
  const pendingDrag = useRef<{
    paletteId: string
    index: number
    startX: number
    startY: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const pendingDeselect = useRef(false)
  const selectedIdRef = useRef(selectedId)
  const editSlotRef = useRef(editSlot)
  const deselectPaletteRef = useRef<() => void>(() => {})
  selectedIdRef.current = selectedId
  editSlotRef.current = editSlot

  const [edit, setEdit] = useState<ActiveEdit | null>(null)
  const [displayScale, setDisplayScale] = useState(1)
  const [hits, setHits] = useState<PaletteHit[]>([])
  const [titleHit, setTitleHit] = useState<Rect | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [hoverAdd, setHoverAdd] = useState(false)
  const [hoverTitle, setHoverTitle] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [sortState, setSortState] = useState<
    Record<string, { key: ColorSortKey; dir: 1 | -1 }>
  >({})
  const [simplifyLive, setSimplifyLive] = useState(false)
  const [simplifyK, setSimplifyK] = useState(4)
  const [simplifyReduce, setSimplifyReduce] = useState<ClusterReduce>('mean')

  editRef.current = edit
  dragRef.current = drag

  // When selection comes from the Edit sidebar, mirror sheet-select setup.
  const lastSelectSetup = useRef<string | null>(null)
  useEffect(() => {
    if (selectedId === lastSelectSetup.current) return
    lastSelectSetup.current = selectedId
    setSimplifyLive(false)
    if (!selectedId) return
    const pal = palettes.find((p) => p.id === selectedId)
    if (pal) {
      setSimplifyK(Math.max(1, Math.min(4, pal.colors.length - 1)))
      setSimplifyReduce('mean')
    }
  }, [selectedId, palettes])

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const frame = frameRef.current
      const active = Boolean(frame?.contains(e.target as Node))
      onSheetActiveChangeRef.current?.(active)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  const displayPalettes = useMemo(() => {
    let next = palettes

    if (edit?.kind === 'color') {
      const hex = parseHex(edit.value)
      if (hex) {
        next = next.map((p) => {
          if (p.id !== edit.paletteId) return p
          const colors = [...p.colors]
          if (edit.colorIndex >= colors.length) return p
          colors[edit.colorIndex] = hex
          return { ...p, colors }
        })
      }
    }

    if (selectedId && simplifyLive) {
      const source = palettes.find((p) => p.id === selectedId)
      if (source && source.colors.length >= 2) {
        const k = Math.max(1, Math.min(simplifyK, source.colors.length - 1))
        const colors = simplifyPalette(source.colors, k, simplifyReduce)
        next = next.map((p) => (p.id === selectedId ? { ...p, colors } : p))
      }
    }

    return next
  }, [palettes, edit, selectedId, simplifyLive, simplifyK, simplifyReduce])

  const displayPalettesRef = useRef(displayPalettes)
  const layoutRef = useRef(layout)
  const titleRef = useRef(title)
  displayPalettesRef.current = displayPalettes
  layoutRef.current = layout
  titleRef.current = title

  useEffect(() => {
    function sheetPointFromClient(clientX: number, clientY: number) {
      const host = canvasRef.current
      if (!host) return null
      const rect = host.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      const { w, h } = sheetLogicalRef.current
      return {
        x: ((clientX - rect.left) / rect.width) * w,
        y: ((clientY - rect.top) / rect.height) * h,
      }
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return
      const sel = selectedIdRef.current
      if (!sel) return

      const target = e.target as HTMLElement | null
      if (!target) return

      // Keep selection while using the edit detail panel / color tools.
      const slot = editSlotRef.current
      if (slot?.contains(target)) return
      if (target.closest('.modal, .modal-backdrop')) return
      if (target.closest('.preview__editor, .preview__name-input')) return
      if (target.closest('.preview__delete')) return

      const canvas = canvasRef.current
      const onCanvas = Boolean(canvas && (target === canvas || canvas.contains(target)))
      if (onCanvas) {
        const pt = sheetPointFromClient(e.clientX, e.clientY)
        if (pt) {
          const cell = cellAtPoint(
            pt.x,
            pt.y,
            displayPalettesRef.current,
            layoutRef.current,
            titleRef.current,
          )
          // Click on any palette cell: keep current selection until click/drag resolves.
          if (cell) return
          // Sheet title hit — don't clear an in-progress title edit.
          const titleBox = computeSheetHits(
            displayPalettesRef.current,
            layoutRef.current,
            titleRef.current,
          ).title
          const pad = 6
          if (
            pt.x >= titleBox.x - pad &&
            pt.x <= titleBox.x + titleBox.w + pad &&
            pt.y >= titleBox.y - pad &&
            pt.y <= titleBox.y + titleBox.h + pad
          ) {
            return
          }
        }
        pendingDeselect.current = false
        deselectPaletteRef.current()
        return
      }

      // Frame padding, add chrome, workspace, toolbar, etc.
      pendingDeselect.current = false
      deselectPaletteRef.current()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  useEffect(() => {
    const host = canvasRef.current
    if (!host) return
    const info = computeSheetHits(displayPalettes, layout, title)
    setHits(info.hits)
    setTitleHit(info.title)
    const addSlot = computeAddPaletteSlot(displayPalettes, layout, title)

    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
    const sheet = renderSheet(displayPalettes, layout, dpr, title, { preview: true })
    const sheetW = sheet.width / dpr
    const sheetH = sheet.height / dpr
    const logicalW = Math.max(sheetW, addSlot.width)
    const logicalH = Math.max(sheetH, addSlot.height)
    sheetLogicalRef.current = { w: logicalW, h: logicalH }

    host.width = Math.ceil(logicalW * dpr)
    host.height = Math.ceil(logicalH * dpr)
    host.style.width = `${logicalW}px`
    host.style.height = `${logicalH}px`

    const ctx = host.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, host.width, host.height)

    // Overlay in layout coordinates (pre-DPR)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = layout.background
    ctx.fillRect(0, 0, logicalW, logicalH)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(sheet, 0, 0)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const d = dragRef.current
    const ringPad = 6
    const ringRadius = 10
    function strokePaletteRing(
      cell: { x: number; y: number; w: number; h: number },
      color: string,
      lineWidth = 1.5,
    ) {
      const x = cell.x - ringPad
      const y = cell.y - ringPad
      const w = cell.w + ringPad * 2
      const h = cell.h + ringPad * 2
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, w, h, ringRadius)
      } else {
        const r = Math.min(ringRadius, w / 2, h / 2)
        ctx.moveTo(x + r, y)
        ctx.arcTo(x + w, y, x + w, y + h, r)
        ctx.arcTo(x + w, y + h, x, y + h, r)
        ctx.arcTo(x, y + h, x, y, r)
        ctx.arcTo(x, y, x + w, y, r)
        ctx.closePath()
      }
      ctx.stroke()
      ctx.setLineDash([])
    }

    if (d) {
      const source = info.hits.find((h) => h.paletteId === d.paletteId)
      if (source) {
        ctx.fillStyle = layout.background
        ctx.fillRect(source.cell.x, source.cell.y, source.cell.w, source.cell.h)
        strokePaletteRing(source.cell, 'rgba(170, 170, 170, 0.55)')
      }
      if (d.overId && d.overId !== d.paletteId) {
        const over = info.hits.find((h) => h.paletteId === d.overId)
        if (over) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.03)'
          ctx.fillRect(over.cell.x, over.cell.y, over.cell.w, over.cell.h)
          strokePaletteRing(over.cell, 'rgba(160, 160, 160, 0.85)', 1.75)
        }
      }
    } else {
      if (hoverId && hoverId !== selectedId) {
        const hover = info.hits.find((h) => h.paletteId === hoverId)
        if (hover) strokePaletteRing(hover.cell, 'rgba(190, 190, 190, 0.45)')
      }
      if (selectedId) {
        const sel = info.hits.find((h) => h.paletteId === selectedId)
        if (sel) strokePaletteRing(sel.cell, 'rgba(170, 170, 170, 0.9)')
      }
      if (hoverAdd) {
        strokePaletteRing(addSlot.cell, 'rgba(170, 170, 170, 0.55)')
      }
      if (hoverTitle && edit?.kind !== 'sheet-title') {
        strokePaletteRing(info.title, 'rgba(170, 170, 170, 0.55)')
      }
    }

    updateScale()
  }, [
    displayPalettes,
    layout,
    title,
    drag?.overId,
    drag?.paletteId,
    selectedId,
    hoverId,
    hoverAdd,
    hoverTitle,
    edit?.kind,
  ])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const ro = new ResizeObserver(() => updateScale())
    ro.observe(frame)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (edit?.kind === 'name' || edit?.kind === 'sheet-title') inputRef.current?.select()
  }, [
    edit?.kind,
    edit && edit.kind === 'name' ? edit.paletteId : null,
  ])

  useEffect(() => {
    if (!edit || (edit.kind !== 'name' && edit.kind !== 'sheet-title')) return
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
    // Intentionally not depending on `edit` value — rebinding every keystroke breaks typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit?.kind, edit && edit.kind === 'name' ? edit.paletteId : null])

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
          if (editRef.current?.kind === 'color') commitEdit()
          setHoverId(null)
          setHoverAdd(false)
          setHoverTitle(false)
          setDrag(next)
          setEdit(null)
        }
        return
      }

      const d = dragRef.current
      if (!d) return
      const pt = clientToSheet(e.clientX, e.clientY)
      const over = pt ? cellAtPoint(pt.x, pt.y, displayPalettes, layout, title) : null
      setDrag({
        ...d,
        pointerX: e.clientX,
        pointerY: e.clientY,
        overId: over?.paletteId ?? d.overId,
      })
    }

    function onUp() {
      const pending = pendingDrag.current
      const d = dragRef.current
      const shouldDeselect = pendingDeselect.current
      pendingDrag.current = null
      pendingDeselect.current = false
      if (d) {
        if (d.overId && d.overId !== d.paletteId) {
          onPalettesChange(movePalette(displayPalettes, d.paletteId, d.overId))
        }
        setDrag(null)
        return
      }
      if (pending) {
        selectPalette(pending.paletteId)
        return
      }
      if (shouldDeselect) deselectPalette()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [displayPalettes, layout, title, onPalettesChange])

  function updateScale() {
    const host = canvasRef.current
    const { w } = sheetLogicalRef.current
    if (!host || !w) return
    const rect = host.getBoundingClientRect()
    setDisplayScale(rect.width / w)
  }

  function clientToSheet(clientX: number, clientY: number): { x: number; y: number } | null {
    const host = canvasRef.current
    if (!host) return null
    const rect = host.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const { w, h } = sheetLogicalRef.current
    return {
      x: ((clientX - rect.left) / rect.width) * w,
      y: ((clientY - rect.top) / rect.height) * h,
    }
  }

  function sheetPoint(e: React.MouseEvent | React.PointerEvent): { x: number; y: number } | null {
    return clientToSheet(e.clientX, e.clientY)
  }

  function commitEdit() {
    const next = editRef.current
    if (!next) return
    if (next.kind === 'sheet-title') {
      onTitleChange(next.value)
    } else if (next.kind === 'name') {
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

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0 || edit?.kind === 'name' || edit?.kind === 'sheet-title') return
    const pt = sheetPoint(e)
    if (!pt) return

    const titleBox = titleHit ?? computeSheetHits(displayPalettes, layout, title).title
    const titlePad = 6
    if (
      pt.x >= titleBox.x - titlePad &&
      pt.x <= titleBox.x + titleBox.w + titlePad &&
      pt.y >= titleBox.y - titlePad &&
      pt.y <= titleBox.y + titleBox.h + titlePad
    ) {
      pendingDrag.current = null
      pendingDeselect.current = false
      if (editRef.current?.kind === 'color') commitEdit()
      setEdit({
        kind: 'sheet-title',
        value: title,
        box: titleBox,
      })
      return
    }

    const cell = cellAtPoint(pt.x, pt.y, displayPalettes, layout, title)
    if (!cell) {
      pendingDrag.current = null
      pendingDeselect.current = false
      deselectPalette()
      return
    }
    pendingDeselect.current = false
    pendingDrag.current = {
      paletteId: cell.paletteId,
      index: cell.paletteIndex,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: (pt.x - cell.cell.x) * displayScale,
      offsetY: (pt.y - cell.cell.y) * displayScale,
    }
  }

  function onCanvasPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current || pendingDrag.current) {
      if (hoverId) setHoverId(null)
      if (hoverAdd) setHoverAdd(false)
      if (hoverTitle) setHoverTitle(false)
      return
    }
    const pt = sheetPoint(e)
    if (!pt) {
      if (hoverId) setHoverId(null)
      if (hoverAdd) setHoverAdd(false)
      if (hoverTitle) setHoverTitle(false)
      return
    }
    const cell = cellAtPoint(pt.x, pt.y, displayPalettes, layout, title)
    const next = cell?.paletteId ?? null
    if (next !== hoverId) setHoverId(next)

    const pad = 6
    const titleBox = titleHit ?? computeSheetHits(displayPalettes, layout, title).title
    const overTitle =
      !next &&
      pt.x >= titleBox.x - pad &&
      pt.x <= titleBox.x + titleBox.w + pad &&
      pt.y >= titleBox.y - pad &&
      pt.y <= titleBox.y + titleBox.h + pad
    if (overTitle !== hoverTitle) setHoverTitle(overTitle)

    const slot = computeAddPaletteSlot(displayPalettes, layout, title).cell
    const overAdd =
      !next &&
      !overTitle &&
      pt.x >= slot.x - pad &&
      pt.x <= slot.x + slot.w + pad &&
      pt.y >= slot.y - pad &&
      pt.y <= slot.y + slot.h + pad
    if (overAdd !== hoverAdd) setHoverAdd(overAdd)
  }

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    pendingDrag.current = null
    const pt = sheetPoint(e)
    if (!pt) return
    const hit = hitTest(pt.x, pt.y, displayPalettes, layout, title)
    if (!hit) return
    e.preventDefault()

    if (hit.kind === 'sheet-title') {
      if (edit?.kind === 'color') commitEdit()
      setEdit({
        kind: 'sheet-title',
        value: title,
        box: hit.rect,
      })
      return
    }

    if (hit.kind === 'name') {
      if (edit?.kind === 'color') commitEdit()
      const pal = displayPalettes.find((p) => p.id === hit.paletteId)
      setEdit({
        kind: 'name',
        paletteId: hit.paletteId,
        value: pal?.name ?? '',
        box: hit.rect,
      })
      return
    }

    if (hit.kind === 'band') {
      onSelectedIdChange(hit.paletteId)
      setSimplifyLive(false)
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
    const nextPalettes = displayPalettes.map((p) => {
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

  function selectPalette(id: string) {
    onSelectedIdChange(id)
  }

  function deselectPalette() {
    const current = editRef.current
    if (
      current?.kind === 'color' ||
      current?.kind === 'sheet-title' ||
      current?.kind === 'name'
    ) {
      commitEdit()
    } else {
      setEdit(null)
    }
    onSelectedIdChange(null)
    setSimplifyLive(false)
    setHoverId(null)
  }
  deselectPaletteRef.current = deselectPalette

  function sortPalette(id: string, key: ColorSortKey) {
    setSimplifyLive(false)
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
    onPalettesChange(palettes.filter((p) => p.id !== id))
    if (selectedId === id) {
      onSelectedIdChange(null)
      setSimplifyLive(false)
    }
  }

  function applySimplify(id: string) {
    const pal = palettes.find((p) => p.id === id)
    if (!pal || pal.colors.length < 2) return
    const k = Math.max(1, Math.min(simplifyK, pal.colors.length - 1))
    const next = simplifyPalette(pal.colors, k, simplifyReduce)
    onPalettesChange(palettes.map((p) => (p.id === id ? { ...p, colors: next } : p)))
    setSimplifyLive(false)
  }

  function resetSimplify() {
    setSimplifyLive(false)
    const pal = selectedId ? palettes.find((p) => p.id === selectedId) : null
    if (pal) setSimplifyK(Math.max(1, Math.min(4, pal.colors.length - 1)))
    setSimplifyReduce('mean')
  }

  const editStyle =
    edit && (edit.kind === 'name' || edit.kind === 'sheet-title') && displayScale > 0
      ? {
          left: (edit.box.x + edit.box.w / 2) * displayScale,
          top: edit.box.y * displayScale,
          minWidth: Math.max(edit.box.w * displayScale, edit.kind === 'sheet-title' ? 120 : 72),
          transform: 'translate(-50%, -2px)',
        }
      : undefined

  const colorEdit = edit?.kind === 'color' ? edit : null
  const colorPal = colorEdit
    ? displayPalettes.find((p) => p.id === colorEdit.paletteId)
    : null
  const colorEditInSlot = Boolean(colorEdit && colorPal && editSlot)

  const selectedSource = selectedId ? palettes.find((p) => p.id === selectedId) : null
  const selectedDisplay = selectedId
    ? displayPalettes.find((p) => p.id === selectedId)
    : null

  function openColorEdit(paletteId: string, colorIndex: number) {
    const pal = palettes.find((p) => p.id === paletteId)
    if (!pal || colorIndex < 0 || colorIndex >= pal.colors.length) return
    setSimplifyLive(false)
    onSelectedIdChange(paletteId)
    setEdit({
      kind: 'color',
      paletteId,
      colorIndex,
      value: pal.colors[colorIndex],
      box: { x: 0, y: 0, w: 0, h: 0 },
    })
  }

  const dragHit = drag ? hits.find((h) => h.paletteId === drag.paletteId) : null
  const swapPalette =
    drag && drag.overId && drag.overId !== drag.paletteId
      ? displayPalettes.find((p) => p.id === drag.overId)
      : null
  const frameRect = frameRef.current?.getBoundingClientRect()

  const chromeId = drag ? null : hoverId ?? selectedId
  const chromeHit = chromeId ? hits.find((h) => h.paletteId === chromeId) : null
  const ringPad = 6
  const deleteBtn = 18
  const deleteInset = 6
  const deleteStyle =
    chromeHit && displayScale > 0
      ? {
          left: (chromeHit.cell.x - ringPad + deleteInset) * displayScale,
          top: (chromeHit.cell.y - ringPad + deleteInset) * displayScale,
          width: deleteBtn,
          height: deleteBtn,
        }
      : undefined

  const addSlot = useMemo(
    () => computeAddPaletteSlot(displayPalettes, layout, title),
    [displayPalettes, layout, title],
  )
  const addBtn = 26
  const addGap = 8
  const addClusterW = addBtn * 3 + addGap * 2
  const showAddChrome = !drag && hoverAdd && displayScale > 0
  const addActionsStyle = showAddChrome
    ? {
        left: (addSlot.cell.x + addSlot.cell.w / 2) * displayScale - addClusterW / 2,
        top: (addSlot.cell.y + addSlot.cell.h / 2) * displayScale - addBtn / 2,
        width: addClusterW,
        height: addBtn,
      }
    : undefined
  const addDropStyle =
    displayScale > 0
      ? {
          left: (addSlot.cell.x - ringPad) * displayScale,
          top: (addSlot.cell.y - ringPad) * displayScale,
          width: (addSlot.cell.w + ringPad * 2) * displayScale,
          height: (addSlot.cell.h + ringPad * 2) * displayScale,
        }
      : undefined

  function onFrameDragOver(e: React.DragEvent) {
    if (![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!hoverAdd) setHoverAdd(true)
  }

  function onFrameDragLeave(e: React.DragEvent) {
    if (frameRef.current?.contains(e.relatedTarget as Node)) return
    setHoverAdd(false)
  }

  function onFrameDrop(e: React.DragEvent) {
    if (![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    setHoverAdd(false)
    onSheetActiveChangeRef.current?.(true)
    const image = imageFilesFromDataTransfer(e.dataTransfer)[0]
    if (!image) return
    const path = sourcePathFromDrop(image, e.dataTransfer)
    if (!path) onDropMissingPath?.()
    onImportPng(image, path)
  }

  const colorPanel =
    colorEdit && colorPal ? (
      <ColorPanel
        embedded={colorEditInSlot}
        hex={colorEdit.value}
        paletteName={colorPal.name}
        onChange={(hex) => setEdit({ ...colorEdit, value: hex })}
        onClose={() => commitEdit()}
      />
    ) : null

  return (
    <>
      {colorPanel && colorEditInSlot
        ? createPortal(colorPanel, editSlot!)
        : colorPanel && !selectedId
          ? colorPanel
          : null}

      {selectedSource &&
        selectedDisplay &&
        editSlot &&
        !colorEdit &&
        createPortal(
          <PalettePanel
            embedded
            palette={selectedSource}
            sourceColorCount={selectedSource.colors.length}
            previewColorCount={selectedDisplay.colors.length}
            sortState={sortState[selectedSource.id]}
            simplifyK={simplifyK}
            simplifyReduce={simplifyReduce}
            simplifyLive={simplifyLive}
            onSort={(key) => sortPalette(selectedSource.id, key)}
            onSimplifyK={(k) => {
              setSimplifyK(k)
              setSimplifyLive(true)
            }}
            onSimplifyReduce={(m) => {
              setSimplifyReduce(m)
              setSimplifyLive(true)
            }}
            onApplySimplify={() => applySimplify(selectedSource.id)}
            onResetSimplify={resetSimplify}
            onAddMixedColor={(hex) => {
              setSimplifyLive(false)
              onPalettesChange(
                palettes.map((p) =>
                  p.id === selectedSource.id ? { ...p, colors: [...p.colors, hex] } : p,
                ),
              )
            }}
            onRemoveColor={(index) => {
              setSimplifyLive(false)
              onPalettesChange(
                palettes.map((p) => {
                  if (p.id !== selectedSource.id || p.colors.length <= 1) return p
                  return {
                    ...p,
                    colors: p.colors.filter((_, i) => i !== index),
                    sourcePicks: p.sourcePicks?.filter((_, i) => i !== index),
                  }
                }),
              )
            }}
            onEditColor={(index) => openColorEdit(selectedSource.id, index)}
            onReorderColors={(from, to) => {
              setSimplifyLive(false)
              onPalettesChange(
                palettes.map((p) => {
                  if (p.id !== selectedSource.id) return p
                  const colors = [...p.colors]
                  const [moved] = colors.splice(from, 1)
                  colors.splice(to, 0, moved)
                  const sourcePicks = p.sourcePicks
                    ? (() => {
                        const picks = [...p.sourcePicks]
                        const [pick] = picks.splice(from, 1)
                        if (pick) picks.splice(to, 0, pick)
                        return picks
                      })()
                    : p.sourcePicks
                  return { ...p, colors, sourcePicks }
                }),
              )
            }}
            onRename={(name) => {
              setSimplifyLive(false)
              onPalettesChange(
                palettes.map((p) => (p.id === selectedSource.id ? { ...p, name } : p)),
              )
            }}
            onOpenSourceImage={
              selectedSource.sourceImage
                ? () => onOpenSourceImage?.(selectedSource)
                : undefined
            }
            onClose={() => {
              onSelectedIdChange(null)
              setSimplifyLive(false)
            }}
          />,
          editSlot,
        )}

    <div
      className={`preview ${colorEdit && !colorEditInSlot ? 'preview--with-panel' : ''}`}
    >
      <div
        className="preview__frame"
        ref={frameRef}
        tabIndex={0}
        onPointerDown={() => onSheetActiveChangeRef.current?.(true)}
        onPointerLeave={() => {
          setHoverId(null)
          setHoverAdd(false)
          setHoverTitle(false)
        }}
        onDragOver={onFrameDragOver}
        onDragLeave={onFrameDragLeave}
        onDrop={onFrameDrop}
      >
        <canvas
          ref={canvasRef}
          className={`preview__canvas ${drag ? 'preview__canvas--dragging' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onCanvasPointerMove}
          onDoubleClick={onDoubleClick}
        />

        {deleteStyle && chromeId && (
          <button
            type="button"
            className="preview__delete"
            style={deleteStyle}
            aria-label="Delete palette"
            title="Delete palette"
            onPointerDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
            onClick={(e) => {
              e.stopPropagation()
              removePalette(chromeId)
              setHoverId(null)
            }}
          >
            ×
          </button>
        )}

        {addDropStyle && hoverAdd && !drag && (
          <div
            className="preview__import-drop"
            style={addDropStyle}
            aria-hidden
          />
        )}

        {addActionsStyle && (
          <div
            className="preview__add-actions"
            style={addActionsStyle}
            onPointerEnter={() => setHoverAdd(true)}
          >
            <button
              type="button"
              className="preview__add"
              aria-label="Add blank palette"
              title="Add blank palette"
              onPointerDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
              onClick={(e) => {
                e.stopPropagation()
                onAddPalette()
                setHoverAdd(false)
              }}
            >
              +
            </button>
            <button
              type="button"
              className="preview__add"
              aria-label="From image"
              title="From image"
              onPointerDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
              onClick={(e) => {
                e.stopPropagation()
                onFromImage()
                setHoverAdd(false)
              }}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <path
                  fill="currentColor"
                  d="M2.5 2.5h11A1.5 1.5 0 0 1 15 4v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12V4a1.5 1.5 0 0 1 1.5-1.5Zm0 1a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V4a.5.5 0 0 0-.5-.5h-11Zm8.1 2.1a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3ZM3.2 11.2l2.7-3.1a.6.6 0 0 1 .9 0l1.55 1.8 1.35-1.55a.6.6 0 0 1 .9.05l2.2 2.8H3.2Z"
                />
              </svg>
            </button>
            <button
              type="button"
              className="preview__add"
              aria-label="Import sheet"
              title="Import sheet"
              onPointerDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
              onClick={(e) => {
                e.stopPropagation()
                onImportSheet()
                setHoverAdd(false)
              }}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <path
                  fill="currentColor"
                  d="M3.5 1.5h7.2L13.5 4.3V12a1.5 1.5 0 0 1-1.5 1.5H3.5A1.5 1.5 0 0 1 2 12V3A1.5 1.5 0 0 1 3.5 1.5Zm0 1A.5.5 0 0 0 3 3v9a.5.5 0 0 0 .5.5H12a.5.5 0 0 0 .5-.5V4.7L10.3 2.5H3.5ZM5 6.25h6v1H5v-1Zm0 2.25h6v1H5v-1Zm0 2.25h4v1H5v-1Z"
                />
                <path
                  fill="currentColor"
                  d="M4.75 13.75h8.75A1.5 1.5 0 0 0 15 12.25V5.5h-1v6.75a.5.5 0 0 1-.5.5H4.75v1Z"
                />
              </svg>
            </button>
          </div>
        )}

        {(edit?.kind === 'name' || edit?.kind === 'sheet-title') && editStyle && (
          <div
            ref={editorRef}
            className={`preview__editor preview__editor--name ${
              edit.kind === 'sheet-title' ? 'preview__editor--sheet-title' : ''
            }`}
            style={editStyle}
          >
            <input
              ref={inputRef}
              className="preview__name-input"
              value={edit.value}
              placeholder={edit.kind === 'sheet-title' ? '<title>' : undefined}
              onChange={(e) => setEdit({ ...edit, value: e.target.value })}
              aria-label={edit.kind === 'sheet-title' ? 'Sheet title' : 'Palette name'}
            />
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
              palette={displayPalettes.find((p) => p.id === drag.paletteId)!}
              layout={layout}
            />
          </div>
        )}
      </div>
    </div>
    </>
  )
}

function DragGhostCanvas({ palette, layout }: { palette: Palette; layout: SheetLayout }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const host = ref.current
    if (!host) return
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
    const sheet = renderSheet([palette], { ...layout, columns: 1, padding: 8 }, dpr)
    const logicalW = sheet.width / dpr
    const logicalH = sheet.height / dpr
    host.width = sheet.width
    host.height = sheet.height
    host.style.width = `${logicalW}px`
    host.style.height = `${logicalH}px`
    const ctx = host.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, host.width, host.height)
    ctx.drawImage(sheet, 0, 0)
  }, [palette, layout])
  return <canvas ref={ref} className="drag-ghost__canvas" />
}
