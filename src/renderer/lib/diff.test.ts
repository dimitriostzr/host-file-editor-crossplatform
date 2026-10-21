import { describe, it, expect } from 'vitest'
import { diffLines } from './diff.js'

describe('diffLines', () => {
  it('does not show a phantom empty line for a trailing newline', () => {
    expect(diffLines('a\nb\n', 'a\nb\nc\n')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
      { kind: 'add', text: 'c' },
    ])
  })
  it('still diffs a file with no trailing newline', () => {
    expect(diffLines('a', 'a\nb')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'add', text: 'b' },
    ])
  })
  it('treats an empty file as having no lines', () => {
    expect(diffLines('', 'a\n')).toEqual([{ kind: 'add', text: 'a' }])
  })

  it('keeps unchanged lines around a change in the middle', () => {
    expect(diffLines('a\nb\nc\nd\n', 'a\nb\nX\nc\nd\n')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
      { kind: 'add', text: 'X' },
      { kind: 'same', text: 'c' },
      { kind: 'same', text: 'd' },
    ])
  })
  it('pairs a replaced line as remove then add', () => {
    expect(diffLines('a\nold\nz\n', 'a\nnew\nz\n')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'remove', text: 'old' },
      { kind: 'add', text: 'new' },
      { kind: 'same', text: 'z' },
    ])
  })
  it('finds common lines inside the changed region', () => {
    expect(diffLines('a\nb\nc\n', 'x\nb\ny\n')).toEqual([
      { kind: 'remove', text: 'a' },
      { kind: 'add', text: 'x' },
      { kind: 'same', text: 'b' },
      { kind: 'remove', text: 'c' },
      { kind: 'add', text: 'y' },
    ])
  })
  it('handles a blocklist-sized change without building a huge table', () => {
    const head = Array.from({ length: 50_000 }, (_, i) => `10.0.0.1 h${i}.test`).join('\n')
    const block = Array.from({ length: 80_000 }, (_, i) => `0.0.0.0 ad${i}.test`).join('\n')
    const started = performance.now()
    const d = diffLines(`${head}\n`, `${head}\n${block}\n`)
    expect(performance.now() - started).toBeLessThan(2000)
    expect(d.filter((l) => l.kind === 'add')).toHaveLength(80_000)
    expect(d.filter((l) => l.kind === 'same')).toHaveLength(50_000)
  })
  it('falls back to remove-then-add when the changed region is too large to align', () => {
    const before = Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n')
    const after = Array.from({ length: 3000 }, (_, i) => `b${i}`).join('\n')
    const d = diffLines(before, after)
    expect(d.slice(0, 3000).every((l) => l.kind === 'remove')).toBe(true)
    expect(d.slice(3000).every((l) => l.kind === 'add')).toBe(true)
  })
})
