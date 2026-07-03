import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createServer } from '../server.js'
import type { StorageAdapter, AdminSlugRecord, RequestRecord } from '../storage/interface.js'
import type { RelayConfig } from '../config.js'

// Minimal test storage adapter that supports admin methods
class TestStorageAdapter implements StorageAdapter {
  async insertRequest(): Promise<void> {}
  async fetchRequests(): Promise<RequestRecord[]> {
    return []
  }
  async registerSlug(): Promise<void> {}
  async validateSlug(): Promise<'valid' | 'expired' | 'invalid' | 'not_found'> {
    return 'not_found'
  }
  async renewSlug(): Promise<boolean> {
    return false
  }
  async listAdminSlugs(): Promise<AdminSlugRecord[]> {
    return []
  }
  async createAdminSlug(): Promise<AdminSlugRecord> {
    return {
      slug: 'test-slug',
      token: 'test-token',
      userId: 'test-user',
      webhookUrl: 'http://localhost:3000/test-slug',
      createdAt: Date.now(),
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    }
  }
  async deleteAdminSlug(): Promise<boolean> {
    return true
  }
  async close(): Promise<void> {}
}

function baseConfig(overrides: Partial<RelayConfig> = {}): RelayConfig {
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
    adminSecret: 'right-secret',
    ...overrides,
  }
}

describe('admin auth', () => {
  let app: Awaited<ReturnType<typeof createServer>>
  beforeEach(async () => {
    app = await createServer(baseConfig(), new TestStorageAdapter())
    await app.ready()
  })
  afterEach(async () => {
    await app.close()
  })

  it('rejects a wrong admin secret with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/slugs?userId=u1',
      headers: { 'x-admin-secret': 'wrong-secret' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('accepts the correct admin secret', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/slugs?userId=u1',
      headers: { 'x-admin-secret': 'right-secret' },
    })
    expect(res.statusCode).toBe(200)
  })
})
