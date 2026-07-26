import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  addLibraryEntry,
  canRedoLibrary,
  canUndoLibrary,
  createLibraryFolder,
  deleteLibraryFolder,
  entriesInFolder,
  foldersInParent,
  isLibraryFolderWithin,
  loadLibraryMeta,
  moveLibraryEntry,
  moveLibraryFolder,
  redoLibrary,
  removeLibraryEntry,
  renameLibraryEntry,
  renameLibraryFolder,
  storeFileHandle,
  undoLibrary,
  type LibraryEntry,
  type LibraryFolder,
  type LibraryMeta,
} from '../lib/library'

interface LibraryPanelProps {
  /** When true, refresh meta from storage (e.g. tab became active). */
  active?: boolean
  /** Save current sheet if needed, then return handle + display name + fileName. */
  onAddCurrent: (folderId: string | null) => Promise<{
    name: string
    fileName: string
    handle: FileSystemFileHandle | null
  } | null>
  onOpenEntry: (entry: LibraryEntry) => void
  addBusy?: boolean
}

type Draft =
  | { kind: 'folder'; parentId: string | null; name: string }
  | { kind: 'rename-folder'; id: string; name: string }
  | { kind: 'rename-entry'; id: string; name: string }

type DragPayload =
  | { kind: 'folder'; id: string }
  | { kind: 'entry'; id: string }

const DND_MIME = 'application/x-paletter-library'

/** Drop onto a folder id, or null for library root. */
type DropTarget = string | null

