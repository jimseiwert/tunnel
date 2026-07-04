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
