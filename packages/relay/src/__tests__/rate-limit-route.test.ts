import { describe, it, expect, afterEach } from 'bun:test'
import { createServer } from '../server.js'
import { MemoryStorageAdapter } from '../storage/memory.js'
import type { RelayConfig } from '../config.js'

function cfg(overrides: Partial<RelayConfig> = {}): RelayConfig {
  return {
    port: 0,
    jwtSecret: 'test-secret',
    authRequired: false,
    ringBufferSize: 1000,
    maxBodyBytes: 1048576,
    forwardTimeoutMs: 30000,
    storageAdapter: 'memory',
    relayDomain: 'localhost:3000',
    relayProto: 'http',
    rateLimitMax: 2,
    rateLimitWindowMs: 60000,
    ...overrides,
  }
}

describe('HTTP rate limiting', () => {
  let app: Awaited<ReturnType<typeof createServer>>
  afterEach(async () => {
    await app.close()
  })

  it('returns 429 after the limit is exceeded', async () => {
    app = await createServer(cfg({ rateLimitMax: 2 }), new MemoryStorageAdapter(1000))
    await app.ready()
    const hit = () => app.inject({ method: 'GET', url: '/nonexistent-path' })
    expect((await hit()).statusCode).not.toBe(429)
    expect((await hit()).statusCode).not.toBe(429)
    expect((await hit()).statusCode).toBe(429) // 3rd exceeds max of 2
  })

  it('does not rate limit the health check', async () => {
    app = await createServer(cfg({ rateLimitMax: 1 }), new MemoryStorageAdapter(1000))
    await app.ready()
    await app.inject({ method: 'GET', url: '/healthz' })
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
  })
})
