import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_HISTORY = 60

/**
 * Present-state + undo/redo stacks. `set` commits a new snapshot (pushing the
 * previous present onto the undo stack). Undo does not re-commit.
 */
export function useHistory<T>(initial: T) {
  const [present, setPresent] = useState(initial)
  const pastRef = useRef<T[]>([])
  const futureRef = useRef<T[]>([])
  const presentRef = useRef(present)
  presentRef.current = present

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setPresent((prev) => {
      const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      pastRef.current.push(structuredClone(prev) as T)
      if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift()
      futureRef.current = []
      return value
    })
  }, [])

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return false
    setPresent((prev) => {
      const last = pastRef.current.pop()!
      futureRef.current.push(structuredClone(prev) as T)
      return last
    })
    return true
  }, [])

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return false
    setPresent((prev) => {
      const next = futureRef.current.pop()!
      pastRef.current.push(structuredClone(prev) as T)
      return next
    })
    return true
  }, [])

  const canUndo = () => pastRef.current.length > 0
  const canRedo = () => futureRef.current.length > 0

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return

      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        if (pastRef.current.length === 0) return
        e.preventDefault()
        undo()
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        if (futureRef.current.length === 0) return
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  return { present, set, undo, redo, canUndo, canRedo, presentRef }
}
