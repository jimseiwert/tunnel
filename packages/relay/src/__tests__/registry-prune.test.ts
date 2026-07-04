import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test'
import { ConnectionRegistry } from '../ws/registry.js'

// Minimal WebSocket stand-in — the registry only stores the reference.
const fakeWs = () => ({ readyState: 1, OPEN: 1, send: () => {} }) as any

describe('ConnectionRegistry grace-period pruning', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('deletes the connection entry after the grace period when no owner or watchers remain', () => {
    const r = new ConnectionRegistry()
    r.setOwner('ws-abc', fakeWs())
    expect(r.hasConnection('ws-abc')).toBe(true)
    r.clearOwner('ws-abc')
    expect(r.hasConnection('ws-abc')).toBe(true) // still in grace period
    jest.advanceTimersByTime(30_000)
    expect(r.hasConnection('ws-abc')).toBe(false) // pruned
  })

  it('keeps the connection if watchers remain after grace period', () => {
    const r = new ConnectionRegistry()
    r.setOwner('ws-abc', fakeWs())
    r.addWatcher('ws-abc', fakeWs())
    r.clearOwner('ws-abc')
    jest.advanceTimersByTime(30_000)
    expect(r.hasConnection('ws-abc')).toBe(true) // watcher keeps it alive
  })
})
