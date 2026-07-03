import { describe, it, expect } from 'bun:test'
import { timingSafeEqualStr } from '../util/timing-safe.js'

describe('timingSafeEqualStr', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeEqualStr('secret-abc', 'secret-abc')).toBe(true)
  })
  it('returns false for different same-length strings', () => {
    expect(timingSafeEqualStr('secret-abc', 'secret-xyz')).toBe(false)
  })
  it('returns false for different-length strings', () => {
    expect(timingSafeEqualStr('short', 'a-much-longer-secret')).toBe(false)
  })
  it('returns true for two empty strings', () => {
    expect(timingSafeEqualStr('', '')).toBe(true)
  })
  it('handles unicode without throwing', () => {
    expect(timingSafeEqualStr('café', 'café')).toBe(true)
    expect(timingSafeEqualStr('café', 'cafe')).toBe(false)
  })
})
