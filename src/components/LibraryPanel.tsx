import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  addLibraryEntry,
  canRedoLibrary,
  canUndoLibrary,
  createLibraryFolder,
  deleteLibraryFolder,
  entriesInFolder,
  foldersInParent,
  isLibraryFolderWithin,
  loadEntryThumb,
  loadFileHandle,
  loadLibraryMeta,
  makeLibraryPreview,
  moveLibraryEntry,
  moveLibraryFolder,
  redoLibrary,
  removeLibraryEntry,
  renameLibraryEntry,
  renameLibraryFolder,
  storeEntryThumb,
  storeFileHandle,
  undoLibrary,
  type LibraryEntry,
  type LibraryMeta,
} from '../lib/library'

interface LibraryPanelProps {
  /** When true, refresh meta from storage (e.g. tab became active). */
  active?: boolean
  /** Save the currently open sheet (if needed), then return handle + names for library. */
  onAddCurrentSheet: (folderId: string | null) => Promise<{
    name: string
    fileName: string
    handle: FileSystemFileHandle | null
    preview?: Blob | null
  } | null>
  /** Pick an existing Paletter PNG from disk for the library (does not touch the open sheet). */
  onAddPngFile: (folderId: string | null) => Promise<{
    name: string
    fileName: string
    handle: FileSystemFileHandle | null
    preview?: Blob | null
  } | null>
  onOpenEntry: (entry: LibraryEntry) => void
  onOpenFolder: (folderId: string | null) => void
  /** Called after the current sheet is added as a library entry. */
  onLinkedEntry?: (entryId: string) => void
  addBusy?: boolean
  openSheets: {
    id: string
    label: string
    libraryEntryId: string | null
    handle: FileSystemFileHandle | null
  }[]
  activeSheetId: string
  onSelectSheet: (id: string) => void
  onCloseSheet: (id: string) => void
  onNewSheet: () => void
  onRevealEntry: (entry: LibraryEntry) => void
}

type Draft =
  | { kind: 'folder'; parentId: string | null; name: string }
  | { kind: 'rename-folder'; id: string; name: string }
  | { kind: 'rename-entry'; id: string; name: string }

type DragPayload =
  | { kind: 'folder'; id: string }
  | { kind: 'entry'; id: string }

const DND_MIME = 'application/x-paletter-library'
const ROOT_KEY = '__root__'

/** Drop onto a folder id, or null for library root. */
type DropTarget = string | null

