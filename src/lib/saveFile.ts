/** Suggested download/save filename from the sheet title. */
export function suggestedPngFileName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\.+$/g, '')
  return cleaned ? `${cleaned}.png` : '.png'
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export async function writeBlobToFileHandle(
  handle: FileSystemFileHandle,
  blob: Blob,
): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
}

/**
 * Save a PNG blob. Uses the File System Access API when available so a
 * remembered handle can overwrite later; falls back to a download otherwise.
 * Returns the file handle when one was obtained (null on cancel / fallback).
 */
export async function savePngBlob(
  blob: Blob,
  suggestedName: string,
  existingHandle: FileSystemFileHandle | null,
): Promise<FileSystemFileHandle | null> {
  const picker =
    typeof window !== 'undefined' && 'showSaveFilePicker' in window
      ? window.showSaveFilePicker.bind(window)
      : null

  if (existingHandle) {
    try {
      const perm = await existingHandle.queryPermission({ mode: 'readwrite' })
      if (perm === 'granted' || (await existingHandle.requestPermission({ mode: 'readwrite' })) === 'granted') {
        await writeBlobToFileHandle(existingHandle, blob)
        return existingHandle
      }
    } catch {
      // Fall through to pick / download.
    }
  }

  if (picker) {
    try {
      const handle = await picker({
        suggestedName,
        types: [
          {
            description: 'PNG image',
            accept: { 'image/png': ['.png'] },
          },
        ],
      })
      await writeBlobToFileHandle(handle, blob)
      return handle
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return existingHandle
      throw e
    }
  }

  triggerDownload(blob, suggestedName.endsWith('.png') ? suggestedName : `${suggestedName}.png`)
  return null
}
