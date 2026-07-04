import { describe, it, expect } from 'bun:test'
import { loginRequiredMessage } from '../commands/start.js'

describe('loginRequiredMessage', () => {
  it('names the login command and the relay', () => {
    const msg = loginRequiredMessage('wss://relay.conduitrelay.com')
    expect(msg).toContain('conduit login')
    expect(msg).toContain('relay.conduitrelay.com')
  })
  it('mentions the self-host escape hatch', () => {
    const msg = loginRequiredMessage('wss://relay.conduitrelay.com')
    expect(msg).toMatch(/CONDUIT_RELAY_URL|self-host/i)
  })
})
