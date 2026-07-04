import { describe, it, expect } from 'bun:test'
import { MemoryStorageAdapter } from '../storage/memory.js'

describe('slug token validation (memory)', () => {
  it('returns valid for the correct token', async () => {
    const s = new MemoryStorageAdapter(100)
    const future = Math.floor(Date.now() / 1000) + 3600
    await s.registerSlug('ws-abc', 'tok-correct', future)
    expect(await s.validateSlug('ws-abc', 'tok-correct')).toBe('valid')
  })
  it('returns invalid for a wrong token of the same length', async () => {
    const s = new MemoryStorageAdapter(100)
    const future = Math.floor(Date.now() / 1000) + 3600
    await s.registerSlug('ws-abc', 'tok-correct', future)
    expect(await s.validateSlug('ws-abc', 'tok-wrongxx')).toBe('invalid')
  })
  it('returns invalid for a wrong-length token', async () => {
    const s = new MemoryStorageAdapter(100)
    const future = Math.floor(Date.now() / 1000) + 3600
    await s.registerSlug('ws-abc', 'tok-correct', future)
    expect(await s.validateSlug('ws-abc', 'x')).toBe('invalid')
  })
  it('rejects renew with a wrong old token', async () => {
    const s = new MemoryStorageAdapter(100)
    const future = Math.floor(Date.now() / 1000) + 3600
    await s.registerSlug('ws-abc', 'tok-correct', future)
    expect(await s.renewSlug('ws-abc', 'tok-wrongxx', 'tok-new', future)).toBe(false)
    expect(await s.renewSlug('ws-abc', 'tok-correct', 'tok-new', future)).toBe(true)
  })
})
