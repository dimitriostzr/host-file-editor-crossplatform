// SPDX-License-Identifier: MIT

import { useMemo } from 'react'
import { BEGIN_MARKER, END_MARKER, parseSectionHeader } from '../../core/markers.js'
import type { PackageDto } from '../env.js'
import { cn } from '../lib/cn.js'

/** Rail colours for package sections, in the order the sections appear. Legible in both themes. */
const SECTION_COLORS = [
  'oklch(0.62 0.17 264)',
  'oklch(0.64 0.15 155)',
  'oklch(0.68 0.16 55)',
  'oklch(0.62 0.18 330)',
  'oklch(0.66 0.12 210)',
  'oklch(0.7 0.15 100)',
]

interface Run {
  first: number
  lines: string[]
  managed: boolean
  comment: boolean
  /** Index into SECTION_COLORS for lines under a package heading; null elsewhere. */
  color: number | null
  /** Set when this run is a package heading; it is always a run of one line. */
  heading: string | null
}

/**
 * The file is the hero of this interface. The region hostserrer owns carries an accent rail;
 * everything else is dimmed. Inside the block each package's lines have their own colour under
 * a heading that opens the package, so the user can see where every rule comes from.
 *
 * Marker detection here is plain string comparison — highlighting needs no IP validation, so
 * this stays free of anything the renderer cannot reach.
 */
export function HostsFile({
  content,
  packages,
  onOpenPackage,
}: {
  content: string
  packages: readonly PackageDto[]
  onOpenPackage: (id: string) => void
}) {
  // Consecutive lines with the same look are rendered as one block of text. A blocklist runs to
  // tens of thousands of lines, and an element per line would be hundreds of thousands of nodes.
  const runs = useMemo(() => {
    const lines = content.split(/\r\n|\n|\r/)
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    const out: Run[] = []
    const colors = new Map<string, number>()
    let inside = false
    let color: number | null = null
    lines.forEach((text, i) => {
      const trimmed = text.trim()
      let managed = inside
      let heading: string | null = null
      if (trimmed === BEGIN_MARKER) {
        inside = true
        managed = true
        color = null
      } else if (trimmed === END_MARKER) {
        inside = false
        managed = true
        color = null
      } else if (inside && (heading = parseSectionHeader(trimmed)) !== null) {
        if (!colors.has(heading)) colors.set(heading, colors.size % SECTION_COLORS.length)
        color = colors.get(heading)!
      }
      const comment = trimmed.startsWith('#')
      const lineColor = trimmed === END_MARKER ? null : color
      const last = out[out.length - 1]
      if (
        last &&
        heading === null &&
        last.heading === null &&
        last.managed === managed &&
        last.comment === comment &&
        last.color === lineColor
      )
        last.lines.push(text)
      else out.push({ first: i + 1, lines: [text], managed, comment, color: lineColor, heading })
    })
    return out
  }, [content])

  const idByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of packages) if (!m.has(p.name)) m.set(p.name, p.id)
    return m
  }, [packages])

  return (
    <div className="h-full overflow-auto">
      <pre className="min-h-full py-1 font-mono text-[12.5px] leading-[20.625px]">
        {runs.map((r) => {
          const rail = r.color !== null ? SECTION_COLORS[r.color] : undefined
          return (
            <div
              key={r.first}
              className={cn(
                'flex',
                r.managed && 'bg-accent/25',
                !r.managed && 'text-foreground/60',
              )}
            >
              <span
                aria-hidden="true"
                className="w-10 shrink-0 pr-3 text-right text-[11px] leading-[20.625px] whitespace-pre text-muted-foreground/50 select-none"
              >
                {r.lines.map((_, k) => r.first + k).join('\n')}
              </span>
              <span
                aria-hidden="true"
                className={cn('w-[3px] shrink-0', r.managed && !rail && 'bg-primary')}
                style={rail ? { background: rail } : undefined}
              />
              {r.heading !== null ? (
                <Heading
                  name={r.heading}
                  color={rail!}
                  onOpen={
                    idByName.has(r.heading)
                      ? () => onOpenPackage(idByName.get(r.heading!)!)
                      : undefined
                  }
                />
              ) : (
                <code
                  className={cn(
                    'flex-1 pr-4 pl-3 whitespace-pre',
                    r.comment && 'text-muted-foreground',
                  )}
                >
                  {r.lines.map((l) => l || ' ').join('\n')}
                </code>
              )}
            </div>
          )
        })}
      </pre>
    </div>
  )
}

/** `# --- Name ---` as it is in the file, with the name as a link to the package. */
function Heading({
  name,
  color,
  onOpen,
}: {
  name: string
  color: string
  onOpen: (() => void) | undefined
}) {
  return (
    <code className="group flex flex-1 items-center pr-4 pl-3 whitespace-pre text-muted-foreground">
      {'# --- '}
      {onOpen ? (
        <button
          onClick={onOpen}
          title={`Open the ${name} package`}
          className="inline-flex items-center gap-1.5 font-sans font-semibold text-foreground hover:underline"
        >
          <span className="size-2 rounded-full" style={{ background: color }} aria-hidden="true" />
          {name}
        </button>
      ) : (
        <span className="font-semibold text-foreground">{name}</span>
      )}
      {' ---'}
      {onOpen && (
        <span className="ml-3 font-sans text-[11px] opacity-0 transition-opacity group-hover:opacity-100">
          Open package
        </span>
      )}
    </code>
  )
}
