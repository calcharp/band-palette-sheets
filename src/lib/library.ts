import { uid } from './palette'

const META_KEY = 'paletter.library.v1'
const IDB_NAME = 'paletter-library'
const IDB_STORE = 'handles'
const MAX_HISTORY = 60

export interface LibraryFolder {
  id: string
  name: string
  /** Parent folder id, or null for root. */
  parentId: string | null
}

export interface LibraryEntry {
  id: string
  /** Display name in the library (usually sheet title). */
  name: string
  /** Folder to nest under, or null for root. */
  folderId: string | null
  /** Suggested / last-known file name (e.g. MySheet.png). */
  fileName: string
  addedAt: number
}

export interface LibraryMeta {
  folders: LibraryFolder[]
  entries: LibraryEntry[]
}

function emptyMeta(): LibraryMeta {
  return { folders: [], entries: [] }
}

function cloneMeta(meta: LibraryMeta): LibraryMeta {
  return {
    folders: meta.folders.map((f) => ({ ...f })),
    entries: meta.entries.map((e) => ({ ...e })),
  }
}

const past: LibraryMeta[] = []
const future: LibraryMeta[] = []

export function loadLibraryMeta(): LibraryMeta {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return emptyMeta()
    const data = JSON.parse(raw) as Partial<LibraryMeta>
    return {
      folders: Array.isArray(data.folders) ? data.folders : [],
      entries: Array.isArray(data.entries) ? data.entries : [],
    }
  } catch {
    return emptyMeta()
  }
}

export function saveLibraryMeta(meta: LibraryMeta): void {
  localStorage.setItem(META_KEY, JSON.stringify(meta))
}

function entryIdsIn(meta: LibraryMeta, into: Set<string>) {
  for (const e of meta.entries) into.add(e.id)
}

function allRememberedEntryIds(): Set<string> {
  const ids = new Set<string>()
  entryIdsIn(loadLibraryMeta(), ids)
  for (const snap of past) entryIdsIn(snap, ids)
  for (const snap of future) entryIdsIn(snap, ids)
  return ids
}

/** Apply a mutation and push the previous meta onto the undo stack. */
function commitLibraryChange(mutate: (meta: LibraryMeta) => void): LibraryMeta {
  const before = loadLibraryMeta()
  past.push(cloneMeta(before))
  if (past.length > MAX_HISTORY) past.shift()
  future.length = 0
  const meta = cloneMeta(before)
  mutate(meta)
  saveLibraryMeta(meta)
  void pruneOrphanHandles()
  return meta
}

export function canUndoLibrary(): boolean {
  return past.length > 0
}

export function canRedoLibrary(): boolean {
  return future.length > 0
}

export function undoLibrary(): boolean {
  if (past.length === 0) return false
  const current = loadLibraryMeta()
  const prev = past.pop()!
  future.push(cloneMeta(current))
  saveLibraryMeta(prev)
  return true
}

export function redoLibrary(): boolean {
  if (future.length === 0) return false
  const current = loadLibraryMeta()
  const next = future.pop()!
  past.push(cloneMeta(current))
  saveLibraryMeta(next)
  return true
}

export function createLibraryFolder(name: string, parentId: string | null = null): LibraryFolder {
  let created!: LibraryFolder
  commitLibraryChange((meta) => {
    created = {
      id: uid('libfold'),
      name: name.trim() || 'Folder',
      parentId,
    }
    meta.folders.push(created)
  })
  return created
}

export function renameLibraryFolder(id: string, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  const current = loadLibraryMeta().folders.find((f) => f.id === id)
  if (!current || current.name === trimmed) return
  commitLibraryChange((meta) => {
    const folder = meta.folders.find((f) => f.id === id)
    if (folder) folder.name = trimmed
  })
}

export function deleteLibraryFolder(id: string): void {
  if (!loadLibraryMeta().folders.some((f) => f.id === id)) return
  commitLibraryChange((meta) => {
    const doomed = new Set<string>()
    const walk = (fid: string) => {
      doomed.add(fid)
      for (const f of meta.folders) {
        if (f.parentId === fid) walk(f.id)
      }
    }
    walk(id)
    meta.folders = meta.folders.filter((f) => !doomed.has(f.id))
    meta.entries = meta.entries.map((e) =>
      e.folderId && doomed.has(e.folderId) ? { ...e, folderId: null } : e,
    )
  })
}

