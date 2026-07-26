const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tif|tiff|svg|avif|ico)$/i
const IMAGE_EXT_IN_URL = /\.(png|jpe?g|webp|gif|bmp|tif|tiff|svg|avif|ico)(\?|#|$)/i

export type PastedImageRef =
  | { kind: 'url'; value: string }
  | { kind: 'path'; value: string }

function stripQuotes(text: string): string {
  const t = text.trim()
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1).trim()
  }
  return t
}

/** file:///C:/Users/... → C:\Users\... ; file:///home/... → /home/... */
export function fileUrlToPath(fileUrl: string): string | null {
  try {
    const u = new URL(fileUrl)
    if (u.protocol !== 'file:') return null
    let p = decodeURIComponent(u.pathname)
    // Windows: /C:/Users/... → C:\Users\...
    if (/^\/[a-zA-Z]:\//.test(p)) {
      return p.slice(1).replace(/\//g, '\\')
    }
    return p
  } catch {
    return null
  }
}

function looksLikeHttpUrl(text: string): boolean {
  if (!/^https?:\/\//i.test(text)) return false
  if (/\s/.test(text)) return false
  try {
    const u = new URL(text)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function looksLikeLocalImagePath(text: string): boolean {
  if (text.includes('\n') || text.includes('\r')) return false
  const bare = text.split(/[?#]/)[0] ?? text
  if (!IMAGE_EXT.test(bare)) return false
  // Windows drive path or UNC
  if (/^[a-zA-Z]:[\\/]/.test(text) || /^\\\\[^\\]+\\/.test(text)) return true
  // Unix absolute
  if (text.startsWith('/') && !text.startsWith('//')) return true
  return false
}

/**
 * Parse a single pasted string into an image URL or local filesystem path.
 * Online URLs may omit an image extension; local paths must end in an image ext.
 */
export function parseImageRef(text: string): PastedImageRef | null {
  const raw = stripQuotes(text)
  if (!raw) return null

  if (/^data:image\//i.test(raw)) {
    return { kind: 'url', value: raw }
  }

  if (/^file:\/\//i.test(raw)) {
    const path = fileUrlToPath(raw)
    if (path && IMAGE_EXT.test(path.split(/[?#]/)[0] ?? path)) {
      return { kind: 'path', value: path }
    }
    return null
  }

  if (looksLikeHttpUrl(raw)) {
    return { kind: 'url', value: raw }
  }

  if (looksLikeLocalImagePath(raw)) {
    return { kind: 'path', value: raw }
  }

  return null
}

/** Prefer an <img src> from HTML clipboard when plain text isn't a URL. */
export function parseImageRefFromHtml(html: string): PastedImageRef | null {
  const match =
    html.match(/<img[^>]+src=["']([^"']+)["']/i) ||
    html.match(/src=["'](https?:\/\/[^"']+)["']/i)
  if (!match?.[1]) return null
  return parseImageRef(match[1])
}

/**
 * Best-effort absolute path for a file dropped from the OS.
 * Chromium/Electron may set `File.path`; some drops also include file:// URIs.
 */
export function sourcePathFromDrop(
  file: File,
  data?: DataTransfer | null,
): string | undefined {
  const withPath = file as File & { path?: string }
  if (typeof withPath.path === 'string' && withPath.path.trim()) {
    const p = withPath.path.trim()
    // Require a real absolute path — bare filenames must not count.
    if (looksLikeLocalImagePath(p)) return p
  }

  if (!data) return undefined

  const uriList = (data.getData('text/uri-list') || '').trim()
  if (uriList) {
    for (const line of uriList.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      if (/^file:\/\//i.test(trimmed)) {
        const path = fileUrlToPath(trimmed)
        if (path) return path
      }
      const ref = parseImageRef(trimmed)
      if (ref) return ref.value
    }
  }

  const plain = (data.getData('text/plain') || '').trim()
  if (plain) {
    if (/^file:\/\//i.test(plain)) {
      const path = fileUrlToPath(plain)
      if (path) return path
    }
    const ref = parseImageRef(plain)
    if (ref?.kind === 'path') return ref.value
  }

  return undefined
}

function nameFromUrl(url: string): string {
  try {
    if (url.startsWith('data:')) return 'pasted-image'
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop() || 'image'
    const decoded = decodeURIComponent(last)
    if (IMAGE_EXT_IN_URL.test(decoded) || IMAGE_EXT.test(decoded)) {
      return decoded.split(/[?#]/)[0] || decoded
    }
    return decoded || 'image'
  } catch {
    return 'image'
  }
}

function nameFromPath(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/')
  return norm.split('/').filter(Boolean).pop() || 'image.png'
}

function extFromPath(filePath: string): string {
  const m = filePath.toLowerCase().match(/\.([a-z0-9]+)(?:[?#]|$)/i)
  return m?.[1] || 'png'
}

function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase()
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg'
  if (e === 'svg') return 'image/svg+xml'
  if (e === 'tif' || e === 'tiff') return 'image/tiff'
  if (e === 'ico') return 'image/x-icon'
  return `image/${e}`
}

/**
 * Resolve a pasted URL or absolute path to a File the rest of the app can ingest.
 * Local paths are loaded via the Vite `/__paletter_local` middleware (dev server).
 */
export async function fileFromImageRef(ref: PastedImageRef): Promise<File> {
  if (ref.kind === 'url') {
    let res: Response
    try {
      res = await fetch(ref.value)
    } catch {
      throw new Error(
        'Could not fetch that image URL (network or CORS). Try downloading it and dropping the file instead.',
      )
    }
    if (!res.ok) {
      throw new Error(`Could not fetch image (HTTP ${res.status}).`)
    }
    const blob = await res.blob()
    const type =
      blob.type && blob.type.startsWith('image/')
        ? blob.type
        : mimeFromExt(extFromPath(nameFromUrl(ref.value)))
    if (blob.size <= 0) throw new Error('That URL did not return an image.')
    const name = nameFromUrl(ref.value)
    const ext =
      blob.type && blob.type.startsWith('image/')
        ? blob.type === 'image/jpeg'
          ? 'jpg'
          : blob.type.slice('image/'.length).replace(/[^a-z0-9]+/gi, '') || 'png'
        : extFromPath(name)
    const withExt = IMAGE_EXT.test(name) ? name : `${name}.${ext}`
    return new File([blob], withExt, { type, lastModified: Date.now() })
  }

  const path = ref.value
  const qs = encodeURIComponent(path)
  let res: Response
  try {
    res = await fetch(`/__paletter_local?path=${qs}`)
  } catch {
    throw new Error(
      'Could not open that local path. Run the app with npm run dev, or copy/drag the file itself.',
    )
  }
  if (res.status === 404) {
    throw new Error('No file found at that path.')
  }
  if (res.status === 400) {
    throw new Error('That path is not a supported image file.')
  }
  if (!res.ok) {
    throw new Error(
      'Local paths only work while the dev server is running (npm run dev). Copy or drag the file instead.',
    )
  }
  const blob = await res.blob()
  const name = nameFromPath(path)
  const type = blob.type || mimeFromExt(extFromPath(name))
  return new File([blob], name, { type, lastModified: Date.now() })
}

export function pastedTextFromDataTransfer(
  data: DataTransfer | null | undefined,
): string {
  if (!data) return ''
  return (data.getData('text/plain') || '').trim()
}

export function pastedHtmlFromDataTransfer(
  data: DataTransfer | null | undefined,
): string {
  if (!data) return ''
  return data.getData('text/html') || ''
}
