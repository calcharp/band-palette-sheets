import { useEffect } from 'react'
import { ColorPicker } from './ColorPicker'

interface ColorPanelProps {
  hex: string
  paletteName: string
  embedded?: boolean
  onChange: (hex: string) => void
  onClose: () => void
}

export function ColorPanel({
  hex,
  paletteName,
  embedded = false,
  onChange,
  onClose,
}: ColorPanelProps) {
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
      className={`color-panel ${embedded ? 'color-panel--embedded' : ''}`}
      aria-label="Color editor"
    >
      {embedded ? (
        <div className="color-panel__hud">
          <button
            type="button"
            className="color-panel__back"
            onClick={onClose}
            aria-label="Back to palette"
          >
            ←
          </button>
          <div className="color-panel__hud-label">
            <span className="color-panel__hud-name">{paletteName}</span>
            <span className="color-panel__hud-hex">{hex}</span>
          </div>
        </div>
      ) : (
        <header className="color-panel__head">
          <div>
            <p className="color-panel__eyebrow">Edit color</p>
            <h2 className="color-panel__title">{paletteName}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
      )}

      <ColorPicker value={hex} onChange={onChange} />

      {!embedded && (
        <button type="button" className="btn btn--primary color-panel__done" onClick={onClose}>
          Done
        </button>
      )}
    </aside>
  )
}
