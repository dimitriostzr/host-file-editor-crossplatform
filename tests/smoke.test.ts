import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { isIP } from 'node:net'

describe('toolchain', () => {
  it('runs zod 4', () => expect(z.string().parse('ok')).toBe('ok'))
  it('has node:net', () => expect(isIP('127.0.0.1')).toBe(4))
})
