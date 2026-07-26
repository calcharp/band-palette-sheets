import { useEffect, useRef, useState } from 'react'
import { clipboardImageLabel, imageFilesFromDataTransfer } from '../lib/clipboardImage'
import { sourcePathFromDrop } from '../lib/imageRef'
import {
  cloneImageData,
  cropEllipse,
  cropFreehand,
  cropRect,
  loadImageFile,
  normalizeDragRect,
  samplePixel,
  seedPaletteFromImage,
  type PixelColor,
  type Pt,
} from '../lib/imagePalette'
import {
  createPalette,
  sortColors,
  type ColorSortKey,
} from '../lib/palette'
import { contrastInk } from '../lib/render'
import type { Palette } from '../types'

type FromImageSortKey = ColorSortKey | 'vertical' | 'horizontal'

export interface FromImageResume {
  paletteId: string
  name: string
  image: ImageData
  picks: PixelColor[]
  sourcePath?: string
}

/** New from-image session started with an already-decoded bitmap. */
export interface FromImageSeed {
  name: string
  image: ImageData
  sourcePath?: string
}

interface FromImageModalProps {
  open: boolean
  onClose: () => void
  onSave: (palette: Palette) => void
  /** Reopen an existing from-image palette with its source loaded. */
  resume?: FromImageResume | null
  /** Start a new session with this image already loaded. */
  seed?: FromImageSeed | null
  /** Drag-drop loaded an image but the browser hid the filesystem path. */
  onDropMissingPath?: () => void
}

interface ViewState {
  fit: number
  zoom: number
  panX: number
  panY: number
}

type CropKind = 'rect' | 'ellipse' | 'freehand'
type Tool = 'pick' | CropKind

interface HistorySnap {
  image: ImageData
  picks: PixelColor[]
  selected: number | null
}

