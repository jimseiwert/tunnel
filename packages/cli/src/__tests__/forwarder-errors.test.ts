import { describe, it, expect } from 'bun:test'
import { relayUnreachableMessage } from '../ws/client.js'

describe('relayUnreachableMessage', () => {
  it('names the relay URL and a next step', () => {
    const msg = relayUnreachableMessage('wss://relay.example.com')
    expect(msg).toContain('relay.example.com')
    expect(msg).toMatch(/reach|connect|running/i)
  })
})
