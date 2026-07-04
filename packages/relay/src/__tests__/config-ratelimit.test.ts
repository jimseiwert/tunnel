import { describe, it, expect, afterEach } from 'bun:test'
import { loadConfig } from '../config.js'

const KEYS = ['RATE_LIMIT_MAX', 'RATE_LIMIT_WINDOW_MS'] as const
const saved: Record<string, string | undefined> = {}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function snapshot() {
  for (const k of KEYS) saved[k] = process.env[k]
}

describe('rate-limit config parsing', () => {
  it('defaults when unset', () => {
    snapshot()
    delete process.env['RATE_LIMIT_MAX']
    delete process.env['RATE_LIMIT_WINDOW_MS']
    process.env['CONDUIT_JWT_SECRET'] = 'x'
    const c = loadConfig()
    expect(c.rateLimitMax).toBe(120)
    expect(c.rateLimitWindowMs).toBe(60000)
  })

  it('falls back to default (not NaN/disabled) for a non-numeric max', () => {
    snapshot()
    process.env['RATE_LIMIT_MAX'] = 'abc'
    process.env['CONDUIT_JWT_SECRET'] = 'x'
    const c = loadConfig()
    expect(c.rateLimitMax).toBe(120)
    expect(Number.isNaN(c.rateLimitMax)).toBe(false)
  })

  it('preserves an explicit 0 (disable)', () => {
    snapshot()
    process.env['RATE_LIMIT_MAX'] = '0'
    process.env['CONDUIT_JWT_SECRET'] = 'x'
    expect(loadConfig().rateLimitMax).toBe(0)
  })

  it('clamps a non-positive window to the minimum', () => {
    snapshot()
    process.env['RATE_LIMIT_WINDOW_MS'] = '0'
    process.env['CONDUIT_JWT_SECRET'] = 'x'
    expect(loadConfig().rateLimitWindowMs).toBe(1)
  })
})
