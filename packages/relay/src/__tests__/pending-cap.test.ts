import { describe, it, expect } from 'bun:test'
import { PendingRequests } from '../ws/pending.js'

describe('PendingRequests chunk cap', () => {
  it('rejects when accumulated chunks exceed the cap', async () => {
    const pending = new PendingRequests(8) // 8-byte cap
    const p = pending.add('req-1', 'ws-abc', 1000)
    pending.addChunk('req-1', Buffer.from('12345')) // 5 bytes, ok
    pending.addChunk('req-1', Buffer.from('67890')) // +5 = 10 bytes, over cap
    await expect(p).rejects.toThrow(/exceeded/i)
    expect(pending.has('req-1')).toBe(false) // entry cleaned up
  })

  it('does not reject when chunks stay within the cap', async () => {
    const pending = new PendingRequests(1024)
    const p = pending.add('req-2', 'ws-abc', 1000)
    pending.addChunk('req-2', Buffer.from('hello'))
    pending.endStream('req-2')
    pending.resolve('req-2', {
      status: 200,
      headers: {},
      body: null,
      bodyEncoding: 'utf8',
    })
    const resp = await p
    expect(resp.status).toBe(200)
  })
})