interface CropDrag {
  tool: 'rect' | 'ellipse' | 'freehand'
  startX: number
  startY: number
  curX: number
  curY: number
  points: Pt[]
  shift: boolean
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 12
const SEED_COUNT = 4
const MAX_PICK_HISTORY = 60

export function FromImageModal({
  open,
  onClose,
  onSave,
  resume = null,
  seed = null,
  onDropMissingPath,
}: FromImageModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const spaceHeld = useRef(false)
  const panning = useRef<{
    pointerId: number
    startX: number
    startY: number
    panX: number
    panY: number
  } | null>(null)
  const cropDrag = useRef<CropDrag | null>(null)
  const viewRef = useRef<ViewState>({ fit: 1, zoom: 1, panX: 0, panY: 0 })
  const imageRef = useRef<ImageData | null>(null)
  const picksRef = useRef<PixelColor[]>([])
  const selectedRef = useRef<number | null>(null)
  const fileNameRef = useRef('Image')
  const sourcePathRef = useRef<string | undefined>(undefined)
  const pastRef = useRef<HistorySnap[]>([])
  const futureRef = useRef<HistorySnap[]>([])
  const editingIdRef = useRef<string | null>(null)

  const [image, setImage] = useState<ImageData | null>(null)
  const [fileName, setFileName] = useState('Image')
  const [sourcePath, setSourcePath] = useState<string | undefined>(undefined)
  const [picks, setPicks] = useState<PixelColor[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [sortState, setSortState] = useState<{ key: FromImageSortKey; dir: 1 | -1 } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewState>({ fit: 1, zoom: 1, panX: 0, panY: 0 })
  const [spaceDown, setSpaceDown] = useState(false)
  const [hover, setHover] = useState<{ hex: string; x: number; y: number } | null>(null)
  const [tool, setTool] = useState<Tool>('pick')
  const [cropKind, setCropKind] = useState<CropKind>('rect')
  const [historyTick, setHistoryTick] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)

  viewRef.current = view
  imageRef.current = image
  picksRef.current = picks
  selectedRef.current = selected
  fileNameRef.current = fileName
  sourcePathRef.current = sourcePath
  editingIdRef.current = editingId

  void historyTick

  function clearHistory() {
    pastRef.current = []
    futureRef.current = []
    setHistoryTick((n) => n + 1)
  }

  useEffect(() => {
    if (!open) return
    if (resume) {
      editingIdRef.current = resume.paletteId
      setEditingId(resume.paletteId)
      setImage(cloneImageData(resume.image))
      setPicks(structuredClone(resume.picks))
      setFileName(resume.name || 'Image')
      setSourcePath(resume.sourcePath)
      setSelected(null)
      setSortState(null)
      setError(null)
      setView({ fit: 1, zoom: 1, panX: 0, panY: 0 })
      setHover(null)
      setTool('pick')
      spaceHeld.current = false
      setSpaceDown(false)
      cropDrag.current = null
      pastRef.current = []
      futureRef.current = []
      setHistoryTick((n) => n + 1)
      return
    }

    editingIdRef.current = null
    setEditingId(null)

    if (seed) {
      const seeds = seedPaletteFromImage(seed.image, SEED_COUNT)
      setImage(cloneImageData(seed.image))
      setPicks(seeds)
      setSelected(seeds.length ? 0 : null)
      setFileName(seed.name || 'Image')
      setSourcePath(seed.sourcePath)
      setSortState(null)
      setError(null)
      setView({ fit: 1, zoom: 1, panX: 0, panY: 0 })
      setHover(null)
      setTool('pick')
      spaceHeld.current = false
      setSpaceDown(false)
      cropDrag.current = null
      pastRef.current = []
      futureRef.current = []
      setHistoryTick((n) => n + 1)
      return
    }

    setImage(null)
    setPicks([])
    setSelected(null)
    setFileName('Image')
    setSourcePath(undefined)
    setSortState(null)
    setError(null)
    setView({ fit: 1, zoom: 1, panX: 0, panY: 0 })
    setHover(null)
    setTool('pick')
    spaceHeld.current = false
    setSpaceDown(false)
    cropDrag.current = null
    pastRef.current = []
    futureRef.current = []
    setHistoryTick((n) => n + 1)
  }, [open, resume, seed])

  function pushHistory() {
    const img = imageRef.current
    if (!img) return
    pastRef.current.push({
      image: img,
      picks: structuredClone(picksRef.current),
      selected: selectedRef.current,
    })
    if (pastRef.current.length > MAX_PICK_HISTORY) pastRef.current.shift()
    futureRef.current = []
    setHistoryTick((n) => n + 1)
  }

  function undoHistory() {
    if (pastRef.current.length === 0) return false
    const img = imageRef.current
    if (!img) return false
    const snap = pastRef.current.pop()!
    futureRef.current.push({
      image: img,
      picks: structuredClone(picksRef.current),
      selected: selectedRef.current,
    })
    setImage(snap.image)
    setPicks(snap.picks)
    setSelected(snap.selected)
    setHistoryTick((n) => n + 1)
    return true
  }

  function redoHistory() {
    if (futureRef.current.length === 0) return false
    const img = imageRef.current
    if (!img) return false
    const snap = futureRef.current.pop()!
    pastRef.current.push({
      image: img,
      picks: structuredClone(picksRef.current),
      selected: selectedRef.current,
    })
    setImage(snap.image)
    setPicks(snap.picks)
    setSelected(snap.selected)
    setHistoryTick((n) => n + 1)
    return true
  }

  useEffect(() => {
    const host = canvasRef.current
    if (!host || !image) return
    host.width = image.width
    host.height = image.height
    const ctx = host.getContext('2d')
    if (!ctx) return
    ctx.putImageData(image, 0, 0)
    const overlay = overlayRef.current
    if (overlay) {
      overlay.width = image.width
      overlay.height = image.height
    }
  }, [image])

  useEffect(() => {
    if (!image) return
    const id = requestAnimationFrame(() => fitView(image))
    return () => cancelAnimationFrame(id)
  }, [image])

  useEffect(() => {
    const vp = viewportRef.current
    if (!vp || !image) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = vp!.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const v = viewRef.current
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor))
      const ratio = nextZoom / v.zoom
      setView({
        ...v,
        zoom: nextZoom,
        panX: mx - (mx - v.panX) * ratio,
        panY: my - (my - v.panY) * ratio,
      })
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [image])

  useEffect(() => {
    drawOverlay()
  }, [image, picks, selected])

