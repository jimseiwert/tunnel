import type { AdminSlugRecord, RequestRecord, StorageAdapter } from './interface.js'
import { timingSafeEqualStr } from '../util/timing-safe.js'

interface SlugEntry {
  token: string
  expiresAt: number // Unix seconds
}

/**
 * In-memory storage adapter backed by Maps.
 * Request records are kept in a ring buffer per slug; oldest entries are evicted
 * when the buffer exceeds ringBufferSize.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly requests = new Map<string, RequestRecord[]>()
  private readonly slugs = new Map<string, SlugEntry>()

  constructor(private readonly ringBufferSize: number) {}

  async insertRequest(req: RequestRecord): Promise<void> {
    let records = this.requests.get(req.slug)
    if (!records) {
      records = []
      this.requests.set(req.slug, records)
    }

    // Upsert: replace existing record with the same id in-place (no eviction needed)
    const existingIdx = records.findIndex((r) => r.id === req.id)
    if (existingIdx !== -1) {
      records[existingIdx] = req
      return
    }

    records.push(req)
    // Evict oldest entries when over capacity
    while (records.length > this.ringBufferSize) {
      records.shift()
    }
  }

  async fetchRequests(slug: string, ids?: string[], limit = 50): Promise<RequestRecord[]> {
    const records = this.requests.get(slug) ?? []
    if (ids && ids.length > 0) {
      const idSet = new Set(ids)
      return records.filter((r) => idSet.has(r.id))
    }
    // Return the most recent `limit` records
    return records.slice(-limit)
  }

  async registerSlug(slug: string, token: string, expiresAt: number): Promise<void> {
    this.slugs.set(slug, { token, expiresAt })
  }

  async validateSlug(slug: string, token: string): Promise<'valid' | 'expired' | 'invalid' | 'not_found'> {
    const entry = this.slugs.get(slug)
    if (!entry) return 'not_found'
    if (!timingSafeEqualStr(entry.token, token)) return 'invalid'
    const nowSeconds = Math.floor(Date.now() / 1000)
    if (entry.expiresAt < nowSeconds) return 'expired'
    return 'valid'
  }

  async renewSlug(slug: string, oldToken: string, newToken: string, expiresAt: number): Promise<boolean> {
    const entry = this.slugs.get(slug)
    if (!entry || !timingSafeEqualStr(entry.token, oldToken)) return false
    this.slugs.set(slug, { token: newToken, expiresAt })
    return true
  }

  async listAdminSlugs(_userId: string): Promise<AdminSlugRecord[]> {
    throw new Error('Admin methods not supported on MemoryStorageAdapter')
  }

  async createAdminSlug(_userId: string, _slug: string, _token: string, _webhookUrl: string, _expiresAt: number): Promise<AdminSlugRecord> {
    throw new Error('Admin methods not supported on MemoryStorageAdapter')
  }

  async deleteAdminSlug(_slug: string, _userId: string): Promise<boolean> {
    throw new Error('Admin methods not supported on MemoryStorageAdapter')
  }

  async close(): Promise<void> {
    this.requests.clear()
    this.slugs.clear()
  }
}
