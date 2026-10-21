// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, Trash2, X } from 'lucide-react'
import type { HostRecordDto, PackageDto, ToolKind } from '../env.js'
import { cn } from '../lib/cn.js'
import { matchesQuery } from '../lib/records.js'
import { kbd, useShortcut } from '../lib/shortcut.js'
import { compareIp, compareText, sortBy, useSort } from '../lib/sort.js'
import {
  Button,
  ErrorText,
  Field,
  Hostnames,
  IconButton,
  Input,
  PAGE_SIZE,
  ShowMore,
  SortableTh,
  Switch,
} from './ui.js'
import { RecordActions } from './RecordActions.js'
import { RecordFormRow } from './RecordForm.js'

interface Props {
  pkg: Extract<PackageDto, { mode: 'managed' }>
  library: HostRecordDto[]
  isActive: boolean
  onChanged: () => Promise<void>
  onDeleted: () => void
  onRunTool: (kind: ToolKind, target: string) => void
}

type SortKey = 'ip' | 'hostnames' | 'note'

/**
 * A package in two parts: the records in it, each switched on (written to the file) or off
 * (kept, not written), and below that the rest of the library, ready to add. New records can
 * be created here directly; they go into the library and straight into this package.
 */
export function PackageEditor({ pkg, library, isActive, onChanged, onDeleted, onRunTool }: Props) {
  const [name, setName] = useState(pkg.name)
  const [description, setDescription] = useState(pkg.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [memberLimit, setMemberLimit] = useState(PAGE_SIZE)
  const [restLimit, setRestLimit] = useState(PAGE_SIZE)
  const search = useRef<HTMLInputElement>(null)
  const { sort, toggle, dirOf } = useSort<SortKey>()

  useShortcut('f', () => search.current?.focus())
  useShortcut('n', () => setAdding(true))

  useEffect(() => {
    setName(pkg.name)
    setDescription(pkg.description ?? '')
    setError(null)
  }, [pkg.id, pkg.name, pkg.description])
  useEffect(() => {
    setQuery('')
    setAdding(false)
  }, [pkg.id])
  useEffect(() => {
    setMemberLimit(PAGE_SIZE)
    setRestLimit(PAGE_SIZE)
  }, [pkg.id, query, sort])

  const membership = useMemo(
    () => new Map(pkg.entries.map((e) => [e.recordId, e.enabled])),
    [pkg.entries],
  )
  const memberIds = useMemo(() => pkg.entries.map((e) => e.recordId), [pkg.entries])
  const detailsDirty = name !== pkg.name || description !== (pkg.description ?? '')

  const { members, rest } = useMemo(() => {
    const comparators = {
      ip: (a: HostRecordDto, b: HostRecordDto) => compareIp(a.ip, b.ip),
      hostnames: (a: HostRecordDto, b: HostRecordDto) =>
        compareText(a.hostnames.join(' '), b.hostnames.join(' ')),
      note: (a: HostRecordDto, b: HostRecordDto) => compareText(a.comment ?? '', b.comment ?? ''),
    }
    const shown = library.filter((r) => matchesQuery(r, query))
    return {
      members: sortBy(
        shown.filter((r) => membership.has(r.id)),
        sort,
        comparators,
      ),
      rest: sortBy(
        shown.filter((r) => !membership.has(r.id)),
        sort,
        comparators,
      ),
    }
  }, [library, query, sort, membership])

  const report = async (pending: Promise<{ ok: boolean; message?: string }>) => {
    const r = await pending
    setError(r.ok ? null : (r.message ?? 'Could not save'))
    await onChanged()
  }
  const saveDetails = () =>
    report(
      window.hostserrer.updatePackage({
        id: pkg.id,
        name: name.trim(),
        description: description.trim(),
      }),
    )
  const setMembers = (ids: string[]) =>
    report(window.hostserrer.updatePackage({ id: pkg.id, recordIds: ids }))
  const setEnabled = (enabled: boolean, recordIds: string[]) =>
    report(window.hostserrer.setEntriesEnabled({ packageId: pkg.id, enabled, recordIds }))
  const add = (ids: string[]) => setMembers([...memberIds, ...ids])
  const remove = (ids: string[]) => {
    const drop = new Set(ids)
    return setMembers(memberIds.filter((id) => !drop.has(id)))
  }

  const filtering = query.trim() !== ''
  const scope = filtering ? 'shown' : 'all'
  const enabledCount = pkg.entries.filter((e) => e.enabled).length
  const memberShownIds = members.map((r) => r.id)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
        <span className="text-[13px] font-medium">{pkg.name}</span>
        <span className="text-[12px] text-muted-foreground">
          {enabledCount.toLocaleString()} of {memberIds.length.toLocaleString()} record
          {memberIds.length === 1 ? '' : 's'} on
          {isActive ? ' · switched on' : ' · switched off in the sidebar'}
        </span>
        <Button
          variant="ghost"
          className="ml-auto text-destructive hover:text-destructive"
          onClick={async () => {
            const ok = await window.hostserrer.confirm({
              message: `Delete the package "${pkg.name}"?`,
              detail: 'Its records stay in the library.',
              confirmLabel: 'Delete',
            })
            if (!ok) return
            await window.hostserrer.deletePackage(pkg.id)
            onDeleted()
            await onChanged()
          }}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Delete package
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <form
          className="grid grid-cols-[1fr_2fr_auto] items-end gap-3 border-b px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault()
            void saveDetails()
          }}
        >
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this package is for"
            />
          </Field>
          <Button type="submit" variant="primary" disabled={!detailsDirty || !name.trim()}>
            Save
          </Button>
          {error && (
            <div className="col-span-3 -mt-1">
              <ErrorText>{error}</ErrorText>
            </div>
          )}
        </form>

        <div className="flex items-center gap-2 px-4 py-2">
          <div className="relative">
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
              placeholder={`Filter records  ${kbd('F')}`}
              aria-label="Filter records"
              className="h-7 w-64 pl-7"
            />
          </div>
          <Button
            variant="primary"
            className="ml-auto h-7"
            onClick={() => setAdding(true)}
            disabled={adding}
            title={`New record in this package (${kbd('N')})`}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            New record
          </Button>
        </div>

        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-y text-[11px] font-medium text-muted-foreground">
              <th className="w-16 py-1.5 pl-4 text-left font-medium">On</th>
              <SortableTh className="w-44 px-2" dir={dirOf('ip')} onClick={() => toggle('ip')}>
                IP address
              </SortableTh>
              <SortableTh
                className="px-2"
                dir={dirOf('hostnames')}
                onClick={() => toggle('hostnames')}
              >
                Hostnames
              </SortableTh>
              <SortableTh className="w-48 px-2" dir={dirOf('note')} onClick={() => toggle('note')}>
                Note
              </SortableTh>
              <th className="w-36 px-2 py-1.5" />
            </tr>
          </thead>

          <tbody>
            <SectionRow
              title="In this package"
              count={members.length}
              actions={
                <>
                  <Button
                    variant="ghost"
                    className="h-6 px-2 text-[12px]"
                    disabled={members.length === 0}
                    onClick={() => void setEnabled(true, memberShownIds)}
                  >
                    Switch {scope} on
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-6 px-2 text-[12px]"
                    disabled={members.length === 0}
                    onClick={() => void setEnabled(false, memberShownIds)}
                  >
                    Switch {scope} off
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-6 px-2 text-[12px]"
                    disabled={members.length === 0}
                    onClick={() => void remove(memberShownIds)}
                  >
                    Remove {scope}
                  </Button>
                </>
              }
            />
            {adding && (
              <RecordFormRow
                layout="package"
                submitLabel="Add"
                onCancel={() => setAdding(false)}
                onSubmit={async (v) => {
                  const r = await window.hostserrer.addRecord({ ...v, packageId: pkg.id })
                  if (r.ok) {
                    setAdding(false)
                    await onChanged()
                  }
                  return r
                }}
              />
            )}
            {members.length === 0 && !adding && (
              <EmptyRow>
                {filtering
                  ? 'No record in this package matches the filter.'
                  : 'Nothing in this package yet. Add records from the library below, or create a new one.'}
              </EmptyRow>
            )}
            {members.slice(0, memberLimit).map((r) => {
              const on = membership.get(r.id) === true
              return (
                <tr key={r.id} className="group border-b hover:bg-secondary/50">
                  <td className="py-1.5 pl-4">
                    <Switch
                      checked={on}
                      onChange={() => void setEnabled(!on, [r.id])}
                      label={`${on ? 'Switch off' : 'Switch on'} ${r.hostnames[0] ?? r.ip}`}
                    />
                  </td>
                  <RecordCells record={r} muted={!on} struck={!on} />
                  <td className="px-2 py-1 text-right">
                    <span className="inline-flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <RecordActions target={r.hostnames[0] ?? r.ip} onRunTool={onRunTool} />
                      <IconButton
                        aria-label="Remove from package"
                        title="Remove from this package (stays in the library)"
                        onClick={() => void remove([r.id])}
                      >
                        <X className="size-3.5" />
                      </IconButton>
                    </span>
                  </td>
                </tr>
              )
            })}
            {members.length > memberLimit && (
              <tr>
                <td colSpan={5}>
                  <ShowMore
                    shown={memberLimit}
                    total={members.length}
                    onMore={() => setMemberLimit((l) => l + PAGE_SIZE * 4)}
                  />
                </td>
              </tr>
            )}

            <SectionRow
              title="Add from the library"
              count={rest.length}
              actions={
                <Button
                  variant="ghost"
                  className="h-6 px-2 text-[12px]"
                  disabled={rest.length === 0}
                  onClick={() => void add(rest.map((r) => r.id))}
                >
                  Add {scope}
                </Button>
              }
            />
            {rest.length === 0 && (
              <EmptyRow>
                {library.length === 0
                  ? 'The library is empty. Use New record above, or import lines in the Library.'
                  : filtering
                    ? 'No other library record matches the filter.'
                    : 'Every record in the library is in this package.'}
              </EmptyRow>
            )}
            {rest.slice(0, restLimit).map((r) => (
              <tr key={r.id} className="group border-b hover:bg-secondary/50">
                <td className="py-1 pl-3">
                  <IconButton
                    aria-label={`Add ${r.hostnames[0] ?? r.ip} to this package`}
                    title="Add to this package, switched on"
                    onClick={() => void add([r.id])}
                  >
                    <Plus className="size-3.5" />
                  </IconButton>
                </td>
                <RecordCells record={r} muted />
                <td className="px-2 py-1 text-right">
                  <span className="inline-flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <RecordActions target={r.hostnames[0] ?? r.ip} onRunTool={onRunTool} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ShowMore
          shown={Math.min(restLimit, rest.length)}
          total={rest.length}
          onMore={() => setRestLimit((l) => l + PAGE_SIZE * 4)}
        />
      </div>
    </div>
  )
}

function SectionRow({
  title,
  count,
  actions,
}: {
  title: string
  count: number
  actions: React.ReactNode
}) {
  return (
    <tr className="border-b bg-secondary/40">
      <td colSpan={5} className="px-4 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold">{title}</span>
          <span className="text-[12px] text-muted-foreground">{count.toLocaleString()}</span>
          <span className="ml-auto flex items-center gap-1">{actions}</span>
        </div>
      </td>
    </tr>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <tr className="border-b">
      <td colSpan={5} className="px-4 py-5 text-center text-[12px] text-muted-foreground">
        {children}
      </td>
    </tr>
  )
}

function RecordCells({
  record: r,
  muted,
  struck,
}: {
  record: HostRecordDto
  muted?: boolean
  struck?: boolean
}) {
  return (
    <>
      <td className={cn('px-2 py-1.5 font-mono text-[12.5px]', muted && 'text-muted-foreground')}>
        {r.ip}
      </td>
      <td
        className={cn(
          'px-2 py-1.5 font-mono text-[12.5px]',
          muted && 'text-muted-foreground',
          struck && 'line-through',
        )}
      >
        <Hostnames names={r.hostnames} />
      </td>
      <td className="px-2 py-1.5 text-[12px] text-muted-foreground">{r.comment}</td>
    </>
  )
}
