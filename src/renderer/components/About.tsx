// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react'
import { ExternalLink, GitBranch, Scale } from 'lucide-react'
import type { AppInfo, LinkKind } from '../env.js'
import { Logo } from './Logo.js'

/**
 * What this is, who may do what with it, and where it comes from. The licence summary is
 * written to match what the MIT License actually grants, so nobody reads a promise here that
 * the licence text does not keep.
 */
export function About({ hostsPath }: { hostsPath: string }) {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.hostserrer.appInfo().then(setInfo)
  }, [])
  const open = (kind: LinkKind) => void window.hostserrer.openLink(kind)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[560px] px-6 py-10">
        <div className="flex items-center gap-4">
          <Logo className="size-14" />
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">hostserrer</h1>
            <p className="text-[12px] text-muted-foreground">
              {info ? `Version ${info.version}` : ' '}
            </p>
          </div>
        </div>
        <p className="mt-5 text-[13px] leading-relaxed text-muted-foreground">
          A hosts file manager for macOS, Windows and Linux. Keep a library of host records, compose
          them into packages, switch several on at once in an ordered stack, and write the result to
          the file only after you have seen exactly what will change.
        </p>

        <Section title="Links">
          <LinkRow
            icon={<GitBranch className="size-4" />}
            label="Source code on GitHub"
            hint={info?.links.repo}
            onClick={() => open('repo')}
          />
          <LinkRow
            icon={<Scale className="size-4" />}
            label="Read the full licence"
            hint="MIT License"
            onClick={() => open('license')}
          />
        </Section>

        <Section title="Licence">
          <p className="text-[13px] leading-relaxed">
            hostserrer is released under the <span className="font-medium">MIT License</span>. It is
            unmaintained and provided as is, with no support.
          </p>
          <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
            <Li>Use it for anything, at home or at work, for free.</Li>
            <Li>Fork it, change it, redistribute it, with or without your changes.</Li>
            <Li>Keep the copyright notice and licence text in any copy you pass on.</Li>
            <Li>
              It comes with no warranty. It edits a system file, so read the preview before you
              apply.
            </Li>
          </ul>
          <p className="mt-3 text-[12px] text-muted-foreground">
            Copyright © 2026 Dimitrios T. See the LICENSE file in the repository for the full terms.
          </p>
        </Section>

        <Section title="This installation">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
            <Dt>Hosts file</Dt>
            <Dd>{hostsPath}</Dd>
            <Dt>Library and backups</Dt>
            <Dd>{info?.dataDir ?? '…'}</Dd>
            <Dt>Platform</Dt>
            <Dd>{info?.platform ?? '…'}</Dd>
            <Dt>Runtime</Dt>
            <Dd>
              {info
                ? `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`
                : '…'}
            </Dd>
          </dl>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-[11px] font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden="true" className="select-none">
        –
      </span>
      <span>{children}</span>
    </li>
  )
}

function Dt({ children }: { children: React.ReactNode }) {
  return <dt className="text-muted-foreground">{children}</dt>
}
function Dd({ children }: { children: React.ReactNode }) {
  return <dd className="font-mono break-all">{children}</dd>
}

function LinkRow({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  hint?: string | undefined
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-secondary"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px]">{label}</span>
        {hint && <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      <ExternalLink
        className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      />
    </button>
  )
}
