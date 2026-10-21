// SPDX-License-Identifier: MIT

import { useEffect, useRef } from 'react'
import { Square, X } from 'lucide-react'
import type { ToolKind } from '../env.js'
import { cn } from '../lib/cn.js'
import { Button, IconButton } from './ui.js'

export interface ToolJob {
  id: string
  kind: ToolKind
  target: string
  output: string
  done: boolean
  code: number | null
  note?: string
}

interface Props {
  jobs: ToolJob[]
  activeId: string | null
  onSelect: (id: string) => void
  onStop: (id: string) => void
  onClose: (id: string) => void
}

/** Streaming output from ping and traceroute. One tab per job, newest last. */
export function ToolConsole({ jobs, activeId, onSelect, onStop, onClose }: Props) {
  const active = jobs.find((j) => j.id === activeId) ?? jobs[jobs.length - 1]
  const pre = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const el = pre.current
    if (el) el.scrollTop = el.scrollHeight
  }, [active?.output])
  if (!active) return null

  return (
    <div className="flex max-h-[40vh] shrink-0 flex-col border-t">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        {jobs.map((j) => (
          <button
            key={j.id}
            onClick={() => onSelect(j.id)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px]',
              j.id === active.id
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 rounded-full',
                j.done
                  ? j.code === 0
                    ? 'bg-success'
                    : 'bg-muted-foreground'
                  : 'animate-pulse bg-warning',
              )}
            />
            {j.kind} <span className="font-mono">{j.target}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {!active.done && (
            <Button variant="ghost" className="h-7" onClick={() => onStop(active.id)}>
              <Square className="size-3" aria-hidden="true" />
              Stop
            </Button>
          )}
          <IconButton aria-label="Close" onClick={() => onClose(active.id)}>
            <X className="size-4" />
          </IconButton>
        </div>
      </div>
      <pre
        ref={pre}
        className="min-h-0 flex-1 overflow-auto px-4 py-2 font-mono text-[12px] leading-[1.55] whitespace-pre-wrap"
      >
        {active.output}
        {active.done && (
          <span className="text-muted-foreground">
            {'\n'}—{' '}
            {active.note ?? (active.code === 0 ? 'finished' : `exited with code ${active.code}`)}
          </span>
        )}
      </pre>
    </div>
  )
}
