import { describe, it, expect } from 'vitest'
import { parse, serialize } from './parser.js'
import { applyManagedBlock } from './managed-block.js'
import { coveredHostnames, MOVED_PREFIX, reconcileShadowedLines } from './shadowed.js'
import { BEGIN_MARKER as B, END_MARKER as E } from './markers.js'

const block = ['# stack: p', '', '1.2.3.4         a.test                         # p']
const covered = coveredHostnames(block)

const run = (text: string, cov: ReadonlySet<string> = covered) => {
  const r = reconcileShadowedLines(parse(text), cov)
  return { text: serialize(r.doc), moved: r.moved, restored: r.restored }
}

describe('coveredHostnames', () => {
  it('reads hostnames from entry lines and ignores comments', () => {
    expect([...coveredHostnames(block)]).toEqual(['a.test'])
    expect([...coveredHostnames(['# 9.9.9.9 x.test # overridden'])]).toEqual([])
  })
})

describe('commenting out', () => {
  it('comments out an entry the block fully covers, keeping the line verbatim', () => {
    const r = run('127.0.0.1 localhost\n9.9.9.9   a.test # old\n')
    expect(r.text).toBe(`127.0.0.1 localhost\n${MOVED_PREFIX}9.9.9.9   a.test # old\n`)
    expect(r.moved).toEqual(['9.9.9.9   a.test # old'])
  })
  it('leaves an entry alone when only some of its hostnames are covered', () => {
    const r = run('9.9.9.9 a.test b.test\n')
    expect(r.text).toBe('9.9.9.9 a.test b.test\n')
    expect(r.moved).toEqual([])
  })
  it('never touches lines inside the managed block', () => {
    const text = `${B}\n1.2.3.4 a.test\n${E}\n`
    expect(run(text).text).toBe(text)
  })
  it('does nothing with an empty covered set', () => {
    expect(run('9.9.9.9 a.test\n', new Set()).moved).toEqual([])
  })
})

describe('restoring', () => {
  it('puts a moved line back once the block no longer covers it', () => {
    const r = run(`${MOVED_PREFIX}9.9.9.9 a.test\n`, new Set())
    expect(r.text).toBe('9.9.9.9 a.test\n')
    expect(r.restored).toEqual(['9.9.9.9 a.test'])
  })
  it('keeps a moved line commented while it is still covered', () => {
    const text = `${MOVED_PREFIX}9.9.9.9 a.test\n`
    expect(run(text).text).toBe(text)
  })
  it('round-trips byte-for-byte: comment out with a block, restore when the block is gone', () => {
    const original = '127.0.0.1\tlocalhost\r\n9.9.9.9   a.test\r\n'
    const on = reconcileShadowedLines(applyManagedBlock(parse(original), block), covered).doc
    expect(serialize(on)).toContain(`${MOVED_PREFIX}9.9.9.9   a.test\r\n`)
    const off = reconcileShadowedLines(applyManagedBlock(on, []), new Set()).doc
    expect(serialize(off)).toBe(original)
  })
})
