import { describe, it, expect } from 'bun:test'
import { resolveEdition } from '../edition.js'

describe('resolveEdition', () => {
  it('returns community when EDITION is unset', () => {
    expect(resolveEdition({})).toBe('community')
  })

  it('returns cloud when EDITION=cloud', () => {
    expect(resolveEdition({ EDITION: 'cloud' })).toBe('cloud')
  })

  it('returns community for any unknown value', () => {
    expect(resolveEdition({ EDITION: 'enterprise' })).toBe('community')
    expect(resolveEdition({ EDITION: '' })).toBe('community')
  })
})
