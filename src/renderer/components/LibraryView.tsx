// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useRef, useState } from 'react'
import { Import, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import type { HostRecordDto, PackageDto, ToolKind } from '../env.js'
import { matchesQuery } from '../lib/records.js'
import { kbd, useShortcut } from '../lib/shortcut.js'
import { compareIp, compareText, sortBy, useSort } from '../lib/sort.js'
import { Button, Hostnames, IconButton, Input, PAGE_SIZE, ShowMore, SortableTh } from './ui.js'
import { RecordActions } from './RecordActions.js'
import { RecordFormRow } from './RecordForm.js'

interface Props {
  library: HostRecordDto[]
  packages: PackageDto[]
  onChanged: () => Promise<void>
  onImport: () => void
  onRunTool: (kind: ToolKind, target: string) => void
}

/** Where the user builds the list of records that packages are made from. */
export function LibraryView({ library, packages, onChanged, onImport, onRunTool }: Props) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const search = useRef<HTMLInputElement>(null)
  const { sort, toggle, dirOf } = useSort<'ip' | 'hostnames' | 'note' | 'usedIn'>()

  useShortcut('f', () => search.current?.focus())
  useShortcut('n', () => setAdding(true))
  useEffect(() => setLimit(PAGE_SIZE), [query, sort])

  /** The packages each record is in, by name. */
  const usedIn = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const p of packages)
      if (p.mode === 'managed')
        for (const e of p.entries) m.set(e.recordId, [...(m.get(e.recordId) ?? []), p.name])
    return m
  }, [packages])

  const rows = useMemo(
    () =>
      sortBy(
        library.filter((r) => matchesQuery(r, query)),
        sort,
        {
          ip: (a, b) => compareIp(a.ip, b.ip),
          hostnames: (a, b) => compareText(a.hostnames.join(' '), b.hostnames.join(' ')),
          note: (a, b) => compareText(a.comment ?? '', b.comment ?? ''),
          usedIn: (a, b) => (usedIn.get(a.id)?.length ?? 0) - (usedIn.get(b.id)?.length ?? 0),
        },
      ),
    [library, query, sort, usedIn],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
        <span className="text-[13px] font-medium">Library</span>
        <span className="text-[12px] text-muted-foreground">
          {query
            ? `${rows.length.toLocaleString()} of ${library.length.toLocaleString()}`
            : library.length.toLocaleString()}{' '}
          record{library.length === 1 ? '' : 's'}
        </span>
        <div className="relative ml-auto">
          <Search
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder={`Search  ${kbd('F')}`}
            aria-label="Search the library"
            className="h-7 w-56 pl-7"
          />
        </div>
        <Button
          variant="secondary"
          className="h-7"
          onClick={onImport}
          title="Paste lines from a hosts file or a blocklist"
        >
          <Import className="size-3.5" aria-hidden="true" />
          Import
        </Button>
        <Button
          variant="primary"
          className="h-7"
          onClick={() => setAdding(true)}
          disabled={adding}
          title={`Add record (${kbd('N')})`}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add record
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b text-[11px] font-medium text-muted-foreground">
              <SortableTh className="w-44 px-4" dir={dirOf('ip')} onClick={() => toggle('ip')}>
                IP address
              </SortableTh>
              <SortableTh
                className="px-2"
                dir={dirOf('hostnames')}
                onClick={() => toggle('hostnames')}
              >
                Hostnames
              </SortableTh>
              <SortableTh className="w-56 px-2" dir={dirOf('note')} onClick={() => toggle('note')}>
                Note
              </SortableTh>
              <SortableTh
                className="w-48 px-2"
                dir={dirOf('usedIn')}
                onClick={() => toggle('usedIn')}
              >
                Used in
              </SortableTh>
              <th className="w-40 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {adding && (
              <RecordFormRow
                layout="library"
                submitLabel="Add"
                onCancel={() => setAdding(false)}
                onSubmit={async (v) => {
                  const r = await window.hostserrer.addRecord(v)
                  if (r.ok) {
                    setAdding(false)
                    await onChanged()
                  }
                  return r
                }}
              />
            )}
            {library.length === 0 && !adding && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-[13px] text-muted-foreground"
                >
                  No records yet. Add an IP address and the hostnames that should point to it, or
                  import lines from a hosts file or a blocklist.
                </td>
              </tr>
            )}
            {library.length > 0 && rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-[13px] text-muted-foreground"
                >
                  Nothing matches “{query.trim()}”.
                </td>
              </tr>
            )}
            {rows.slice(0, limit).map((r) => {
              if (editingId === r.id)
                return (
                  <RecordFormRow
                    key={r.id}
                    layout="library"
                    initial={r}
                    submitLabel="Save"
                    onCancel={() => setEditingId(null)}
                    onSubmit={async (v) => {
                      const res = await window.hostserrer.updateRecord({ id: r.id, ...v })
                      if (res.ok) {
                        setEditingId(null)
                        await onChanged()
                      }
                      return res
                    }}
                  />
                )
              const pkgs = usedIn.get(r.id) ?? []
              return (
                <tr key={r.id} className="group border-b hover:bg-secondary/50">
                  <td className="px-4 py-1.5 font-mono text-[12.5px]">{r.ip}</td>
                  <td className="px-2 py-1.5 font-mono text-[12.5px]">
                    <Hostnames names={r.hostnames} />
                  </td>
                  <td className="px-2 py-1.5 text-[12px] text-muted-foreground">{r.comment}</td>
                  <td
                    className="max-w-48 truncate px-2 py-1.5 text-[12px] text-muted-foreground"
                    title={pkgs.join(', ')}
                  >
                    {pkgs.length === 0 ? (
                      <span className="text-muted-foreground/60">No package</span>
                    ) : (
                      pkgs.join(', ')
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <span className="inline-flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <RecordActions target={r.hostnames[0] ?? r.ip} onRunTool={onRunTool} />
                      <IconButton
                        aria-label="Edit record"
                        title="Edit"
                        onClick={() => setEditingId(r.id)}
                      >
                        <Pencil className="size-3.5" />
                      </IconButton>
                      <IconButton
                        aria-label="Delete record"
                        title="Delete"
                        onClick={async () => {
                          const n = pkgs.length
                          const ok =
                            n === 0 ||
                            (await window.hostserrer.confirm({
                              message: 'Delete this record?',
                              detail: `It is also removed from ${pkgs.join(', ')}.`,
                              confirmLabel: 'Delete',
                            }))
                          if (!ok) return
                          await window.hostserrer.deleteRecord(r.id)
                          await onChanged()
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <ShowMore
          shown={Math.min(limit, rows.length)}
          total={rows.length}
          onMore={() => setLimit((l) => l + PAGE_SIZE * 4)}
        />
      </div>
    </div>
  )
}
