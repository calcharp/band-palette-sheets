import { useEffect, useRef } from 'react'
import { hexToHsb, hsbToHex, parseHex } from '../lib/palette'

interface ColorWheelProps {
  hex: string
  onChange: (hex: string) => void
  size?: number
}

/** Circular HSV picker: angle = hue, radius = saturation. */
export function ColorWheel({ hex, onChange, size = 220 }: ColorWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragging = useRef(false)
  const hsb = hexToHsb(parseHex(hex) ?? hex)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = size
    canvas.height = size

    const cx = size / 2
    const cy = size / 2
    const radius = size / 2 - 3
    const img = ctx.createImageData(size, size)
    const data = img.data

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx + 0.5
        const dy = y - cy + 0.5
        const dist = Math.hypot(dx, dy)
        const i = (y * size + x) * 4
        if (dist > radius) {
          data[i + 3] = 0
          continue
        }
        let hue = (Math.atan2(dy, dx) * 180) / Math.PI
        if (hue < 0) hue += 360
        const sat = Math.min(1, dist / radius)
        const color = hsbToHex(hue, sat, hsb.b)
        data[i] = parseInt(color.slice(1, 3), 16)
        data[i + 1] = parseInt(color.slice(3, 5), 16)
        data[i + 2] = parseInt(color.slice(5, 7), 16)
        data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)

    const mr = hsb.s * radius
    const rad = (hsb.h * Math.PI) / 180
    const mx = cx + Math.cos(rad) * mr
    const my = cy + Math.sin(rad) * mr
    ctx.beginPath()
    ctx.arc(mx, my, 9, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'
    ctx.fill()
    ctx.strokeStyle = 'rgba(28,25,23,0.55)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(mx, my, 5.5, 0, Math.PI * 2)
    ctx.fillStyle = parseHex(hex) ?? hex
    ctx.fill()
  }, [hex, hsb.h, hsb.s, hsb.b, size])

  function pick(clientX: number, clientY: number) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * size
    const y = ((clientY - rect.top) / rect.height) * size
    const cx = size / 2
    const cy = size / 2
    const radius = size / 2 - 3
    const dx = x - cx
    const dy = y - cy
    const dist = Math.hypot(dx, dy)
    let hue = (Math.atan2(dy, dx) * 180) / Math.PI
    if (hue < 0) hue += 360
    const sat = Math.min(1, dist / radius)
    onChange(hsbToHex(hue, sat, hsb.b))
  }

  return (
    <canvas
      ref={canvasRef}
      className="color-wheel"
      style={{ width: size, height: size }}
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        pick(e.clientX, e.clientY)
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        pick(e.clientX, e.clientY)
      }}
      onPointerUp={() => {
        dragging.current = false
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
    />
  )
}
