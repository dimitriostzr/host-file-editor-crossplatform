// SPDX-License-Identifier: MIT

import { useEffect, useRef } from 'react'

const isMac = window.hostserrer.platform === 'darwin'

/** How a ⌘/Ctrl shortcut is written on this platform, for tooltips: ⌘N or Ctrl+N. */
export const kbd = (key: string): string => (isMac ? `⌘${key}` : `Ctrl+${key}`)

/**
 * Runs `handler` on ⌘+key (macOS) or Ctrl+key (Windows, Linux) while `enabled`. `key` is a
 * KeyboardEvent.key value, compared case-insensitively.
 */
export function useShortcut(key: string, handler: () => void, enabled = true): void {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      if (!mod || e.altKey || e.key.toLowerCase() !== key.toLowerCase()) return
      e.preventDefault()
      latest.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [key, enabled])
}
