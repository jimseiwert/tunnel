import { describe, it, expect } from 'bun:test'
import { FixedWindowRateLimiter } from '../util/rate-limit.js'

describe('FixedWindowRateLimiter', () => {
  it('allows up to max requests then blocks within the window', () => {
    let now = 1000
    const rl = new FixedWindowRateLimiter(3, 1000, () => now)
    expect(rl.check('ip1')).toBe(true)
    expect(rl.check('ip1')).toBe(true)
    expect(rl.check('ip1')).toBe(true)
    expect(rl.check('ip1')).toBe(false) // 4th within window
  })

  it('resets after the window elapses', () => {
    let now = 1000
    const rl = new FixedWindowRateLimiter(1, 1000, () => now)
    expect(rl.check('ip1')).toBe(true)
    expect(rl.check('ip1')).toBe(false)
    now += 1001
    expect(rl.check('ip1')).toBe(true) // new window
  })

  it('tracks keys independently', () => {
    let now = 1000
    const rl = new FixedWindowRateLimiter(1, 1000, () => now)
    expect(rl.check('ip1')).toBe(true)
    expect(rl.check('ip2')).toBe(true)
    expect(rl.check('ip1')).toBe(false)
  })

  it('sweep removes expired entries', () => {
    let now = 1000
    const rl = new FixedWindowRateLimiter(1, 1000, () => now)
    rl.check('ip1')
    now += 1001
    rl.sweep()
    // After sweep, ip1's window is gone, so it gets a fresh allowance.
    expect(rl.check('ip1')).toBe(true)
  })
})