export function LibraryPanel({
  active = true,
  onAddCurrent,
  onOpenEntry,
  addBusy = false,
}: LibraryPanelProps) {
  const [meta, setMeta] = useState<LibraryMeta>(() => loadLibraryMeta())
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [dragging, setDragging] = useState<DragPayload | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | undefined>(undefined)

  useEffect(() => {
    if (!active) return
    setMeta(loadLibraryMeta())
    setDraft(null)
    setMenuId(null)
    setAddOpen(false)
    setDragging(null)
    setDropTarget(undefined)
  }, [active])

  useEffect(() => {
    if (!active) return
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement | null
      if (!t?.closest('.library-menu, .library-row__more, .library-add')) {
        setMenuId(null)
        setAddOpen(false)
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
    // Capture so library undo wins over document history while this tab is open.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active])

  function refresh() {
    setMeta(loadLibraryMeta())
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function ensureExpanded(id: string) {
    setExpanded((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  /** Top-level folder from the + menu. Nest via folder menu or drag. */
  function startNewFolder() {
    setDraft({ kind: 'folder', parentId: null, name: 'New folder' })
    setSelectedFolderId(null)
    setMenuId(null)
    setAddOpen(false)
  }

  function commitDraft() {
    if (!draft) return
    if (draft.kind === 'folder') {
      const name = draft.name.trim() || 'New folder'
      const folder = createLibraryFolder(name, draft.parentId)
      if (draft.parentId) {
        setExpanded((prev) => new Set(prev).add(draft.parentId!))
      }
      setExpanded((prev) => new Set(prev).add(folder.id))
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

  async function handleAddSheet() {
    if (busy || addBusy) return
    setBusy(true)
    setMenuId(null)
    setAddOpen(false)
    try {
      const result = await onAddCurrent(selectedFolderId)
      if (!result) return
      const entry = addLibraryEntry({
        name: result.name,
        folderId: selectedFolderId,
        fileName: result.fileName,
      })
      if (result.handle) await storeFileHandle(entry.id, result.handle)
      if (selectedFolderId) {
        setExpanded((prev) => new Set(prev).add(selectedFolderId))
      }
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
      if (target) setExpanded((prev) => new Set(prev).add(target))
    }
    refresh()
  }

  function onDragEnd() {
    setDragging(null)
    setDropTarget(undefined)
  }

  const locationLabel =
    selectedFolderId == null
      ? 'Library'
      : meta.folders.find((f) => f.id === selectedFolderId)?.name ?? 'Library'

  return (
    <div className="library-panel">
      <div
        className={`library-add ${addOpen ? 'library-add--open' : ''}`}
        onMouseEnter={() => setAddOpen(true)}
        onMouseLeave={() => setAddOpen(false)}
      >
        <button
          type="button"
          className="library-add__btn"
          aria-label={`Add to ${locationLabel}`}
          aria-expanded={addOpen}
          aria-haspopup="menu"
          disabled={busy || addBusy}
          onClick={() => setAddOpen((v) => !v)}
          title={`Add to ${locationLabel}`}
        >
          {busy || addBusy ? '…' : '+'}
        </button>
        {addOpen ? (
          <div className="library-add__menu" role="menu">
            <button type="button" role="menuitem" onClick={startNewFolder}>
              New folder
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy || addBusy}
              onClick={() => void handleAddSheet()}
            >
              Add sheet
            </button>
          </div>
        ) : null}
      </div>

      <div
        className={`library-tree ${
          dropTarget === null ? 'library-tree--drop' : ''
        } ${dragging ? 'library-tree--dragging' : ''}`}
        role="tree"
        aria-label="Library folders and sheets"
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelectedFolderId(null)
        }}
        onDragOver={(e) => {
          if (!dragging) return
          e.preventDefault()
          e.dataTransfer.dropEffect = canDropOn(null) ? 'move' : 'none'
          setDropTarget(null)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setDropTarget((cur) => (cur === null ? undefined : cur))
        }}
        onDrop={(e) => {
          e.preventDefault()
          applyDrop(null)
          onDragEnd()
        }}
      >
        {draft?.kind === 'folder' && draft.parentId === null ? (
          <DraftNameRow
            depth={0}
            icon="folder"
            value={draft.name}
            onChange={(name) => setDraft({ ...draft, name })}
            onCommit={commitDraft}
            onCancel={cancelDraft}
          />
        ) : null}

        {foldersInParent(meta.folders, null).map((folder) => (
          <FolderBranch
            key={folder.id}
            folder={folder}
            depth={0}
            meta={meta}
            selectedFolderId={selectedFolderId}
            expanded={expanded}
            draft={draft}
            menuId={menuId}
            dragging={dragging}
            dropTarget={dropTarget}
            canDropOn={canDropOn}
            onSelectFolder={setSelectedFolderId}
            onToggle={toggleExpanded}
            onEnsureExpanded={ensureExpanded}
            onOpenEntry={onOpenEntry}
            onSetDraft={setDraft}
            onSetMenuId={setMenuId}
            onCommitDraft={commitDraft}
            onCancelDraft={cancelDraft}
            onRefresh={refresh}
            onDragStart={(payload) => setDragging(payload)}
            onDragEnd={onDragEnd}
            onSetDropTarget={setDropTarget}
            onDropOn={applyDrop}
          />
        ))}

        {entriesInFolder(meta.entries, null).map((entry) => (
          <EntryTreeRow
            key={entry.id}
            entry={entry}
            depth={0}
            draft={draft}
            menuId={menuId}
            dragging={dragging}
            canDropOn={canDropOn}
            onOpen={() => onOpenEntry(entry)}
            onSetDraft={setDraft}
            onSetMenuId={setMenuId}
            onCommitDraft={commitDraft}
            onCancelDraft={cancelDraft}
            onRefresh={refresh}
            onDragStart={(payload) => setDragging(payload)}
            onDragEnd={onDragEnd}
            onSetDropTarget={setDropTarget}
            onDropOn={applyDrop}
          />
        ))}
      </div>
    </div>
  )
}

function FolderBranch({
  folder,
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
  folder: LibraryFolder
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
  onToggle: (id: string) => void
  onEnsureExpanded: (id: string) => void
  onOpenEntry: (entry: LibraryEntry) => void
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
  const isExpanded = expanded.has(folder.id)
  const childFolders = foldersInParent(meta.folders, folder.id)
  const childEntries = entriesInFolder(meta.entries, folder.id)
  const renaming = draft?.kind === 'rename-folder' && draft.id === folder.id
  const isDrop = dropTarget === folder.id && canDropOn(folder.id)
  const isDraggingSelf = dragging?.kind === 'folder' && dragging.id === folder.id

  return (
    <div className={`library-branch ${isDraggingSelf ? 'library-branch--dragging' : ''}`}>
      {renaming && draft.kind === 'rename-folder' ? (
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
          label={folder.name}
          depth={depth}
          selected={selectedFolderId === folder.id}
          expanded={isExpanded}
          menuOpen={menuId === folder.id}
          dropActive={isDrop}
          onSelect={() => {
            onSelectFolder(folder.id)
            if (!isExpanded) onToggle(folder.id)
          }}
          onToggle={() => onToggle(folder.id)}
          onToggleMenu={() => onSetMenuId(menuId === folder.id ? null : folder.id)}
          onDragStart={(e) => {
            e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind: 'folder', id: folder.id }))
            e.dataTransfer.effectAllowed = 'move'
            onDragStart({ kind: 'folder', id: folder.id })
          }}
          onDragEnd={onDragEnd}
          onDragOver={(e) => {
            if (!dragging) return
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = canDropOn(folder.id) ? 'move' : 'none'
            onSetDropTarget(folder.id)
            if (canDropOn(folder.id)) onEnsureExpanded(folder.id)
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDropOn(folder.id)
            onDragEnd()
          }}
          menu={
            <div className="library-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onSetMenuId(null)
                  onSetDraft({ kind: 'rename-folder', id: folder.id, name: folder.name })
                }}
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onSetMenuId(null)
                  onSelectFolder(folder.id)
                  if (!isExpanded) onToggle(folder.id)
                  onSetDraft({ kind: 'folder', parentId: folder.id, name: 'New folder' })
                }}
              >
                New folder inside
              </button>
              <button
                type="button"
                role="menuitem"
                className="library-menu__danger"
                onClick={() => {
                  onSetMenuId(null)
                  if (
                    window.confirm(
                      `Delete folder “${folder.name}”? Sheets inside move to Library root.`,
                    )
                  ) {
                    deleteLibraryFolder(folder.id)
                    if (selectedFolderId === folder.id) onSelectFolder(null)
                    onRefresh()
                  }
                }}
              >
                Delete folder
              </button>
            </div>
          }
        />
      )}

      {isExpanded ? (
        <>
          {draft?.kind === 'folder' && draft.parentId === folder.id ? (
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
              folder={child}
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
      draggable
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
        <SheetGlyph />
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
