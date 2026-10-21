import { describe, it, expect } from 'vitest'
import { parse, serialize } from './parser.js'
import { BEGIN_MARKER, END_MARKER } from './markers.js'

describe('round-trip is byte-identical', () => {
  const corpus = {
    empty: '',
    'lf only': 'a\nb\n',
    'lf, no trailing newline': 'a\nb',
    crlf: 'a\r\nb\r\n',
    'crlf, no trailing newline': 'a\r\nb',
    'mixed endings': 'a\r\nb\nc\r\n',
    'cr only (classic mac)': 'a\rb\r',
    'blank lines': '\n\na\n\n',
    'utf-8 bom': '﻿127.0.0.1 localhost\n',
    'non-ascii comment': '# café test\n1.2.3.4 x\n',
    'tabs and padding': '127.0.0.1\t\tlocalhost   \n',
  }
  for (const [name, text] of Object.entries(corpus))
    it(name, () => expect(serialize(parse(text))).toBe(text))
})

describe('dominant line ending', () => {
  it('detects lf', () => expect(parse('a\nb\n').eol).toBe('\n'))
  it('detects crlf', () => expect(parse('a\r\nb\r\n').eol).toBe('\r\n'))
  it('picks the majority when mixed', () => expect(parse('a\r\nb\r\nc\n').eol).toBe('\r\n'))
  it('defaults to lf for an empty file', () => expect(parse('').eol).toBe('\n'))
})

describe('classification', () => {
  const first = (s: string) => parse(s).lines[0]!
  it('parses a plain entry', () =>
    expect(first('127.0.0.1 localhost')).toMatchObject({
      kind: 'entry',
      ip: '127.0.0.1',
      hostnames: ['localhost'],
    }))
  it('parses tabs, several hostnames and an inline comment', () =>
    expect(first('10.0.4.12\tapi.test\tauth.test # note')).toMatchObject({
      kind: 'entry',
      ip: '10.0.4.12',
      hostnames: ['api.test', 'auth.test'],
    }))
  it('parses an IPv6 entry', () =>
    expect(first('::1 localhost')).toMatchObject({ kind: 'entry', ip: '::1' }))
  it('lowercases hostnames', () =>
    expect(first('1.2.3.4 API.Test')).toMatchObject({ hostnames: ['api.test'] }))
  it('treats a full-line comment as a comment', () =>
    expect(first('   # hello').kind).toBe('comment'))
  it('treats a commented-out entry as a comment, not an entry', () =>
    expect(first('# 127.0.0.1 x').kind).toBe('comment'))
  it('treats whitespace as blank', () => expect(first('   ').kind).toBe('blank'))
  it('treats an IP with no hostname as unknown', () =>
    expect(first('127.0.0.1').kind).toBe('unknown'))
  it('treats garbage as unknown and preserves it', () => {
    const l = first('!!! nonsense')
    expect(l.kind).toBe('unknown')
    expect(l.raw).toBe('!!! nonsense')
  })
  it('captures an inline comment, so first-run import is not lossy', () =>
    expect(first('1.2.3.4 x.test # work vpn')).toMatchObject({ comment: 'work vpn' }))
  it('leaves comment undefined when there is none', () => {
    const l = first('1.2.3.4 x.test')
    expect(l.kind === 'entry' && l.comment).toBeUndefined()
  })
  it('recognises the begin marker', () =>
    expect(first(BEGIN_MARKER + '  ')).toMatchObject({ kind: 'marker', marker: 'begin' }))
  it('recognises the end marker', () =>
    expect(first('  ' + END_MARKER)).toMatchObject({ kind: 'marker', marker: 'end' }))
})

describe('sentinel line', () => {
  it('a file ending in a newline gets a trailing empty sentinel', () => {
    const lines = parse('a\n').lines
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatchObject({ raw: '', eol: '' })
  })
  it('a file not ending in a newline does not', () => {
    expect(parse('a').lines).toHaveLength(1)
  })
})
