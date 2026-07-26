import { hexToHsb, hsbToHex, parseHex } from '../lib/palette'
import { ColorWheel } from './ColorWheel'

interface ColorPickerProps {
  value: string
  onChange: (hex: string) => void
  /** Optional class on the root. */
  className?: string
}

export function ColorPicker({ value, onChange, className = '' }: ColorPickerProps) {
  const valid = parseHex(value) ?? '#000000'
  const hsb = hexToHsb(valid)

  function setHsb(patch: Partial<{ h: number; s: number; b: number }>) {
    const next = { ...hsb, ...patch }
    onChange(hsbToHex(next.h, next.s, next.b))
  }

  return (
    <div className={`color-picker ${className}`.trim()}>
      <div className="color-picker__wheel-pane">
        <div className="color-picker__wheel-wrap">
          <ColorWheel hex={valid} onChange={onChange} size={220} />
        </div>
        <label className="color-picker__bright">
          <span>Brightness</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(hsb.b * 100)}
            onChange={(e) => setHsb({ b: Number(e.target.value) / 100 })}
            style={{
              background: `linear-gradient(to right, #000, ${hsbToHex(hsb.h, hsb.s, 1)})`,
            }}
            aria-label="Brightness"
          />
          <em>{Math.round(hsb.b * 100)}</em>
        </label>
        <div className="color-picker__hsb">
          <label>
            <span>H</span>
            <input
              type="range"
              min={0}
              max={360}
              value={Math.round(hsb.h)}
              onChange={(e) => setHsb({ h: Number(e.target.value) })}
              aria-label="Hue"
            />
            <em>{Math.round(hsb.h)}</em>
          </label>
          <label>
            <span>S</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(hsb.s * 100)}
              onChange={(e) => setHsb({ s: Number(e.target.value) / 100 })}
              aria-label="Saturation"
            />
            <em>{Math.round(hsb.s * 100)}</em>
          </label>
          <label>
            <span>Hex</span>
            <input
              className="color-picker__hex"
              value={value}
              spellCheck={false}
              onChange={(e) => onChange(e.target.value)}
              onBlur={(e) => {
                const ok = parseHex(e.target.value)
                if (ok) onChange(ok)
              }}
              aria-label="Hex color"
            />
          </label>
        </div>
      </div>
    </div>
  )
}