export function addLibraryEntry(input: {
  name: string
  folderId: string | null
  fileName: string
}): LibraryEntry {
  let created!: LibraryEntry
  commitLibraryChange((meta) => {
    created = {
      id: uid('libent'),
      name: input.name.trim() || input.fileName.replace(/\.png$/i, '') || 'Untitled',
      folderId: input.folderId,
      fileName: input.fileName,
      addedAt: Date.now(),
    }
    meta.entries.unshift(created)
  })
  return created
}

export function moveLibraryEntry(id: string, folderId: string | null): void {
  const entry = loadLibraryMeta().entries.find((e) => e.id === id)
  if (!entry || entry.folderId === folderId) return
  commitLibraryChange((meta) => {
    const e = meta.entries.find((x) => x.id === id)
    if (e) e.folderId = folderId
  })
}

/** True if `candidateId` is `folderId` or nested under it. */
export function isLibraryFolderWithin(
  folders: LibraryFolder[],
  folderId: string,
  candidateId: string,
): boolean {
  let cur: string | null = candidateId
  while (cur) {
    if (cur === folderId) return true
    cur = folders.find((f) => f.id === cur)?.parentId ?? null
  }
  return false
}

export function moveLibraryFolder(id: string, parentId: string | null): void {
  const folder = loadLibraryMeta().folders.find((f) => f.id === id)
  if (!folder) return
  if (folder.parentId === parentId) return
  if (parentId != null && isLibraryFolderWithin(loadLibraryMeta().folders, id, parentId)) {
    return
  }
  commitLibraryChange((meta) => {
    const f = meta.folders.find((x) => x.id === id)
    if (!f) return
    if (parentId != null && isLibraryFolderWithin(meta.folders, id, parentId)) return
    f.parentId = parentId
  })
}

export function renameLibraryEntry(id: string, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  const current = loadLibraryMeta().entries.find((e) => e.id === id)
  if (!current || current.name === trimmed) return
  commitLibraryChange((meta) => {
    const entry = meta.entries.find((e) => e.id === id)
    if (entry) entry.name = trimmed
  })
}

export function removeLibraryEntry(id: string): void {
  if (!loadLibraryMeta().entries.some((e) => e.id === id)) return
  commitLibraryChange((meta) => {
    meta.entries = meta.entries.filter((e) => e.id !== id)
  })
  // Keep the file handle so undo can reopen the sheet; prune drops it once
  // the entry is no longer in present/past/future.
  void pruneOrphanHandles()
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

export async function storeFileHandle(
  entryId: string,
  handle: FileSystemFileHandle,
): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(handle, entryId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
  })
  db.close()
}

export async function loadFileHandle(
  entryId: string,
): Promise<FileSystemFileHandle | null> {
  try {
    const db = await openDb()
    const handle = await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(entryId)
      req.onsuccess = () => resolve((req.result as FileSystemFileHandle | undefined) ?? null)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
    })
    db.close()
    return handle
  } catch {
    return null
  }
}

async function pruneOrphanHandles(): Promise<void> {
  try {
    const keep = allRememberedEntryIds()
    const db = await openDb()
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).getAllKeys()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB keys failed'))
    })
    const orphans = keys.filter((k) => typeof k === 'string' && !keep.has(k))
    if (orphans.length) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite')
        const store = tx.objectStore(IDB_STORE)
        for (const key of orphans) store.delete(key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB prune failed'))
      })
    }
    db.close()
  } catch {
    // ignore
  }
}

export function foldersInParent(
  folders: LibraryFolder[],
  parentId: string | null,
): LibraryFolder[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function entriesInFolder(
  entries: LibraryEntry[],
  folderId: string | null,
): LibraryEntry[] {
  return entries
    .filter((e) => e.folderId === folderId)
    .sort((a, b) => b.addedAt - a.addedAt)
}