  function fitView(data: ImageData) {
    const vp = viewportRef.current
    if (!vp) return
    const pad = 16
    const fit = Math.min(
      (vp.clientWidth - pad) / data.width,
      (vp.clientHeight - pad) / data.height,
      1,
    )
    const dw = data.width * fit
    const dh = data.height * fit
    setView({
      fit,
      zoom: 1,
      panX: (vp.clientWidth - dw) / 2,
      panY: (vp.clientHeight - dh) / 2,
    })
  }

  function drawCropPreview(ctx: CanvasRenderingContext2D, drag: CropDrag) {
    ctx.save()
    ctx.lineWidth = Math.max(1, Math.min(ctx.canvas.width, ctx.canvas.height) / 400)
    ctx.setLineDash([ctx.lineWidth * 4, ctx.lineWidth * 3])
    ctx.strokeStyle = '#ffffff'
    ctx.fillStyle = 'rgba(255,255,255,0.12)'

    if (drag.tool === 'freehand') {
      if (drag.points.length > 1) {
        ctx.beginPath()
        ctx.moveTo(drag.points[0].x, drag.points[0].y)
        for (let i = 1; i < drag.points.length; i++) {
          ctx.lineTo(drag.points[i].x, drag.points[i].y)
        }
        ctx.stroke()
        ctx.strokeStyle = '#000000'
        ctx.lineWidth *= 0.6
        ctx.stroke()
      }
      ctx.restore()
      return
    }

    const r = normalizeDragRect(
      drag.startX,
      drag.startY,
      drag.curX,
      drag.curY,
      drag.shift,
    )
    const w = r.right - r.left
    const h = r.bottom - r.top
    if (w < 1 || h < 1) {
      ctx.restore()
      return
    }

    ctx.beginPath()
    if (drag.tool === 'ellipse') {
      ctx.ellipse(
        (r.left + r.right) / 2,
        (r.top + r.bottom) / 2,
        w / 2,
        h / 2,
        0,
        0,
        Math.PI * 2,
      )
    } else {
      ctx.rect(r.left, r.top, w, h)
    }
    ctx.fill()
    ctx.stroke()
    ctx.strokeStyle = '#000000'
    ctx.lineWidth *= 0.6
    ctx.stroke()
    ctx.restore()
  }

  function drawOverlay() {
    const overlay = overlayRef.current
    if (!overlay) return
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, overlay.width, overlay.height)

    const drag = cropDrag.current
    if (drag) drawCropPreview(ctx, drag)

    const list = picksRef.current
    const sel = selectedRef.current
    const markerR = Math.max(5, Math.min(14, overlay.width / 80))

    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      const active = i === sel
      const r = active ? markerR * 1.35 : markerR
      ctx.beginPath()
      ctx.arc(p.x + 0.5, p.y + 0.5, r, 0, Math.PI * 2)
      ctx.fillStyle = p.hex
      ctx.fill()
      ctx.lineWidth = active ? Math.max(2.5, r * 0.35) : Math.max(1.5, r * 0.25)
      ctx.strokeStyle = active ? '#ffffff' : 'rgba(255,255,255,0.85)'
      ctx.stroke()
      ctx.lineWidth = 1
      ctx.strokeStyle = '#000000'
      ctx.stroke()

