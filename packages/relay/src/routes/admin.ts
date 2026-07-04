import { randomBytes } from 'crypto'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { RelayConfig } from '../config.js'
import type { StorageAdapter } from '../storage/interface.js'
import { timingSafeEqualStr } from '../util/timing-safe.js'

interface AdminRoutesOptions {
  config: RelayConfig
  storage: StorageAdapter
}

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60

function generateSlug(): string {
  return `ws-${randomBytes(4).toString('hex')}`
}

function generateToken(): string {
  return randomBytes(16).toString('hex')
}

function requireAdmin(config: RelayConfig, req: FastifyRequest, reply: FastifyReply): boolean {
  if (!config.adminSecret) {
    reply.code(503).send({ error: 'Admin API not configured' })
    return false
  }
  const provided = req.headers['x-admin-secret']
  if (typeof provided !== 'string' || !timingSafeEqualStr(provided, config.adminSecret)) {
    reply.code(401).send({ error: 'Unauthorized' })
    return false
  }
  return true
}

export async function adminRoutes(
  app: FastifyInstance,
  opts: AdminRoutesOptions,
): Promise<void> {
  const { config, storage } = opts

  app.get(
    '/admin/slugs',
    async (req: FastifyRequest<{ Querystring: { userId?: string } }>, reply: FastifyReply) => {
      if (!requireAdmin(config, req, reply)) return
      const { userId } = req.query
      if (!userId) return reply.code(400).send({ error: 'userId is required' })
      const slugs = await storage.listAdminSlugs(userId)
      return reply.send(slugs)
    },
  )

  app.post(
    '/admin/slugs',
    async (req: FastifyRequest<{ Body: { userId?: string } }>, reply: FastifyReply) => {
      if (!requireAdmin(config, req, reply)) return
      const { userId } = req.body ?? {}
      if (!userId) return reply.code(400).send({ error: 'userId is required' })

      const slug = generateSlug()
      const token = generateToken()
      const expiresAt = Math.floor(Date.now() / 1000) + ONE_YEAR_SECONDS
      const webhookUrl = `${config.relayProto}://${config.relayDomain}/${slug}`

      const record = await storage.createAdminSlug(userId, slug, token, webhookUrl, expiresAt)

      return reply.code(201).send(record)
    },
  )

  app.delete(
    '/admin/slugs/:slug',
    async (req: FastifyRequest<{ Params: { slug: string }; Body: { userId?: string } }>, reply: FastifyReply) => {
      if (!requireAdmin(config, req, reply)) return
      const { slug } = req.params
      const { userId } = req.body ?? {}
      if (!userId) return reply.code(400).send({ error: 'userId is required' })

      const deleted = await storage.deleteAdminSlug(slug, userId)
      if (!deleted) return reply.code(404).send({ error: 'Slug not found or not owned by user' })
      return reply.code(204).send()
    },
  )

  app.get(
    '/admin/slugs/:slug/requests',
    async (
      req: FastifyRequest<{ Params: { slug: string }; Querystring: { limit?: string } }>,
      reply: FastifyReply,
    ) => {
      if (!requireAdmin(config, req, reply)) return
      const { slug } = req.params
      const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200)
      const records = await storage.fetchRequests(slug, undefined, limit)
      const response = records.map(r => ({
        id: r.id,
        slug: r.slug,
        method: r.method,
        path: r.path,
        status: r.status,
        durationMs: r.durationMs,
        ts: r.ts,
      }))
      return reply.send(response)
    },
  )
}
