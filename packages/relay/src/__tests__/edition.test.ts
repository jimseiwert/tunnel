import { describe, it, expect, afterEach } from 'bun:test'
import { loadConfig } from '../config.js'

const orig = process.env['EDITION']
afterEach(() => {
  if (orig === undefined) delete process.env['EDITION']
  else process.env['EDITION'] = orig
})

describe('relay config edition', () => {
  it('defaults to community', () => {
    delete process.env['EDITION']
    process.env['CONDUIT_JWT_SECRET'] = 'x'
    expect(loadConfig().edition).toBe('community')
  })

  it('reads cloud from EDITION', () => {
    process.env['EDITION'] = 'cloud'
    process.env['CONDUIT_JWT_SECRET'] = 'x'
    expect(loadConfig().edition).toBe('cloud')
  })
})
