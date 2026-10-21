import { describe, it, expect } from 'vitest'
import { BEGIN_MARKER, END_MARKER } from './markers.js'

describe('markers', () => {
  it('BEGIN is frozen — changing it orphans every existing managed block', () => {
    expect(BEGIN_MARKER).toBe('# >>> hostserrer: BEGIN (managed) >>>')
  })
  it('END is frozen', () => {
    expect(END_MARKER).toBe('# <<< hostserrer: END <<<')
  })
  it('both are comments, so an unaware parser ignores them', () => {
    expect(BEGIN_MARKER.startsWith('#')).toBe(true)
    expect(END_MARKER.startsWith('#')).toBe(true)
  })
  it('both are ASCII-only', () => {
    expect(/^[\x20-\x7e]+$/.test(BEGIN_MARKER)).toBe(true)
    expect(/^[\x20-\x7e]+$/.test(END_MARKER)).toBe(true)
  })
})
