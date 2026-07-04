import { randomBytes } from 'crypto'
import pg from 'pg'
import type { AdminSlugRecord, RequestRecord, StorageAdapter } from './interface.js'
import { timingSafeEqualStr } from '../util/timing-safe.js'

const { Pool } = pg

interface PostgresOptions {
  connectionString: string
  ringBufferSize: number
}

/**
 * PostgreSQL-backed storage adapter using the pg connection pool.
 * Schema is created on first use. Ring buffer eviction runs after each insert.
 */
export class PostgresStorageAdapter implements StorageAdapter {
  private readonly pool: pg.Pool
  private readonly ringBufferSize: number
  private initialized = false

  constructor({ connectionString, ringBufferSize }: PostgresOptions) {
    this.pool = new Pool({ connectionString })
    this.ringBufferSize = ringBufferSize
  }

  private async ensureSchema(): Promise<void> {
    if (this.initialized) return
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        headers_json TEXT,
        body TEXT,
        body_encoding TEXT DEFAULT 'utf8',
        body_truncated BOOLEAN DEFAULT FALSE,
        status INTEGER,
        response_headers_json TEXT,
        response_body TEXT,
        response_body_encoding TEXT DEFAULT 'utf8',
        response_body_truncated BOOLEAN DEFAULT FALSE,
        duration_ms INTEGER,
        ts BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_slug_ts ON requests(slug, ts);
      CREATE TABLE IF NOT EXISTS slugs (
        slug TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        user_id TEXT,
        webhook_url TEXT
      );
      ALTER TABLE slugs ADD COLUMN IF NOT EXISTS user_id TEXT;
      ALTER TABLE slugs ADD COLUMN IF NOT EXISTS webhook_url TEXT;
      CREATE INDEX IF NOT EXISTS idx_slugs_user_id ON slugs(user_id);
    `)
    this.initialized = true
  }

  async insertRequest(req: RequestRecord): Promise<void> {
    await this.ensureSchema()

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `INSERT INTO requests
          (id, slug, method, path, headers_json, body, body_encoding, body_truncated,
           status, response_headers_json, response_body, response_body_encoding,
           response_body_truncated, duration_ms, ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           response_headers_json = EXCLUDED.response_headers_json,
           response_body = EXCLUDED.response_body,
           response_body_encoding = EXCLUDED.response_body_encoding,
           response_body_truncated = EXCLUDED.response_body_truncated,
           duration_ms = EXCLUDED.duration_ms`,
        [
          req.id,
          req.slug,
          req.method,
          req.path,
          req.headersJson,
          req.body,
          req.bodyEncoding,
          req.bodyTruncated,
          req.status,
          req.responseHeadersJson,
          req.responseBody,
          req.responseBodyEncoding,
          req.responseBodyTruncated,
          req.durationMs,
          req.ts,
        ],
      )

      // Count-then-evict to enforce ring buffer
      const countResult = await client.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM requests WHERE slug = $1',
        [req.slug],
      )
      const count = parseInt(countResult.rows[0]?.count ?? '0', 10)
      if (count > this.ringBufferSize) {
        const excess = count - this.ringBufferSize
        await client.query(
          `DELETE FROM requests WHERE slug = $1 AND id IN (
             SELECT id FROM requests WHERE slug = $1 ORDER BY ts ASC LIMIT $2
           )`,
          [req.slug, excess],
        )
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async fetchRequests(slug: string, ids?: string[], limit = 50): Promise<RequestRecord[]> {
    await this.ensureSchema()

    if (ids && ids.length > 0) {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
      const result = await this.pool.query<DbRow>(
        `SELECT * FROM requests WHERE id IN (${placeholders})`,
        ids,
      )
      return result.rows.map(rowToRecord)
    }

    const result = await this.pool.query<DbRow>(
      'SELECT * FROM requests WHERE slug = $1 ORDER BY ts DESC LIMIT $2',
      [slug, limit],
    )
    return result.rows.map(rowToRecord)
  }

  async registerSlug(slug: string, token: string, expiresAt: number): Promise<void> {
    await this.ensureSchema()
    const nowSeconds = Math.floor(Date.now() / 1000)
    await this.pool.query(
      `INSERT INTO slugs (slug, token, created_at, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at`,
      [slug, token, nowSeconds, expiresAt],
    )
  }

  async validateSlug(slug: string, token: string): Promise<'valid' | 'expired' | 'invalid' | 'not_found'> {
    await this.ensureSchema()
    const result = await this.pool.query<{ token: string; expires_at: string }>(
      'SELECT token, expires_at FROM slugs WHERE slug = $1',
      [slug],
    )
    if (result.rows.length === 0) return 'not_found'
    const row = result.rows[0]!
    if (!timingSafeEqualStr(row.token, token)) return 'invalid'
    const nowSeconds = Math.floor(Date.now() / 1000)
    if (parseInt(row.expires_at, 10) < nowSeconds) return 'expired'
    return 'valid'
  }

  async renewSlug(slug: string, oldToken: string, newToken: string, expiresAt: number): Promise<boolean> {
    await this.ensureSchema()
    const result = await this.pool.query(
      'UPDATE slugs SET token = $1, expires_at = $2 WHERE slug = $3 AND token = $4',
      [newToken, expiresAt, slug, oldToken],
    )
    return (result.rowCount ?? 0) > 0
  }

  async listAdminSlugs(userId: string): Promise<AdminSlugRecord[]> {
    await this.ensureSchema()
    const result = await this.pool.query<{
      slug: string; token: string; user_id: string; webhook_url: string | null; created_at: string; expires_at: string
    }>(
      'SELECT slug, token, user_id, webhook_url, created_at, expires_at FROM slugs WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    )
    return result.rows.map(row => ({
      slug: row.slug,
      token: row.token,
      userId: row.user_id,
      webhookUrl: row.webhook_url ?? '',
      createdAt: parseInt(row.created_at, 10),
      expiresAt: parseInt(row.expires_at, 10),
    }))
  }

  async createAdminSlug(userId: string, slug: string, token: string, webhookUrl: string, expiresAt: number): Promise<AdminSlugRecord> {
    await this.ensureSchema()
    const nowSeconds = Math.floor(Date.now() / 1000)
    await this.pool.query(
      `INSERT INTO slugs (slug, token, created_at, expires_at, user_id, webhook_url)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [slug, token, nowSeconds, expiresAt, userId, webhookUrl],
    )
    return { slug, token, userId, webhookUrl, createdAt: nowSeconds, expiresAt }
  }

  async deleteAdminSlug(slug: string, userId: string): Promise<boolean> {
    await this.ensureSchema()
    const result = await this.pool.query(
      'DELETE FROM slugs WHERE slug = $1 AND user_id = $2',
      [slug, userId],
    )
    return (result.rowCount ?? 0) > 0
  }

  async close(): Promise<void> {
    await this.pool.end()
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
  body_truncated: boolean
  status: number | null
  response_headers_json: string | null
  response_body: string | null
  response_body_encoding: string
  response_body_truncated: boolean
  duration_ms: number | null
  ts: string // Postgres returns BIGINT as string
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
    bodyTruncated: row.body_truncated === true,
    status: row.status,
    responseHeadersJson: row.response_headers_json,
    responseBody: row.response_body,
    responseBodyEncoding: (row.response_body_encoding as 'utf8' | 'base64') ?? 'utf8',
    responseBodyTruncated: row.response_body_truncated === true,
    durationMs: row.duration_ms,
    ts: typeof row.ts === 'string' ? parseInt(row.ts, 10) : row.ts,
  }
}
