// SPDX-License-Identifier: MIT

import { Monitor, Moon, Sun } from 'lucide-react'
import type { ThemeMode } from '../lib/theme.js'
import { cn } from '../lib/cn.js'

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: 'system', label: 'Follow system', Icon: Monitor },
  { mode: 'light', label: 'Light', Icon: Sun },
  { mode: 'dark', label: 'Dark', Icon: Moon },
]

export function ThemeControl({
  value,
  onChange,
}: {
  value: ThemeMode
  onChange: (m: ThemeMode) => void
}) {
  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-md border p-0.5">
      {OPTIONS.map(({ mode, label, Icon }) => (
        <button
          key={mode}
          role="radio"
          aria-checked={value === mode}
          aria-label={label}
          title={label}
          onClick={() => onChange(mode)}
          className={cn(
            'inline-flex size-6 items-center justify-center rounded-[5px] text-muted-foreground',
            'transition-colors hover:text-foreground',
            value === mode && 'bg-secondary text-foreground',
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  )
}
