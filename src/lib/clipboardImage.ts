const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tif|tiff)$/i

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  // Explorer / some OS copies leave type empty and only set the name.
  if (!file.type && IMAGE_EXT.test(file.name)) return true
  return IMAGE_EXT.test(file.name)
}

/** Windows-style screenshot title when the clipboard has a bare bitmap. */
export function screenshotStyleName(when = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `Screenshot ${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())} ${p(when.getHours())}${p(when.getMinutes())}${p(when.getSeconds())}`
}

/** Prefer real file names; fall back to a Screenshot-style label for anonymous clipboard bitmaps. */
export function clipboardImageLabel(file: File): string {
  const raw = (file.name || '').trim()
  const base = raw.replace(/\.[^.]+$/, '')
  if (base && !/^(image|blob|paste|download|clipboard)$/i.test(base)) return base
  return screenshotStyleName()
}

/**
 * Collect image files from a paste/drop DataTransfer.
 * Prefers `files` (Explorer copy) so names match the real file.
 */
export function imageFilesFromDataTransfer(data: DataTransfer | null | undefined): File[] {
  if (!data) return []

  const out: File[] = []
  const seen = new Set<string>()

  const push = (file: File | null | undefined) => {
    if (!file) return
    if (!isImageFile(file)) return
    const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(file)
  }

  if (data.files?.length) {
    for (const file of Array.from(data.files)) push(file)
  }

  if (data.items?.length) {
    for (const item of Array.from(data.items)) {
      // kind "file" OR explicit image MIME (some browsers differ on screenshots).
      if (item.kind !== 'file' && !item.type.startsWith('image/')) continue
      push(item.getAsFile() ?? undefined)
    }
  }

  return out
}

function extForImageType(type: string): string {
  if (type === 'image/jpeg') return 'jpg'
  if (type === 'image/svg+xml') return 'svg'
  const sub = type.split('/')[1] || 'png'
  return sub.replace(/[^a-z0-9]+/gi, '') || 'png'
}

/**
 * Read image blobs from the async Clipboard API (Chromium).
 * This is the reliable path for Win+Shift+S / Snipping Tool screenshots
 * when the paste event's DataTransfer is empty.
 */
export async function readImagesFromClipboard(): Promise<File[]> {
  const { files } = await readImagesFromClipboardDetailed()
  return files
}

export async function readImagesFromClipboardDetailed(): Promise<{
  files: File[]
  denied: boolean
}> {
  if (!navigator.clipboard?.read) return { files: [], denied: false }
  try {
    const items = await navigator.clipboard.read()
    const files: File[] = []
    for (const item of items) {
      // Prefer PNG when the OS offers several representations.
      const types = item.types.filter((t) => t.startsWith('image/'))
      types.sort((a, b) => Number(b === 'image/png') - Number(a === 'image/png'))
      for (const type of types) {
        try {
          const blob = await item.getType(type)
          if (!blob || blob.size <= 0) continue
          const ext = extForImageType(type)
          files.push(
            new File([blob], `${screenshotStyleName()}.${ext}`, {
              type: blob.type || type,
              lastModified: Date.now(),
            }),
          )
          break
        } catch {
          // Ignore unreadable representations.
        }
      }
    }
    return { files, denied: false }
  } catch (e) {
    const denied =
      e instanceof DOMException &&
      (e.name === 'NotAllowedError' || e.name === 'SecurityError')
    return { files: [], denied }
  }
}