export function LibraryPanel({
  active = true,
  onAddCurrentSheet,
  onAddPngFile,
  onOpenEntry,
  onOpenFolder,
  onLinkedEntry,
  addBusy = false,
  openSheets,
  activeSheetId,
  onSelectSheet,
  onCloseSheet,
  onNewSheet,
  onRevealEntry,
}: LibraryPanelProps) {
  const [meta, setMeta] = useState<LibraryMeta>(() => loadLibraryMeta())
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT_KEY]))
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [dragging, setDragging] = useState<DragPayload | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | undefined>(undefined)

  useEffect(() => {
    if (!active) return
    setMeta(loadLibraryMeta())
    setDraft(null)
    setMenuId(null)
    setDragging(null)
    setDropTarget(undefined)
  }, [active])

  useEffect(() => {
    if (!active) return
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement | null
      if (!t?.closest('.library-menu, .library-row__more')) {
        setMenuId(null)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [active])

  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return

      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        if (!canUndoLibrary()) return
        e.preventDefault()
        e.stopImmediatePropagation()
        undoLibrary()
        setMeta(loadLibraryMeta())
        setDraft(null)
        setMenuId(null)
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        if (!canRedoLibrary()) return
        e.preventDefault()
        e.stopImmediatePropagation()
        redoLibrary()
        setMeta(loadLibraryMeta())
        setDraft(null)
        setMenuId(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active])

  function refresh() {
    setMeta(loadLibraryMeta())
  }

  function folderKey(folderId: string | null) {
    return folderId ?? ROOT_KEY
  }

  function toggleExpanded(folderId: string | null) {
    const key = folderKey(folderId)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function ensureExpanded(folderId: string | null) {
    const key = folderKey(folderId)
    setExpanded((prev) => {
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }

  function commitDraft() {
    if (!draft) return
    if (draft.kind === 'folder') {
      const name = draft.name.trim() || 'New folder'
      const folder = createLibraryFolder(name, draft.parentId)
      ensureExpanded(draft.parentId)
      setExpanded((prev) => new Set(prev).add(folder.id))
      setSelectedFolderId(folder.id)
    } else if (draft.kind === 'rename-folder') {
      renameLibraryFolder(draft.id, draft.name.trim() || 'Untitled folder')
    } else {
      renameLibraryEntry(draft.id, draft.name.trim() || 'Untitled')
    }
    setDraft(null)
    refresh()
  }

  function cancelDraft() {
    setDraft(null)
  }

  async function addEntryFrom(source: 'current' | 'png', folderId: string | null) {
    if (busy || addBusy) return
    setBusy(true)
    setMenuId(null)
    try {
      const result =
        source === 'current'
          ? await onAddCurrentSheet(folderId)
          : await onAddPngFile(folderId)
      if (!result) return
      const entry = addLibraryEntry({
        name: result.name,
        folderId,
        fileName: result.fileName,
      })
      if (result.handle) {
        await storeFileHandle(entry.id, result.handle, result.preview)
      } else if (result.preview) {
        await storeEntryThumb(entry.id, await makeLibraryPreview(result.preview))
      }
      if (source === 'current') onLinkedEntry?.(entry.id)
      ensureExpanded(folderId)
      setSelectedFolderId(folderId)
      refresh()
    } finally {
      setBusy(false)
    }
  }

  function canDropOn(target: DropTarget): boolean {
    if (!dragging) return false
    if (dragging.kind === 'entry') {
      const entry = meta.entries.find((e) => e.id === dragging.id)
      if (!entry) return false
      return entry.folderId !== target
    }
    if (target === dragging.id) return false
    if (target != null && isLibraryFolderWithin(meta.folders, dragging.id, target)) {
      return false
    }
    const folder = meta.folders.find((f) => f.id === dragging.id)
    if (!folder) return false
    return folder.parentId !== target
  }

  function applyDrop(target: DropTarget) {
    if (!dragging || !canDropOn(target)) return
    if (dragging.kind === 'entry') {
      moveLibraryEntry(dragging.id, target)
    } else {
      moveLibraryFolder(dragging.id, target)
      ensureExpanded(target)
    }
    refresh()
  }

  function onDragEnd() {
    setDragging(null)
    setDropTarget(undefined)
  }

  const folderHandlers = {
    onSelectFolder: setSelectedFolderId,
    onToggle: toggleExpanded,
    onEnsureExpanded: ensureExpanded,
    onOpenEntry,
    onOpenFolder,
    onRevealEntry,
    onAddOpenSheet: (folderId: string | null) => void addEntryFrom('current', folderId),
    onAddPng: (folderId: string | null) => void addEntryFrom('png', folderId),
    addBusy: busy || addBusy,
    onSetDraft: setDraft,
    onSetMenuId: setMenuId,
    onCommitDraft: commitDraft,
    onCancelDraft: cancelDraft,
    onRefresh: refresh,
    onDragStart: (payload: DragPayload) => setDragging(payload),
    onDragEnd,
    onSetDropTarget: setDropTarget,
    onDropOn: applyDrop,
  }

  return (
    <div className="library-panel">
      <div
        className={`library-tree ${dragging ? 'library-tree--dragging' : ''}`}
        role="tree"
        aria-label="Library folders and sheets"
      >
        <FolderBranch
          folderId={null}
          folderName="Root"
          depth={0}
          meta={meta}
          selectedFolderId={selectedFolderId}
          expanded={expanded}
          draft={draft}
          menuId={menuId}
          dragging={dragging}
          dropTarget={dropTarget}
          canDropOn={canDropOn}
          {...folderHandlers}
        />
      </div>

      <div className="library-open">
        <div className="library-open__head">
          <span className="library-open__title">Open</span>
          <button
            type="button"
            className="library-open__new"
            onClick={onNewSheet}
            title="New sheet"
          >
            + New
          </button>
        </div>
        <ul className="library-open__list" aria-label="Open sheets">
          {openSheets.map((sheet) => {
            const activeSheet = sheet.id === activeSheetId
            return (
              <li key={sheet.id}>
                <div
                  className={`library-open__row ${
                    activeSheet ? 'library-open__row--active' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="library-open__main"
                    onClick={() => onSelectSheet(sheet.id)}
                  >
                    <SheetThumb
                      entryId={sheet.libraryEntryId}
                      fileHandle={sheet.handle}
                      label={sheet.label}
                    />
                    <span className="library-open__label">{sheet.label}</span>
                  </button>
                  <button
                    type="button"
                    className="library-open__close"
                    aria-label={`Close ${sheet.label}`}
                    title="Close"
                    onClick={() => onCloseSheet(sheet.id)}
                  >
                    ×
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function FolderBranch({
  folderId,
  folderName,
  depth,
  meta,
  selectedFolderId,
  expanded,
  draft,
  menuId,
  dragging,
  dropTarget,
  canDropOn,
  onSelectFolder,
  onToggle,
  onEnsureExpanded,
  onOpenEntry,
  onOpenFolder,
  onRevealEntry,
  onAddOpenSheet,
  onAddPng,
  addBusy: folderAddBusy,
  onSetDraft,
  onSetMenuId,
  onCommitDraft,
  onCancelDraft,
  onRefresh,
  onDragStart,
  onDragEnd,
  onSetDropTarget,
  onDropOn,
}: {
  folderId: string | null
  folderName: string
  depth: number
  meta: LibraryMeta
  selectedFolderId: string | null
  expanded: Set<string>
  draft: Draft | null
  menuId: string | null
  dragging: DragPayload | null
  dropTarget: DropTarget | undefined
  canDropOn: (target: DropTarget) => boolean
  onSelectFolder: (id: string | null) => void
  onToggle: (id: string | null) => void
  onEnsureExpanded: (id: string | null) => void
  onOpenEntry: (entry: LibraryEntry) => void
  onOpenFolder: (folderId: string | null) => void
  onRevealEntry: (entry: LibraryEntry) => void
  onAddOpenSheet: (folderId: string | null) => void
  onAddPng: (folderId: string | null) => void
  addBusy: boolean
  onSetDraft: (d: Draft | null) => void
  onSetMenuId: (id: string | null) => void
  onCommitDraft: () => void
  onCancelDraft: () => void
  onRefresh: () => void
  onDragStart: (payload: DragPayload) => void
  onDragEnd: () => void
  onSetDropTarget: (target: DropTarget | undefined) => void
  onDropOn: (target: DropTarget) => void
}) {
  const isRoot = folderId === null
  const key = folderId ?? ROOT_KEY
  const isExpanded = expanded.has(key)
  const childFolders = foldersInParent(meta.folders, folderId)
  const childEntries = entriesInFolder(meta.entries, folderId)
  const renaming =
    !isRoot && draft?.kind === 'rename-folder' && draft.id === folderId
  const isDrop = dropTarget === folderId && canDropOn(folderId)
  const isDraggingSelf =
    !isRoot && dragging?.kind === 'folder' && dragging.id === folderId

  return (
    <div className={`library-branch ${isDraggingSelf ? 'library-branch--dragging' : ''}`}>
      {renaming && draft?.kind === 'rename-folder' ? (
        <DraftNameRow
          depth={depth}
          icon="folder"
          value={draft.name}
          onChange={(name) => onSetDraft({ ...draft, name })}
          onCommit={onCommitDraft}
          onCancel={onCancelDraft}
        />
      ) : (
        <TreeFolderRow
          label={folderName}
          depth={depth}
          selected={selectedFolderId === folderId}
          expanded={isExpanded}
          menuOpen={menuId === key}
          dropActive={isDrop}
          draggable={!isRoot}
          onSelect={() => {
            onSelectFolder(folderId)
            if (!isExpanded) onToggle(folderId)
          }}
          onToggle={() => onToggle(folderId)}
          onToggleMenu={() => onSetMenuId(menuId === key ? null : key)}
          onDragStart={(e) => {
            if (isRoot || !folderId) {
              e.preventDefault()
              return
            }
            e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind: 'folder', id: folderId }))
            e.dataTransfer.effectAllowed = 'move'
            onDragStart({ kind: 'folder', id: folderId })
          }}
          onDragEnd={onDragEnd}
          onDragOver={(e) => {
            if (!dragging) return
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = canDropOn(folderId) ? 'move' : 'none'
            onSetDropTarget(folderId)
            if (canDropOn(folderId)) onEnsureExpanded(folderId)
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDropOn(folderId)
            onDragEnd()
          }}
          menu={
            <div className="library-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onSetMenuId(null)
                  onOpenFolder(folderId)
                }}
              >
                Open all sheets
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={folderAddBusy}
                onClick={() => {
                  onSetMenuId(null)
                  onAddOpenSheet(folderId)
                }}
              >
                Add open sheet
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={folderAddBusy}
                onClick={() => {
                  onSetMenuId(null)
                  onAddPng(folderId)
                }}
              >
                From PNG…
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onSetMenuId(null)
                  onSelectFolder(folderId)
                  onEnsureExpanded(folderId)
                  onSetDraft({
                    kind: 'folder',
                    parentId: folderId,
                    name: 'New folder',
                  })
                }}
              >
                New folder inside
              </button>
              {!isRoot && folderId ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onSetMenuId(null)
                      onSetDraft({
                        kind: 'rename-folder',
                        id: folderId,
                        name: folderName,
                      })
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="library-menu__danger"
                    onClick={() => {
                      onSetMenuId(null)
                      if (
                        window.confirm(
                          `Delete folder “${folderName}”? Sheets inside move to Root.`,
                        )
                      ) {
                        deleteLibraryFolder(folderId)
                        if (selectedFolderId === folderId) onSelectFolder(null)
                        onRefresh()
                      }
                    }}
                  >
                    Delete folder
                  </button>
                </>
              ) : null}
            </div>
          }
        />
      )}

      {isExpanded ? (
        <>
          {draft?.kind === 'folder' && draft.parentId === folderId ? (
            <DraftNameRow
              depth={depth + 1}
              icon="folder"
              value={draft.name}
              onChange={(name) => onSetDraft({ ...draft, name })}
              onCommit={onCommitDraft}
              onCancel={onCancelDraft}
            />
          ) : null}

          {childFolders.map((child) => (
            <FolderBranch
              key={child.id}
              folderId={child.id}
              folderName={child.name}
              depth={depth + 1}
              meta={meta}
              selectedFolderId={selectedFolderId}
              expanded={expanded}
              draft={draft}
              menuId={menuId}
              dragging={dragging}
              dropTarget={dropTarget}
              canDropOn={canDropOn}
              onSelectFolder={onSelectFolder}
              onToggle={onToggle}
              onEnsureExpanded={onEnsureExpanded}
              onOpenEntry={onOpenEntry}
              onOpenFolder={onOpenFolder}
              onRevealEntry={onRevealEntry}
              onAddOpenSheet={onAddOpenSheet}
              onAddPng={onAddPng}
              addBusy={folderAddBusy}
              onSetDraft={onSetDraft}
              onSetMenuId={onSetMenuId}
              onCommitDraft={onCommitDraft}
              onCancelDraft={onCancelDraft}
              onRefresh={onRefresh}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onSetDropTarget={onSetDropTarget}
              onDropOn={onDropOn}
            />
          ))}

          {childEntries.map((entry) => (
            <EntryTreeRow
              key={entry.id}
              entry={entry}
              depth={depth + 1}
              draft={draft}
              menuId={menuId}
              dragging={dragging}
              canDropOn={canDropOn}
              onOpen={() => onOpenEntry(entry)}
              onReveal={() => onRevealEntry(entry)}
              onSetDraft={onSetDraft}
              onSetMenuId={onSetMenuId}
              onCommitDraft={onCommitDraft}
              onCancelDraft={onCancelDraft}
              onRefresh={onRefresh}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onSetDropTarget={onSetDropTarget}
              onDropOn={onDropOn}
            />
          ))}
        </>
      ) : null}
    </div>
  )
}

function TreeFolderRow({
  label,
  depth,
  selected,
  expanded,
  menuOpen = false,
  dropActive = false,
  draggable = true,
  onSelect,
  onToggle,
  onToggleMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  menu,
}: {
  label: string
  depth: number
  selected: boolean
  expanded: boolean
  menuOpen?: boolean
  dropActive?: boolean
  draggable?: boolean
  onSelect: () => void
  onToggle: () => void
  onToggleMenu?: () => void
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
  onDragOver: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
  menu?: ReactNode
}) {
  return (
    <div
      className={`library-row library-row--folder ${selected ? 'library-row--selected' : ''} ${
        dropActive ? 'library-row--drop' : ''
      }`}
      style={{ paddingLeft: 4 + depth * 12 }}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={expanded}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        type="button"
        className={`library-row__chevron ${expanded ? 'library-row__chevron--open' : ''}`}
        aria-label={expanded ? 'Collapse' : 'Expand'}
        onClick={onToggle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        ▸
      </button>
      <button type="button" className="library-row__main" onClick={onSelect}>
        <FolderGlyph />
        <span className="library-row__name">{label}</span>
      </button>
      {onToggleMenu ? (
        <div className="library-row__trail">
          <button
            type="button"
            className="library-row__more"
            aria-label={`Folder actions for ${label}`}
            aria-expanded={menuOpen}
            onClick={onToggleMenu}
            onMouseDown={(e) => e.stopPropagation()}
          >
            ···
          </button>
          {menuOpen ? menu : null}
        </div>
      ) : null}
    </div>
  )
}

function EntryTreeRow({
  entry,
  depth,
  draft,
  menuId,
  dragging,
  canDropOn,
  onOpen,
  onReveal,
  onSetDraft,
  onSetMenuId,
  onCommitDraft,
  onCancelDraft,
  onRefresh,
  onDragStart,
  onDragEnd,
  onSetDropTarget,
  onDropOn,
}: {
  entry: LibraryEntry
  depth: number
  draft: Draft | null
  menuId: string | null
  dragging: DragPayload | null
  canDropOn: (target: DropTarget) => boolean
  onOpen: () => void
  onReveal: () => void
  onSetDraft: (d: Draft | null) => void
  onSetMenuId: (id: string | null) => void
  onCommitDraft: () => void
  onCancelDraft: () => void
  onRefresh: () => void
  onDragStart: (payload: DragPayload) => void
  onDragEnd: () => void
  onSetDropTarget: (target: DropTarget | undefined) => void
  onDropOn: (target: DropTarget) => void
}) {
  const renaming = draft?.kind === 'rename-entry' && draft.id === entry.id
  if (renaming && draft.kind === 'rename-entry') {
    return (
      <DraftNameRow
        depth={depth}
        icon="sheet"
        value={draft.name}
        onChange={(name) => onSetDraft({ ...draft, name })}
        onCommit={onCommitDraft}
        onCancel={onCancelDraft}
      />
    )
  }

  const isDraggingSelf = dragging?.kind === 'entry' && dragging.id === entry.id
  const parentTarget = entry.folderId

  return (
    <div
      className={`library-row library-row--entry ${isDraggingSelf ? 'library-row--dragging' : ''}`}
      style={{ paddingLeft: 4 + depth * 12 }}
      role="treeitem"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind: 'entry', id: entry.id }))
        e.dataTransfer.effectAllowed = 'move'
        onDragStart({ kind: 'entry', id: entry.id })
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (!dragging) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = canDropOn(parentTarget) ? 'move' : 'none'
        onSetDropTarget(parentTarget)
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDropOn(parentTarget)
        onDragEnd()
      }}
    >
      <span className="library-row__chevron-spacer" />
      <button type="button" className="library-row__main" onClick={onOpen}>
        <SheetThumb entryId={entry.id} label={entry.name} />
        <span className="library-row__text">
          <span className="library-row__name">{entry.name}</span>
          <span className="library-row__file">{entry.fileName}</span>
        </span>
      </button>
      <div className="library-row__trail">
        <button
          type="button"
          className="library-row__more"
          aria-label={`Actions for ${entry.name}`}
          aria-expanded={menuId === entry.id}
          onClick={() => onSetMenuId(menuId === entry.id ? null : entry.id)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          ···
        </button>
        {menuId === entry.id ? (
          <div className="library-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSetMenuId(null)
                onOpen()
              }}
            >
              Open
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSetMenuId(null)
                onReveal()
              }}
            >
              Show in folder…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSetMenuId(null)
                onSetDraft({ kind: 'rename-entry', id: entry.id, name: entry.name })
              }}
            >
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              className="library-menu__danger"
              onClick={() => {
                onSetMenuId(null)
                removeLibraryEntry(entry.id)
                onRefresh()
              }}
            >
              Remove
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function DraftNameRow({
  depth,
  icon,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  depth: number
  icon: 'folder' | 'sheet'
  value: string
  onChange: (name: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  return (
    <div
      className="library-row library-row--draft"
      style={{ paddingLeft: 4 + depth * 12 }}
    >
      <span className="library-row__chevron-spacer" />
      {icon === 'folder' ? <FolderGlyph /> : <SheetGlyph />}
      <input
        ref={ref}
        className="library-row__name-input"
        value={value}
        aria-label={icon === 'folder' ? 'Folder name' : 'Sheet name'}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onCommit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancelled.current = true
            onCancel()
          }
        }}
        onBlur={() => {
          if (!cancelled.current) onCommit()
        }}
      />
    </div>
  )
}

function SheetThumb({
  entryId,
  fileHandle = null,
  label,
}: {
  entryId?: string | null
  fileHandle?: FileSystemFileHandle | null
  label: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [hover, setHover] = useState<{ left: number; top: number } | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadFromHandle(handle: FileSystemFileHandle) {
      try {
        const query = await handle.queryPermission({ mode: 'read' })
        if (query !== 'granted') return null
        const file = await handle.getFile()
        return makeLibraryPreview(file)
      } catch {
        return null
      }
    }

    async function load() {
      let blob: Blob | null = null
      if (entryId) {
        blob = await loadEntryThumb(entryId)
        if (!blob) {
          const handle = (await loadFileHandle(entryId)) ?? fileHandle
          if (handle) {
            blob = await loadFromHandle(handle)
            if (blob) await storeEntryThumb(entryId, blob)
          }
        }
      } else if (fileHandle) {
        blob = await loadFromHandle(fileHandle)
      }
      if (cancelled || !blob) {
        if (!cancelled) setUrl(null)
        return
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      const next = URL.createObjectURL(blob)
      urlRef.current = next
      setUrl(next)
    }

    void load()

    function onThumbUpdated(e: Event) {
      const id = (e as CustomEvent<{ entryId: string }>).detail?.entryId
      if (entryId && id === entryId) void load()
    }
    window.addEventListener('paletter-library-thumb', onThumbUpdated)

    return () => {
      cancelled = true
      window.removeEventListener('paletter-library-thumb', onThumbUpdated)
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [entryId, fileHandle])

  function showHover() {
    const el = wrapRef.current
    if (!el || !url) return
    const rect = el.getBoundingClientRect()
    const previewW = 200
    const previewH = 200
    const gap = 10
    let left = rect.right + gap
    let top = rect.top + rect.height / 2 - previewH / 2
    if (left + previewW > window.innerWidth - 8) {
      left = rect.left - previewW - gap
    }
    if (top < 8) top = 8
    if (top + previewH > window.innerHeight - 8) {
      top = window.innerHeight - previewH - 8
    }
    setHover({ left, top })
  }

  if (!url) return <SheetGlyph />

  return (
    <span
      ref={wrapRef}
      className="library-thumb"
      onMouseEnter={showHover}
      onMouseLeave={() => setHover(null)}
      onFocus={showHover}
      onBlur={() => setHover(null)}
    >
      <img className="library-thumb__img" src={url} alt="" draggable={false} />
      {hover
        ? createPortal(
            <div
              className="library-thumb__zoom"
              style={{ left: hover.left, top: hover.top }}
              role="img"
              aria-label={`Preview of ${label}`}
            >
              <img src={url} alt="" draggable={false} />
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}

function FolderGlyph() {
  return (
    <svg className="library-glyph" viewBox="0 0 16 16" width="13" height="13" aria-hidden>
      <path
        fill="currentColor"
        d="M2 3.5A1.5 1.5 0 0 1 3.5 2H6l1.2 1.2c.2.2.4.3.7.3H12.5A1.5 1.5 0 0 1 14 5v7.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Z"
      />
    </svg>
  )
}

function SheetGlyph() {
  return (
    <svg className="library-glyph" viewBox="0 0 16 16" width="13" height="13" aria-hidden>
      <path
        fill="currentColor"
        d="M4 1.5h5.2L13 5.3V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1Zm5 1v3h3L9 2.5ZM5 8h6v1.2H5V8Zm0 2.5h6V11.7H5V10.5Zm0 2.5h4V14H5v-1Z"
      />
    </svg>
  )
}