      ctx.font = `600 ${Math.max(10, Math.round(r))}px "DM Sans", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = contrastInk(p.hex)
      ctx.fillText(String(i + 1), p.x + 0.5, p.y + 0.5)
    }
  }

  function applyImageData(data: ImageData, label: string, path?: string) {
    const seeds = seedPaletteFromImage(data, SEED_COUNT)
    setImage(data)
    setPicks(seeds)
    setSelected(seeds.length ? 0 : null)
    setFileName(label)
    setSourcePath(path)
    setSortState(null)
    setTool('pick')
    cropDrag.current = null
    clearHistory()
  }

  function commitCrop(cropped: ImageData) {
    pushHistory()
    const seeds = seedPaletteFromImage(cropped, SEED_COUNT)
    setImage(cropped)
    setPicks(seeds)
    setSelected(seeds.length ? 0 : null)
    setSortState(null)
    cropDrag.current = null
  }

  async function ingest(file: File, label?: string, path?: string) {
    setError(null)
    try {
      const data = await loadImageFile(file)
      const maxSide = 900
      const scale = Math.min(1, maxSide / Math.max(data.width, data.height))
      const name = (label ?? clipboardImageLabel(file)).replace(/\.[^.]+$/, '') || 'Image'
      if (scale < 1) {
        const w = Math.max(1, Math.round(data.width * scale))
        const h = Math.max(1, Math.round(data.height * scale))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) throw new Error('no ctx')
        const tmp = document.createElement('canvas')
        tmp.width = data.width
        tmp.height = data.height
        tmp.getContext('2d')!.putImageData(data, 0, 0)
        ctx.drawImage(tmp, 0, 0, w, h)
        applyImageData(ctx.getImageData(0, 0, w, h), name, path)
      } else {
        applyImageData(data, name, path)
      }
    } catch {
      setError('Could not read that image.')
    }
  }

  const handleAddRef = useRef(() => {})
  const handleCloseRef = useRef(() => {})

  function handleAdd() {
    const img = imageRef.current
    const currentPicks = picksRef.current
    if (!currentPicks.length || !img) return
    const base = createPalette(
      fileNameRef.current || 'Image',
      currentPicks.map((p) => p.hex),
    )
    const id = editingIdRef.current ?? base.id
    onSave({
      ...base,
      id,
      sourceImage: cloneImageData(img),
      sourcePicks: structuredClone(currentPicks),
      ...(sourcePathRef.current ? { sourcePath: sourcePathRef.current } : {}),
    })
    handleClose()
  }

  function handleClose() {
    onClose()
    setImage(null)
    setPicks([])
    setSelected(null)
    setSortState(null)
    setError(null)
    setFileName('Image')
    setSourcePath(undefined)
    setView({ fit: 1, zoom: 1, panX: 0, panY: 0 })
    setHover(null)
    setTool('pick')
    setEditingId(null)
    editingIdRef.current = null
    spaceHeld.current = false
    setSpaceDown(false)
    cropDrag.current = null
    clearHistory()
  }

  handleAddRef.current = handleAdd
  handleCloseRef.current = handleClose

  useEffect(() => {
    if (!open) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (cropDrag.current) {
          cropDrag.current = null
          drawOverlay()
          e.preventDefault()
          return
        }
        e.preventDefault()
        e.stopImmediatePropagation()
        handleCloseRef.current()
        return
      }

      if (e.key === 'Enter' && !e.isComposing) {
        const t = e.target as HTMLElement | null
        if (t?.tagName === 'SELECT') return
        // Always consume Enter in this dialog so it can't activate the × close button.
        e.preventDefault()
        e.stopImmediatePropagation()
        if (!imageRef.current || !picksRef.current.length) return
        handleAddRef.current()
        return
      }

      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (mod) {
        const target = e.target as HTMLElement | null
        const tag = target?.tagName
        const inField =
          tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(target?.isContentEditable)
        if (!inField && key === 'z' && !e.shiftKey) {
          if (undoHistory()) {
            e.preventDefault()
            e.stopImmediatePropagation()
            return
          }
        }
        if (!inField && key === 'z' && e.shiftKey) {
          if (redoHistory()) {
            e.preventDefault()
            e.stopImmediatePropagation()
            return
          }
        }
      }

      if (e.code === 'Space' && !e.repeat) {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
          return
        }
        e.preventDefault()
        spaceHeld.current = true
        setSpaceDown(true)
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') {
        spaceHeld.current = false
        setSpaceDown(false)
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [open])

  function sheetPoint(e: { clientX: number; clientY: number }) {
    const vp = viewportRef.current
    if (!vp || !imageRef.current) return null
    const rect = vp.getBoundingClientRect()
    const v = viewRef.current
    const scale = v.fit * v.zoom
    if (scale <= 0) return null
    return {
      x: (e.clientX - rect.left - v.panX) / scale,
      y: (e.clientY - rect.top - v.panY) / scale,
    }
  }

  function placeColor(pixel: PixelColor) {
    pushHistory()
    setPicks((prev) => {
      const sel = selectedRef.current
      if (sel !== null && sel >= 0 && sel < prev.length) {
        const next = [...prev]
        next[sel] = pixel
        return next
      }
      setSelected(prev.length)
      return [...prev, pixel]
    })
  }

  function bumpZoom(factor: number) {
    const vp = viewportRef.current
    if (!vp) return
    const mx = vp.clientWidth / 2
    const my = vp.clientHeight / 2
    setView((v) => {
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor))
      const ratio = nextZoom / v.zoom
      return {
        ...v,
        zoom: nextZoom,
        panX: mx - (mx - v.panX) * ratio,
        panY: my - (my - v.panY) * ratio,
      }
    })
  }

  function updateHover(e: { clientX: number; clientY: number }) {
    if (tool !== 'pick' || cropDrag.current) {
      setHover(null)
      return
    }
    const vp = viewportRef.current
    const img = imageRef.current
    if (!vp || !img) {
      setHover(null)
      return
    }
    const pt = sheetPoint(e)
    if (!pt || pt.x < 0 || pt.y < 0 || pt.x >= img.width || pt.y >= img.height) {
      setHover(null)
      return
    }
    const hex = samplePixel(img, pt.x, pt.y)
    if (!hex) {
      setHover(null)
      return
    }
    const rect = vp.getBoundingClientRect()
    setHover({
      hex,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }

  function finishCrop(drag: CropDrag) {
    const img = imageRef.current
    if (!img) return
    let cropped: ImageData | null = null
    if (drag.tool === 'rect') {
      cropped = cropRect(img, drag.startX, drag.startY, drag.curX, drag.curY, drag.shift)
    } else if (drag.tool === 'ellipse') {
      cropped = cropEllipse(img, drag.startX, drag.startY, drag.curX, drag.curY, drag.shift)
    } else {
      cropped = cropFreehand(img, drag.points)
    }
    cropDrag.current = null
    if (cropped) commitCrop(cropped)
    else drawOverlay()
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!image) return
    const wantPan = spaceHeld.current || e.button === 1 || e.altKey
    if (wantPan) {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      panning.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        panX: view.panX,
        panY: view.panY,
      }
      return
    }
    if (e.button !== 0) return
    const pt = sheetPoint(e)
    if (!pt) return
    e.currentTarget.setPointerCapture(e.pointerId)

    if (tool === 'rect' || tool === 'ellipse' || tool === 'freehand') {
      setHover(null)
      cropDrag.current = {
        tool,
        startX: pt.x,
        startY: pt.y,
        curX: pt.x,
        curY: pt.y,
        points: [{ x: pt.x, y: pt.y }],
        shift: e.shiftKey,
      }
      drawOverlay()
      return
    }

    const x = Math.floor(pt.x)
    const y = Math.floor(pt.y)
    const hex = samplePixel(image, x, y)
    if (hex) placeColor({ hex, x, y })
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (panning.current && panning.current.pointerId === e.pointerId) {
      const p = panning.current
      setView((v) => ({
        ...v,
        panX: p.panX + (e.clientX - p.startX),
        panY: p.panY + (e.clientY - p.startY),
      }))
      setHover(null)
      return
    }

    const drag = cropDrag.current
    if (drag) {
      const pt = sheetPoint(e)
      if (pt) {
        drag.curX = pt.x
        drag.curY = pt.y
        drag.shift = e.shiftKey
        if (drag.tool === 'freehand') {
          const last = drag.points[drag.points.length - 1]
          const dx = pt.x - last.x
          const dy = pt.y - last.y
          if (dx * dx + dy * dy >= 2.25) drag.points.push({ x: pt.x, y: pt.y })
        }
        drawOverlay()
      }
      setHover(null)
      return
    }

    updateHover(e)
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (panning.current?.pointerId === e.pointerId) {
      panning.current = null
      return
    }
    const drag = cropDrag.current
    if (drag) {
      const pt = sheetPoint(e)
      if (pt) {
        drag.curX = pt.x
        drag.curY = pt.y
        drag.shift = e.shiftKey
        if (drag.tool === 'freehand') {
          const last = drag.points[drag.points.length - 1]
          if (last.x !== pt.x || last.y !== pt.y) drag.points.push({ x: pt.x, y: pt.y })
        }
      }
      finishCrop(drag)
    }
  }

  function onPointerLeave() {
    if (!panning.current && !cropDrag.current) setHover(null)
  }

  function removeAt(i: number) {
    pushHistory()
    setPicks((prev) => prev.filter((_, idx) => idx !== i))
    setSelected((sel) => {
      if (sel === null) return null
      if (sel === i) return null
      if (sel > i) return sel - 1
      return sel
    })
  }

  function handleSort(key: FromImageSortKey, forceDir?: 1 | -1) {
    const dir: 1 | -1 =
      forceDir ??
      (sortState?.key === key ? (sortState.dir === 1 ? -1 : 1) : 1)
    setSortState({ key, dir })
    pushHistory()
    setPicks((prev) => {
      if (key === 'vertical' || key === 'horizontal') {
        const axis = key === 'vertical' ? 'y' : 'x'
        return [...prev].sort((a, b) => (a[axis] - b[axis]) * dir)
      }
      const order = sortColors(
        prev.map((p) => p.hex),
        key,
        dir,
      )
      const remaining = [...prev]
      const next: PixelColor[] = []
      for (const hex of order) {
        const idx = remaining.findIndex((p) => p.hex === hex)
        if (idx < 0) continue
        next.push(remaining[idx])
        remaining.splice(idx, 1)
      }
      return [...next, ...remaining]
    })
    setSelected(null)
  }

  if (!open) return null

  const displayScale = view.fit * view.zoom
  const frameStyle: React.CSSProperties = {
    transform: `translate(${view.panX}px, ${view.panY}px) scale(${displayScale})`,
    width: image?.width,
    height: image?.height,
  }
  const cropping = tool !== 'pick'

  return (
    <div className="modal-backdrop" role="presentation" onClick={handleClose}>
      <div
        className="modal modal--from-image"
        role="dialog"
        aria-modal="true"
        aria-label="Palette from image"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="from-image__body">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void ingest(f)
            }}
          />

          <div
            ref={viewportRef}
            className={`image-pick__stage from-image__stage ${
              spaceDown ? 'from-image__stage--pan' : ''
            } ${cropping ? 'from-image__stage--crop' : ''}`}
            onDragOver={(e) => {
              if (![...e.dataTransfer.types].includes('Files')) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(e) => {
              if (![...e.dataTransfer.types].includes('Files')) return
              e.preventDefault()
              const file = imageFilesFromDataTransfer(e.dataTransfer)[0]
              if (!file) return
              const path = sourcePathFromDrop(file, e.dataTransfer)
              if (!path) {
                onDropMissingPath?.()
                setError(
                  'No file path from this drag — sourcePath won’t be saved. Paste a path/URL if you need it in metadata.',
                )
              } else {
                setError(null)
              }
              void ingest(file, undefined, path)
            }}
          >
            {image ? (
              <>
                <div className="image-pick__frame from-image__frame" style={frameStyle}>
                  <canvas ref={canvasRef} className="image-pick__canvas from-image__canvas" />
                  <canvas
                    ref={overlayRef}
                    className="image-pick__overlay from-image__overlay"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onPointerLeave={onPointerLeave}
                    onContextMenu={(e) => e.preventDefault()}
                  />
                </div>
                {hover && (
                  <div
                    className="from-image__eyedrop"
                    style={{ left: hover.x + 14, top: hover.y + 14 }}
                    aria-hidden
                  >
                    <div
                      className="from-image__eyedrop-swatch"
                      style={{ background: hover.hex }}
                    />
                    <span className="from-image__eyedrop-hex">{hover.hex}</span>
                  </div>
                )}
              </>
            ) : (
              <p className="modal__empty from-image__empty">
                Upload an image, or paste a file path / image URL (Ctrl+V)
              </p>
            )}

            {image && (
              <div
                className={`from-image__chrome ${tool !== 'pick' ? 'from-image__chrome--crop' : ''}`}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="from-image__crop">
                  <button
                    type="button"
                    className="btn btn--ghost btn--small from-image__crop-main"
                    aria-pressed={tool !== 'pick'}
                    title={
                      tool === 'pick'
                        ? 'Crop (rectangle)'
                        : `Cropping (${cropKind === 'ellipse' ? 'oval' : cropKind === 'freehand' ? 'freehand' : 'rectangle'}) — click to cancel`
                    }
                    onClick={() => {
                      cropDrag.current = null
                      setTool((t) => (t === 'pick' ? cropKind : 'pick'))
                      drawOverlay()
                    }}
                  >
                    Crop
                  </button>
                  <div className="from-image__crop-side">
                    <button
                      type="button"
                      className="btn btn--ghost btn--small from-image__crop-chevron"
                      aria-label="Crop shape"
                      tabIndex={-1}
                    >
                      ▾
                    </button>
                    <div className="from-image__crop-pop" role="menu" aria-label="Crop shape">
                      {(
                        [
                          ['rect', 'Rect'],
                          ['ellipse', 'Oval'],
                          ['freehand', 'Free'],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          role="menuitem"
                          className={`from-image__crop-opt ${
                            cropKind === id ? 'from-image__crop-opt--on' : ''
                          }`}
                          onClick={() => {
                            cropDrag.current = null
                            setCropKind(id)
                            setTool(id)
                            drawOverlay()
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="from-image__zoom" role="group" aria-label="Zoom">
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => bumpZoom(1 / 1.25)}
                    aria-label="Zoom out"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => bumpZoom(1.25)}
                    aria-label="Zoom in"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => fitView(image)}
                  >
                    Fit
                  </button>
                  <span className="from-image__zoom-pct">{Math.round(view.zoom * 100)}%</span>
                </div>
              </div>
            )}
          </div>

          <aside className="from-image__hud">
            <div className="from-image__name">
              <input
                className="modal__name"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                aria-label="Palette name"
              />
              <button
                type="button"
                className="icon-btn from-image__close"
                onClick={handleClose}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="from-image__hud-top">
              <button
                type="button"
                className="btn btn--ghost btn--small from-image__upload"
                onClick={() => fileRef.current?.click()}
                aria-label="Upload image"
                title="Upload image"
              >
                <svg
                  className="from-image__upload-icon"
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
              <div className="from-image__sort" role="group" aria-label="Sort colors">
                <select
                  className="from-image__sort-select"
                  value={sortState?.key ?? 'hue'}
                  disabled={picks.length < 2}
                  aria-label="Sort by"
                  onChange={(e) => handleSort(e.target.value as FromImageSortKey, 1)}
                >
                  <option value="hue">Hue</option>
                  <option value="saturation">Sat</option>
                  <option value="brightness">Bright</option>
                  <option value="vertical">Vertical</option>
                  <option value="horizontal">Horizontal</option>
                </select>
                <button
                  type="button"
                  className="from-image__sort-dir"
                  disabled={picks.length < 2}
                  aria-label={sortState?.dir === -1 ? 'Ascending' : 'Descending'}
                  title="Reverse sort"
                  onClick={() =>
                    handleSort(
                      sortState?.key ?? 'hue',
                      sortState?.dir === 1 ? -1 : 1,
                    )
                  }
                >
                  {sortState?.dir === -1 ? '↓' : '↑'}
                </button>
              </div>
            </div>

            <div className="from-image__swatches">
              {picks.length ? (
                picks.map((pick, i) => (
                  <div
                    key={`${pick.hex}-${pick.x}-${pick.y}-${i}`}
                    className={`from-image__swatch-row ${
                      selected === i ? 'from-image__swatch-row--on' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="from-image__swatch"
                      style={{ background: pick.hex, color: contrastInk(pick.hex) }}
                      onClick={() => setSelected((s) => (s === i ? null : i))}
                      aria-pressed={selected === i}
                      title={
                        selected === i
                          ? 'Selected — click the image to move this color'
                          : 'Select to re-pick from the image'
                      }
                    >
                      <span className="from-image__swatch-n">{i + 1}</span>
                      {pick.hex}
                    </button>
                    <button
                      type="button"
                      className="from-image__remove"
                      onClick={() => removeAt(i)}
                      aria-label={`Remove ${pick.hex}`}
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <p className="modal__empty">Click the image to add colors</p>
              )}
            </div>

            <div className="from-image__hud-foot">
              {error && <span className="modal__error">{error}</span>}
              <button
                type="button"
                className="btn btn--primary btn--small from-image__create"
                disabled={!picks.length}
                onClick={handleAdd}
              >
                {editingId ? 'Update' : 'Create'}
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
