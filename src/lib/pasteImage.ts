import {
  fileFromImageRef,
  parseImageRef,
  parseImageRefFromHtml,
  pastedHtmlFromDataTransfer,
  pastedTextFromDataTransfer,
  type PastedImageRef,
} from './imageRef'

function inTextField(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(t.isContentEditable)
}

export type ImagePasteHandlers = {
  /** True when From image modal is open — paste always applies there. */
  isFromImageOpen: () => boolean
  /** True when the sheet was the last click target. */
  isSheetActive: () => boolean
  /** Load an image that came from a pasted local path or URL. */
  onPathImage: (file: File, sourcePath: string) => void
  onError?: (message: string) => void
}

const PATH_ONLY_HINT =
  'Paste a local file path or image URL — copied screenshots/images are not accepted.'

/**
 * Ctrl/Cmd+V and paste: only absolute paths and image URLs (so sourcePath
 * can be stored in sheet metadata). Bitmap / file clipboard payloads are ignored.
 */
export function attachImagePasteListeners(handlers: ImagePasteHandlers): () => void {
  let lock = false

  function shouldHandle(target: EventTarget | null): boolean {
    if (handlers.isFromImageOpen()) return true
    if (!handlers.isSheetActive()) return false
    if (inTextField(target)) return false
    return true
  }

  async function deliverRef(ref: PastedImageRef): Promise<boolean> {
    if (lock) return false
    const allow = handlers.isFromImageOpen() || handlers.isSheetActive()
    if (!allow) return false
    lock = true
    try {
      const file = await fileFromImageRef(ref)
      handlers.onPathImage(file, ref.value)
      return true
    } catch (e) {
      handlers.onError?.(e instanceof Error ? e.message : 'Could not load that image.')
      return true
    } finally {
      window.setTimeout(() => {
        lock = false
      }, 400)
    }
  }

  async function deliverTextRef(text: string, html?: string): Promise<boolean> {
    const ref = parseImageRef(text) || (html ? parseImageRefFromHtml(html) : null)
    if (!ref) return false
    return deliverRef(ref)
  }

  function onPaste(e: ClipboardEvent) {
    if (!shouldHandle(e.target)) return

    const text = pastedTextFromDataTransfer(e.clipboardData)
    const html = pastedHtmlFromDataTransfer(e.clipboardData)
    if (parseImageRef(text) || parseImageRefFromHtml(html)) {
      e.preventDefault()
      e.stopImmediatePropagation()
      void deliverTextRef(text, html)
      return
    }

    // Reject raw image / file pastes so users paste a path instead.
    const types = Array.from(e.clipboardData?.types ?? [])
    const items = Array.from(e.clipboardData?.items ?? [])
    const claimsImage =
      types.some((t) => t === 'Files' || t.startsWith('image/')) ||
      items.some((i) => i.kind === 'file' || i.type.startsWith('image/'))
    if (claimsImage) {
      e.preventDefault()
      e.stopImmediatePropagation()
      handlers.onError?.(PATH_ONLY_HINT)
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.repeat) return
    const key = e.key.toLowerCase()
    if (key !== 'v' && e.code !== 'KeyV') return
    if (!shouldHandle(e.target)) return

    // Prefer clipboard text (path/URL) during the key gesture.
    const pendingText = navigator.clipboard?.readText?.() ?? Promise.resolve('')
    void pendingText.then(
      async (raw) => {
        if (lock) return
        const clipText = raw.trim()
        if (!clipText) return
        if (parseImageRef(clipText)) {
          await deliverTextRef(clipText)
        }
      },
      () => {
        // ignore
      },
    )
  }

  document.addEventListener('paste', onPaste, true)
  window.addEventListener('keydown', onKeyDown, true)
  return () => {
    document.removeEventListener('paste', onPaste, true)
    window.removeEventListener('keydown', onKeyDown, true)
  }
}
