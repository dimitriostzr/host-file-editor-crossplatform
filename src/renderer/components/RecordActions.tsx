// SPDX-License-Identifier: MIT

import { Activity, Globe, Route, Search } from 'lucide-react'
import type { LookupKind, ToolKind } from '../env.js'
import { IconButton } from './ui.js'

interface Props {
  /** The hostname the tools act on. For a record with several, the first. */
  target: string
  onRunTool: (kind: ToolKind, target: string) => void
}

/** Search, DNS check, ping and traceroute for one hostname. Lookups open in the browser. */
export function RecordActions({ target, onRunTool }: Props) {
  const lookup = (kind: LookupKind) => void window.hostserrer.openLookup({ kind, target })
  return (
    <span className="inline-flex">
      <IconButton
        title={`Search Google for ${target}`}
        aria-label={`Search Google for ${target}`}
        onClick={() => lookup('google')}
      >
        <Search className="size-3.5" />
      </IconButton>
      <IconButton
        title={`Check public DNS for ${target}`}
        aria-label={`Check public DNS for ${target}`}
        onClick={() => lookup('dnschecker')}
      >
        <Globe className="size-3.5" />
      </IconButton>
      <IconButton
        title={`Ping ${target}`}
        aria-label={`Ping ${target}`}
        onClick={() => onRunTool('ping', target)}
      >
        <Activity className="size-3.5" />
      </IconButton>
      <IconButton
        title={`Trace the route to ${target}`}
        aria-label={`Trace the route to ${target}`}
        onClick={() => onRunTool('traceroute', target)}
      >
        <Route className="size-3.5" />
      </IconButton>
    </span>
  )
}
