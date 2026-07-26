import { useEffect, useState } from 'react'

const MAX_HISTORY = 60

export interface HistoryStack<T> {
  present: T
  past: T[]
  future: T[]
  /** When set, the next commit with the same key replaces `present` instead of pushing. */
  coalesceKey?: string
}

export type HistoryCommitOpts = {
  /**
   * Group rapid edits (e.g. dragging a color) into one undo step.
   * Matching key replaces the current present without growing `past`.
   */
  coalesce?: string
}

export function createHistoryStack<T>(initial: T): HistoryStack<T> {
  return { present: initial, past: [], future: [] }
}

export function historyCommit<T>(
  stack: HistoryStack<T>,
  next: T | ((prev: T) => T),
  opts?: HistoryCommitOpts,
): HistoryStack<T> {
  const value =
    typeof next === 'function' ? (next as (p: T) => T)(stack.present) : next
  if (value === stack.present) return stack

  const key = opts?.coalesce

  if (key && stack.coalesceKey === key) {
    return {
      ...stack,
      present: value,
      coalesceKey: key,
    }
  }

  const past = [...stack.past, structuredClone(stack.present) as T]
  if (past.length > MAX_HISTORY) past.shift()
  return {
    present: value,
    past,
    future: [],
    coalesceKey: key,
  }
}

export function historyUndo<T>(stack: HistoryStack<T>): HistoryStack<T> | null {
  if (stack.past.length === 0) return null
  const past = [...stack.past]
  const last = past.pop()!
  return {
    present: last,
    past,
    future: [...stack.future, structuredClone(stack.present) as T],
  }
}

export function historyRedo<T>(stack: HistoryStack<T>): HistoryStack<T> | null {
  if (stack.future.length === 0) return null
  const future = [...stack.future]
  const next = future.pop()!
  return {
    present: next,
    past: [...stack.past, structuredClone(stack.present) as T],
    future,
  }
}

export function historyCanUndo<T>(stack: HistoryStack<T>): boolean {
  return stack.past.length > 0
}

export function historyCanRedo<T>(stack: HistoryStack<T>): boolean {
  return stack.future.length > 0
}

/**
 * Present-state + undo/redo for a single document. Prefer `createHistoryStack`
 * when managing multiple documents.
 */
export function useHistory<T>(initial: T) {
  const [stack, setStack] = useState(() => createHistoryStack(initial))

  useHistoryKeyboard({
    enabled: true,
    canUndo: () => historyCanUndo(stack),
    canRedo: () => historyCanRedo(stack),
    undo: () => {
      setStack((s) => historyUndo(s) ?? s)
    },
    redo: () => {
      setStack((s) => historyRedo(s) ?? s)
    },
  })

  return {
    present: stack.present,
    set: (next: T | ((prev: T) => T), opts?: HistoryCommitOpts) => {
      setStack((s) => historyCommit(s, next, opts))
    },
    undo: () => {
      let ok = false
      setStack((s) => {
        const next = historyUndo(s)
        ok = next != null
        return next ?? s
      })
      return ok
    },
    redo: () => {
      let ok = false
      setStack((s) => {
        const next = historyRedo(s)
        ok = next != null
        return next ?? s
      })
      return ok
    },
    canUndo: () => historyCanUndo(stack),
    canRedo: () => historyCanRedo(stack),
  }
}

export function useHistoryKeyboard(opts: {
  enabled: boolean
  canUndo: () => boolean
  canRedo: () => boolean
  undo: () => void
  redo: () => void
  /** Use capture phase (e.g. to beat other handlers). */
  capture?: boolean
}) {
  const { enabled, canUndo, canRedo, undo, redo, capture = false } = opts
  useEffect(() => {
    if (!enabled) return
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return

      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        if (!canUndo()) return
        e.preventDefault()
        if (capture) e.stopImmediatePropagation()
        undo()
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        if (!canRedo()) return
        e.preventDefault()
        if (capture) e.stopImmediatePropagation()
        redo()
      }
    }
    window.addEventListener('keydown', onKey, capture)
    return () => window.removeEventListener('keydown', onKey, capture)
  }, [enabled, canUndo, canRedo, undo, redo, capture])
}
