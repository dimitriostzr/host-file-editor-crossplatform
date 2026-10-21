import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { writeJsonAtomic, readJsonValidated } from './store.js'

const Schema = z.object({ n: z.number(), s: z.string().default('hi') })
const fallback = () => ({ n: 0, s: 'hi' })
let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hostserrer-store-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('writeJsonAtomic', () => {
  it('writes readable, pretty-printed json ending in a newline', async () => {
    const p = join(dir, 'a.json')
    await writeJsonAtomic(p, { n: 1 })
    const text = await readFile(p, 'utf8')
    expect(JSON.parse(text)).toEqual({ n: 1 })
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  ')
  })
  it('creates missing parent directories', async () => {
    await writeJsonAtomic(join(dir, 'deep', 'nested', 'a.json'), { n: 1 })
    expect(JSON.parse(await readFile(join(dir, 'deep', 'nested', 'a.json'), 'utf8'))).toEqual({
      n: 1,
    })
  })
  it('overwrites an existing file', async () => {
    const p = join(dir, 'a.json')
    await writeJsonAtomic(p, { n: 1 })
    await writeJsonAtomic(p, { n: 2 })
    expect(JSON.parse(await readFile(p, 'utf8'))).toEqual({ n: 2 })
  })
  it('leaves no temp files behind', async () => {
    await writeJsonAtomic(join(dir, 'a.json'), { n: 1 })
    expect((await readdir(dir)).filter((f) => f.includes('.tmp'))).toEqual([])
  })
  it('survives concurrent writes to the same path', async () => {
    const p = join(dir, 'a.json')
    await Promise.all([1, 2, 3, 4, 5].map((n) => writeJsonAtomic(p, { n })))
    const parsed = JSON.parse(await readFile(p, 'utf8')) as { n: number }
    expect([1, 2, 3, 4, 5]).toContain(parsed.n)
    expect((await readdir(dir)).filter((f) => f.includes('.tmp'))).toEqual([])
  })
})

describe('readJsonValidated', () => {
  it('returns the fallback when the file is missing, without quarantining', async () => {
    const r = await readJsonValidated(join(dir, 'nope.json'), Schema, fallback)
    expect(r).toEqual({ data: { n: 0, s: 'hi' }, recovered: false })
    expect((await readdir(dir)).some((f) => f.endsWith('.corrupt'))).toBe(false)
  })
  it('applies schema defaults', async () => {
    const p = join(dir, 'a.json')
    await writeJsonAtomic(p, { n: 5 })
    expect((await readJsonValidated(p, Schema, fallback)).data).toEqual({ n: 5, s: 'hi' })
  })
  it('quarantines malformed json and reports recovery', async () => {
    const p = join(dir, 'a.json')
    await writeFile(p, '{ not json', 'utf8')
    const r = await readJsonValidated(p, Schema, fallback)
    expect(r.recovered).toBe(true)
    expect(r.data).toEqual({ n: 0, s: 'hi' })
    expect((await readdir(dir)).some((f) => f.endsWith('.corrupt'))).toBe(true)
  })
  it('quarantines schema-invalid json', async () => {
    const p = join(dir, 'a.json')
    await writeJsonAtomic(p, { n: 'not a number' })
    const r = await readJsonValidated(p, Schema, fallback)
    expect(r.recovered).toBe(true)
    expect((await readdir(dir)).some((f) => f.endsWith('.corrupt'))).toBe(true)
  })
  it('the quarantined file keeps the original bytes for the bug report', async () => {
    const p = join(dir, 'a.json')
    await writeFile(p, '{ broken', 'utf8')
    await readJsonValidated(p, Schema, fallback)
    const bad = (await readdir(dir)).find((f) => f.endsWith('.corrupt'))!
    expect(await readFile(join(dir, bad), 'utf8')).toBe('{ broken')
  })
  it('the quarantine name has no characters illegal on windows', async () => {
    const p = join(dir, 'a.json')
    await writeFile(p, 'x', 'utf8')
    await readJsonValidated(p, Schema, fallback)
    const bad = (await readdir(dir)).find((f) => f.endsWith('.corrupt'))!
    expect(/[:*?"<>|]/.test(bad)).toBe(false)
  })
})
