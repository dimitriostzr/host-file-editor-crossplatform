import { describe, it, expect } from 'vitest'
import { parse, serialize } from './parser.js'
import { applyManagedBlock, findManagedBlock, ManagedBlockError } from './managed-block.js'
import { BEGIN_MARKER as B, END_MARKER as E } from './markers.js'

const apply = (text: string, block: string[]) => serialize(applyManagedBlock(parse(text), block))

describe('insert', () => {
  it('appends to a file ending in a newline with exactly one blank separator', () => {
    expect(apply('127.0.0.1 localhost\n', ['1.2.3.4 a.test'])).toBe(
      `127.0.0.1 localhost\n\n${B}\n1.2.3.4 a.test\n${E}\n`,
    )
  })
  it('appends to a file with NO trailing newline without joining onto the last line', () => {
    expect(apply('127.0.0.1 localhost', ['1.2.3.4 a.test'])).toBe(
      `127.0.0.1 localhost\n\n${B}\n1.2.3.4 a.test\n${E}\n`,
    )
  })
  it('does not add a second blank when one is already present', () => {
    expect(apply('a\n\n', ['x'])).toBe(`a\n\n${B}\nx\n${E}\n`)
  })
  it('handles a completely empty file', () => expect(apply('', ['x'])).toBe(`${B}\nx\n${E}\n`))
  it('preserves CRLF throughout, including in inserted lines', () => {
    expect(apply('127.0.0.1 localhost\r\n', ['1.2.3.4 a.test'])).toBe(
      `127.0.0.1 localhost\r\n\r\n${B}\r\n1.2.3.4 a.test\r\n${E}\r\n`,
    )
  })
})

describe('replace and remove', () => {
  const withBlock = `127.0.0.1 localhost\n\n${B}\nold\n${E}\n`
  it('replaces block content in place', () =>
    expect(apply(withBlock, ['new'])).toBe(`127.0.0.1 localhost\n\n${B}\nnew\n${E}\n`))
  it('removes the block and its separator when given no lines', () =>
    expect(apply(withBlock, [])).toBe('127.0.0.1 localhost\n'))
  it('removing from a file with no block is a no-op', () =>
    expect(apply('127.0.0.1 localhost\n', [])).toBe('127.0.0.1 localhost\n'))
  it('never touches foreign lines written by other tools', () => {
    const docker = `127.0.0.1 localhost\n192.168.65.2 host.docker.internal\n\n${B}\nold\n${E}\n`
    expect(apply(docker, ['new'])).toContain('192.168.65.2 host.docker.internal')
    expect(apply(docker, [])).toBe('127.0.0.1 localhost\n192.168.65.2 host.docker.internal\n')
  })
  it('insert then remove returns the original file exactly', () => {
    const orig = '##\n# Host Database\n##\n127.0.0.1\tlocalhost\n::1             localhost\n'
    expect(apply(apply(orig, ['1.2.3.4 x.test']), [])).toBe(orig)
  })
  it('is idempotent when applying the same block twice', () => {
    const once = apply('127.0.0.1 localhost\n', ['1.2.3.4 a.test'])
    expect(apply(once, ['1.2.3.4 a.test'])).toBe(once)
  })
})

describe('purity and splice extent', () => {
  it('does not mutate the document it was given', () => {
    const before = parse('127.0.0.1 localhost') // legal hosts file with no trailing newline
    const snapshot = serialize(before)
    applyManagedBlock(before, ['1.2.3.4 a.test'])
    expect(serialize(before)).toBe(snapshot)
  })

  it('replaces only up to END, leaving lines that follow it alone', () => {
    // Docker and VPN clients append at EOF, so on the second apply their entries sit AFTER our
    // block. Splicing to EOF instead of to END would erase them, as root.
    const mid = `a\n\n${B}\nold\n${E}\n192.168.65.2 host.docker.internal\nz\n`
    const out = apply(mid, ['new'])
    expect(out).toBe(`a\n\n${B}\nnew\n${E}\n192.168.65.2 host.docker.internal\nz\n`)
  })

  it('removes only the block, leaving lines that follow it alone', () => {
    const mid = `a\n\n${B}\nold\n${E}\n192.168.65.2 host.docker.internal\nz\n`
    expect(apply(mid, [])).toBe('a\n192.168.65.2 host.docker.internal\nz\n')
  })
})

describe('malformed markers throw rather than guess', () => {
  const code = (t: string) => {
    try {
      findManagedBlock(parse(t))
      return null
    } catch (e) {
      return (e as ManagedBlockError).code
    }
  }
  it('begin without end', () => expect(code(`${B}\nx\n`)).toBe('begin-without-end'))
  it('end without begin', () => expect(code(`x\n${E}\n`)).toBe('end-without-begin'))
  it('duplicate begins', () => expect(code(`${B}\n${B}\n${E}\n`)).toBe('duplicate-markers'))
  it('duplicate ends', () => expect(code(`${B}\n${E}\n${E}\n`)).toBe('duplicate-markers'))
  it('end before begin', () => expect(code(`${E}\nx\n${B}\n`)).toBe('end-without-begin'))
  it('no markers at all is null, not an error', () => expect(code('a\n')).toBe(null))
  it('applyManagedBlock propagates the error rather than writing', () =>
    expect(() => apply(`${B}\nx\n`, ['y'])).toThrow(ManagedBlockError))
})
