import { describe, it, expect } from 'bun:test'
import {
  DEFAULT_RELAY_WS_URL,
  DEFAULT_RELAY_HTTP_URL,
  DEFAULT_DASHBOARD_URL,
  isDefaultRelayHost,
} from '../config.js'

describe('default URL constants', () => {
  it('exposes the SaaS defaults', () => {
    expect(DEFAULT_RELAY_WS_URL).toBe('wss://relay.conduitrelay.com')
    expect(DEFAULT_RELAY_HTTP_URL).toBe('https://relay.conduitrelay.com')
    expect(DEFAULT_DASHBOARD_URL).toBe('https://app.conduitrelay.com')
  })

  it('isDefaultRelayHost matches the SaaS relay host, ws or https', () => {
    expect(isDefaultRelayHost('wss://relay.conduitrelay.com')).toBe(true)
    expect(isDefaultRelayHost('https://relay.conduitrelay.com/x')).toBe(true)
    expect(isDefaultRelayHost('wss://relay.mycompany.com')).toBe(false)
    expect(isDefaultRelayHost('')).toBe(false)
  })
})
