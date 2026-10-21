// SPDX-License-Identifier: MIT

export type ThemeMode = 'system' | 'light' | 'dark'

const media = () => matchMedia('(prefers-color-scheme: dark)')

/** Sets `data-theme` for the given mode, following the OS while mode is `system`. */
export function applyThemeMode(mode: ThemeMode): () => void {
  const set = () => {
    const dark = mode === 'dark' || (mode === 'system' && media().matches)
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  }
  set()
  if (mode !== 'system') return () => {}
  const m = media()
  m.addEventListener('change', set)
  return () => m.removeEventListener('change', set)
}
