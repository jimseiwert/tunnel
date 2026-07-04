import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import type { RelayConfig } from './config.js'
import type { StorageAdapter } from './storage/interface.js'
import { ConnectionRegistry } from './ws/registry.js'
import { PendingRequests } from './ws/pending.js'
import { ownerWsPlugin } from './ws/owner.js'
import { watcherWsPlugin } from './ws/watcher.js'
import { conduitRoutes } from './routes/conduit.js'
import { renewRoutes } from './routes/renew.js'
import { authRoutes } from './routes/auth.js'
import { adminRoutes } from './routes/admin.js'
import { FixedWindowRateLimiter } from './util/rate-limit.js'

export { ConnectionRegistry } from './ws/registry.js'
export { PendingRequests } from './ws/pending.js'

export async function createServer(
  config: RelayConfig,
  storage: StorageAdapter,
): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: true, forceCloseConnections: true })

  await app.register(fastifyWebsocket)

  const registry = new ConnectionRegistry()
  const pending = new PendingRequests(config.maxBodyBytes)

  // Per-IP rate limiting for HTTP routes. Disabled when rateLimitMax <= 0.
  if (config.rateLimitMax > 0) {
    const limiter = new FixedWindowRateLimiter(config.rateLimitMax, config.rateLimitWindowMs)
    const sweepTimer = setInterval(() => limiter.sweep(), config.rateLimitWindowMs)
    // Do not keep the process alive solely for the sweep timer.
    if (typeof sweepTimer.unref === 'function') sweepTimer.unref()
    app.addHook('onRequest', async (req, reply) => {
      // Skip WebSocket upgrades and the health check.
      if (req.headers.upgrade || req.url === '/healthz') return
      if (!limiter.check(req.ip)) {
        // Hijack + write via the raw response: some request paths (e.g. bare
        // slugs that also match the WS `/:slug` route's schema) continue into
        // route param validation after onRequest resolves, which throws
        // ERR_HTTP_HEADERS_SENT under Bun's http shim if the reply was sent
        // normally. Hijacking tells Fastify to stop managing the response.
        reply.hijack()
        reply.raw.statusCode = 429
        reply.raw.setHeader('content-type', 'application/json; charset=utf-8')
        reply.raw.end(JSON.stringify({ error: 'Too Many Requests' }))
        return
      }
    })
  }

  // Redirect /<slug> (no trailing slash, not a WS upgrade) → /<slug>/
  // Needed because the WS parametric route /:slug wins over the HTTP /:slug/*
  // for bare-slug requests without a trailing slash.
  app.addHook('onRequest', async (_req, reply) => {
    const match = _req.url.match(/^\/(ws-[a-f0-9]+)$/)
    if (match && !_req.headers.upgrade) {
      await reply.redirect(`/${match[1]}/`, 301)
    }
  })

  // Health check
  app.get('/healthz', async (_req, reply) => {
    return reply.code(200).send({ status: 'ok', ts: Date.now() })
  })

  // Legacy alias
  app.get('/health', async (_req, reply) => {
    return reply.code(200).send({ status: 'ok', ts: Date.now() })
  })

  // Install script redirect (handles get.conduitrelay.com traffic)
  app.get('/install', async (_req, reply) => {
    return reply.redirect('https://raw.githubusercontent.com/jimseiwert/conduit/main/installer/install.sh', 302)
  })

  app.get('/', async (req, reply) => {
    if (req.hostname === 'get.conduitrelay.com') {
      return reply.redirect('https://raw.githubusercontent.com/jimseiwert/conduit/main/installer/install.sh', 302)
    }
    return reply.code(404).send({ error: 'Not found' })
  })

  // WebSocket routes (must be registered after fastifyWebsocket)
  await app.register(ownerWsPlugin, { config, storage, registry, pending })
  await app.register(watcherWsPlugin, { config, storage, registry })

  // HTTP routes
  await app.register(conduitRoutes, { config, storage, registry, pending })
  await app.register(renewRoutes, { config, storage })
  await app.register(authRoutes, { config })
  await app.register(adminRoutes, { config, storage })

  return app
}
