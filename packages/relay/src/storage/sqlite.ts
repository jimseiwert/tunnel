import Database from 'better-sqlite3'
import type { AdminSlugRecord, RequestRecord, StorageAdapter } from './interface.js'
import { timingSafeEqualStr } from '../util/timing-safe.js'

interface SqliteOptions {
  path: string
  ringBufferSize: number
}

/**
 * SQLite-backed storage adapter using better-sqlite3 (synchronous API).
 * WAL mode is enabled for file databases to improve concurrent read performance.
 * All StorageAdapter methods are async wrappers around synchronous SQLite calls.
 */
export class SqliteStorageAdapter implements StorageAdapter {
  private readonly db: Database.Database
  private readonly ringBufferSize: number

  constructor({ path, ringBufferSize }: SqliteOptions) {
    this.db = new Database(path)
    this.ringBufferSize = ringBufferSize

    // WAL mode only applies to file-based databases
    if (path !== ':memory:') {
      this.db.pragma('journal_mode = WAL')
    }
    this.db.pragma('synchronous = OFF')

    this.createSchema()
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        headers_json TEXT,
        body TEXT,
        body_encoding TEXT DEFAULT 'utf8',
        body_truncated INTEGER DEFAULT 0,
        status INTEGER,
        response_headers_json TEXT,
        response_body TEXT,
        response_body_encoding TEXT DEFAULT 'utf8',
        response_body_truncated INTEGER DEFAULT 0,
        duration_ms INTEGER,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_slug_ts ON requests(slug, ts);
      CREATE TABLE IF NOT EXISTS slugs (
        slug TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `)
  }

  async insertRequest(req: RequestRecord): Promise<void> {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO requests
        (id, slug, method, path, headers_json, body, body_encoding, body_truncated,
         status, response_headers_json, response_body, response_body_encoding,
         response_body_truncated, duration_ms, ts)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const evict = this.db.prepare(`
      DELETE FROM requests
      WHERE slug = ? AND id IN (
        SELECT id FROM requests WHERE slug = ? ORDER BY ts ASC LIMIT ?
      )
    `)

    const countStmt = this.db.prepare<[string], { count: number }>(
      'SELECT COUNT(*) as count FROM requests WHERE slug = ?'
    )

    const transaction = this.db.transaction(() => {
      insert.run(
        req.id,
        req.slug,
        req.method,
        req.path,
        req.headersJson,
        req.body,
        req.bodyEncoding,
        req.bodyTruncated ? 1 : 0,
        req.status,
        req.responseHeadersJson,
        req.responseBody,
        req.responseBodyEncoding,
        req.responseBodyTruncated ? 1 : 0,
        req.durationMs,
        req.ts,
      )

      const { count } = countStmt.get(req.slug)!
      if (count > this.ringBufferSize) {
        const excess = count - this.ringBufferSize
        evict.run(req.slug, req.slug, excess)
      }
    })

    transaction()
  }

  async fetchRequests(slug: string, ids?: string[], limit = 50): Promise<RequestRecord[]> {
    if (ids && ids.length > 0) {
      const placeholders = ids.map(() => '?').join(', ')
      const stmt = this.db.prepare<string[], DbRow>(
        `SELECT * FROM requests WHERE id IN (${placeholders})`
      )
      const rows = stmt.all(...ids) as DbRow[]
      return rows.map(rowToRecord)
    }

    const stmt = this.db.prepare<[string, number], DbRow>(
      'SELECT * FROM requests WHERE slug = ? ORDER BY ts DESC LIMIT ?'
    )
    const rows = stmt.all(slug, limit) as DbRow[]
    return rows.map(rowToRecord)
  }

  async registerSlug(slug: string, token: string, expiresAt: number): Promise<void> {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO slugs (slug, token, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `)
    stmt.run(slug, token, nowSeconds, expiresAt)
  }

  async validateSlug(slug: string, token: string): Promise<'valid' | 'expired' | 'invalid' | 'not_found'> {
    const stmt = this.db.prepare<[string], { token: string; expires_at: number }>(
      'SELECT token, expires_at FROM slugs WHERE slug = ?'
    )
    const row = stmt.get(slug)
    if (!row) return 'not_found'
    if (!timingSafeEqualStr(row.token, token)) return 'invalid'
    const nowSeconds = Math.floor(Date.now() / 1000)
    if (row.expires_at < nowSeconds) return 'expired'
    return 'valid'
  }

  async renewSlug(slug: string, oldToken: string, newToken: string, expiresAt: number): Promise<boolean> {
    const stmt = this.db.prepare(`
      UPDATE slugs SET token = ?, expires_at = ? WHERE slug = ? AND token = ?
    `)
    const result = stmt.run(newToken, expiresAt, slug, oldToken)
    return result.changes > 0
  }

  async listAdminSlugs(_userId: string): Promise<AdminSlugRecord[]> {
    throw new Error('Admin methods not supported on SqliteStorageAdapter')
  }

  async createAdminSlug(_userId: string, _slug: string, _token: string, _webhookUrl: string, _expiresAt: number): Promise<AdminSlugRecord> {
    throw new Error('Admin methods not supported on SqliteStorageAdapter')
  }

  async deleteAdminSlug(_slug: string, _userId: string): Promise<boolean> {
    throw new Error('Admin methods not supported on SqliteStorageAdapter')
  }

  async close(): Promise<void> {
    this.db.close()
  }
}

interface DbRow {
  id: string
  slug: string
  method: string
  path: string
  headers_json: string | null
  body: string | null
  body_encoding: string
  body_truncated: number
  status: number | null
  response_headers_json: string | null
  response_body: string | null
  response_body_encoding: string
  response_body_truncated: number
  duration_ms: number | null
  ts: number
}

function rowToRecord(row: DbRow): RequestRecord {
  return {
    id: row.id,
    slug: row.slug,
    method: row.method,
    path: row.path,
    headersJson: row.headers_json ?? '{}',
    body: row.body,
    bodyEncoding: (row.body_encoding as 'utf8' | 'base64') ?? 'utf8',
    bodyTruncated: row.body_truncated === 1,
    status: row.status,
    responseHeadersJson: row.response_headers_json,
    responseBody: row.response_body,
    responseBodyEncoding: (row.response_body_encoding as 'utf8' | 'base64') ?? 'utf8',
    responseBodyTruncated: row.response_body_truncated === 1,
    durationMs: row.duration_ms,
    ts: row.ts,
  }
}
