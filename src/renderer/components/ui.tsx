// SPDX-License-Identifier: MIT

import { Fragment, useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react'
import { cn } from '../lib/cn.js'
import type { SortDir } from '../lib/sort.js'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
  ghost: 'text-muted-foreground hover:bg-secondary hover:text-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
}

export function Button({ variant = 'secondary', className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium',
        'transition-colors disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        className,
      )}
    />
  )
}

export function IconButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground',
        'transition-colors hover:bg-secondary hover:text-foreground',
        'disabled:pointer-events-none disabled:opacity-30',
        className,
      )}
    />
  )
}

export function Badge({
  children,
  tone = 'muted',
  className,
}: {
  children: ReactNode
  tone?: 'muted' | 'warning' | 'destructive'
  className?: string
}) {
  const tones = {
    muted: 'bg-secondary text-muted-foreground',
    warning: 'text-warning border border-warning/40',
    destructive: 'text-destructive border border-destructive/40',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Sentence case, not tracked-out caps — this is a signpost, not a design flourish. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pb-1.5 pt-4 text-[11px] font-semibold text-muted-foreground">
      {children}
    </div>
  )
}

export function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          onChange()
        }
      }}
      className={cn(
        'inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
      )}
    >
      {checked && (
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
          <path
            d="M2.5 6.2 4.8 8.5 9.5 3.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  )
}

export function Input(props: React.ComponentProps<'input'>) {
  return (
    <input
      {...props}
      className={cn(
        'h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13px]',
        'placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-ring',
        props.className,
      )}
    />
  )
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground/80">{hint}</span>}
    </label>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return <p className="text-[12px] text-destructive">{children}</p>
}

/**
 * On/off. Used wherever the answer is "is this written to the file?" — packages in the stack.
 * Checkboxes are reserved for selection, so the two controls carry different meanings and are
 * never interchangeable. Also used for a record inside a package: on, or kept but not written.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: () => void
  label?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span
        className={cn(
          'inline-block size-3 rounded-full bg-background shadow-sm transition-transform',
          checked ? 'translate-x-3.5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

/** A column header that sorts on click. The arrow shows the current direction, if any. */
export function SortableTh({
  children,
  dir,
  onClick,
  className,
}: {
  children: ReactNode
  dir: SortDir | null
  onClick: () => void
  className?: string
}) {
  const Icon = dir === 'asc' ? ChevronUp : dir === 'desc' ? ChevronDown : ChevronsUpDown
  return (
    <th className={cn('py-0 text-left', className)} aria-sort={dir ? `${dir}ending` : 'none'}>
      <button
        type="button"
        onClick={onClick}
        title={
          dir === 'asc' ? 'Sort descending' : dir === 'desc' ? 'Stored order' : 'Sort ascending'
        }
        className={cn(
          'group inline-flex h-full items-center gap-1 py-1.5 text-[11px] font-medium',
          'hover:text-foreground',
          dir ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {children}
        <Icon
          aria-hidden="true"
          className={cn('size-3', !dir && 'opacity-0 transition-opacity group-hover:opacity-60')}
        />
      </button>
    </th>
  )
}

/** Hostnames that wrap between names only, never at the hyphens inside one. */
export function Hostnames({ names }: { names: string[] }) {
  return names.map((h, i) => (
    <Fragment key={i}>
      {i > 0 && ' '}
      <span className="whitespace-nowrap">{h}</span>
    </Fragment>
  ))
}

/** Rows rendered at first and per "show more". A blocklist can hold tens of thousands. */
export const PAGE_SIZE = 300

/** Footer for a long list that renders a page at a time. Renders nothing once all are shown. */
export function ShowMore({
  shown,
  total,
  onMore,
  step = PAGE_SIZE * 4,
}: {
  shown: number
  total: number
  /** Called to show `step` more rows. */
  onMore: () => void
  step?: number
}) {
  if (shown >= total) return null
  return (
    <div className="flex items-center justify-center gap-3 px-4 py-3 text-[12px] text-muted-foreground">
      <span>
        Showing {shown.toLocaleString()} of {total.toLocaleString()}
      </span>
      <Button variant="secondary" className="h-7" onClick={onMore}>
        Show {Math.min(step, total - shown).toLocaleString()} more
      </Button>
    </div>
  )
}

/**
 * For a modal dialog: dims the native window controls on Windows and Linux to match the
 * backdrop for as long as the dialog is mounted.
 */
export function useDimmedWindowControls(): void {
  useEffect(() => {
    void window.hostserrer.dimTitleBar(true)
    return () => void window.hostserrer.dimTitleBar(false)
  }, [])
}
