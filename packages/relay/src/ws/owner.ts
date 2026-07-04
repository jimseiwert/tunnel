import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import {
  RegisterTunnelSchema,
  DeregisterTunnelSchema,
  ReplayRequestSchema,
  FetchRequestsSchema,
  ForwardResponseSchema,
  decodeStreamFrame,
  STREAM_FRAME_TYPE,
} from '@conduit/types'
import type {
  TunnelRegistered,
  TunnelError,
  RequestRecords,
  ReplayError,
  IncomingRequest,
  WatcherCount,
} from '@conduit/types'
import type { RelayConfig } from '../config.js'
import type { StorageAdapter } from '../storage/interface.js'
import { ConnectionRegistry } from './registry.js'
import { PendingRequests } from './pending.js'
import { issueSlugToken, tokenExpiresAt } from '../jwt.js'
import { parseHeadersJson } from '../util/safe-json.js'
import jwt from 'jsonwebtoken'

interface OwnerWsOptions {
  config: RelayConfig
  storage: StorageAdapter
  registry: ConnectionRegistry
  pending: PendingRequests
}

function send<T>(ws: WebSocket, msg: T): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function sendError(ws: WebSocket, code: TunnelError['code'], message: string): void {
  const err: TunnelError = { type: 'error', code, message }
  send(ws, err)
}

export async function ownerWsPlugin(
  app: FastifyInstance,
  opts: OwnerWsOptions,
): Promise<void> {
  const { config, storage, registry, pending } = opts

  app.get<{ Params: { slug: string } }>(
    '/:slug',
    {
      websocket: true,
      schema: {
        params: {
          type: 'object',
          properties: { slug: { type: 'string', pattern: '^ws-[a-f0-9]+$' } },
          required: ['slug'],
        },
      },
    },
    (socket: WebSocket, req: FastifyRequest<{ Params: { slug: string } }>) => {
      const { slug } = req.params

      // Track whether this connection is fully registered
      let registered = false
      let ownerSlug: string | null = null

      // Helper: broadcast updated watcher count to all clients for this slug
      function broadcastWatcherCount(targetSlug: string): void {
        const count = registry.getWatchers(targetSlug).size
        const msg: WatcherCount = { type: 'watcherCount', count }
        registry.broadcastToAll(targetSlug, JSON.stringify(msg))
      }

      socket.on('message', async (rawData: unknown, isBinary: boolean) => {
        try {
        // ── Binary frame: route to pending requests map ───────────────────
        if (isBinary) {
          const buf = Buffer.isBuffer(rawData)
            ? rawData
            : Array.isArray(rawData)
            ? Buffer.concat(rawData as Buffer[])
            : Buffer.from(rawData as ArrayBuffer)
          try {
            const frame = decodeStreamFrame(buf)
            if (frame.frameType === STREAM_FRAME_TYPE.DATA && frame.chunk) {
              pending.addChunk(frame.requestId, frame.chunk)
            } else if (frame.frameType === STREAM_FRAME_TYPE.END) {
              pending.endStream(frame.requestId)
            } else if (frame.frameType === STREAM_FRAME_TYPE.ERROR) {
              const errMsg = frame.chunk ? frame.chunk.toString('utf8') : 'Stream error'
              pending.reject(frame.requestId, new Error(errMsg))
            }
          } catch {
            // Malformed binary frame — ignore silently (not a parse error for JSON messages)
          }
          return
        }

        // ── JSON message handling ─────────────────────────────────────────
        const text = Buffer.isBuffer(rawData)
          ? rawData.toString('utf8')
          : String(rawData)

        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          sendError(socket, 'PARSE_ERROR', 'Invalid JSON')
          return
        }

        // ── First message must be RegisterTunnel ─────────────────────────
        if (!registered) {
          const result = RegisterTunnelSchema.safeParse(parsed)
          if (!result.success) {
            sendError(socket, 'PARSE_ERROR', `Invalid register message: ${result.error.message}`)
            return
          }
          const msg = result.data

          // Gate: auth checks (skipped entirely when authRequired=false)
          if (config.authRequired) {
            if (msg.userToken) {
              // Account-based auth: verify JWT minted by dashboard
              try {
                const payload = jwt.verify(msg.userToken, config.jwtSecret) as Record<string, unknown>
                if (payload['type'] !== 'cli' || typeof payload['userId'] !== 'string') {
                  sendError(socket, 'AUTH_REQUIRED', 'Invalid CLI token — run conduit login')
                  socket.close()
                  return
                }
              } catch {
                sendError(socket, 'AUTH_REQUIRED', 'Expired or invalid CLI token — run conduit login')
                socket.close()
                return
              }
            } else if (config.registrationToken) {
              // Registration token gate (self-hosted with shared secret)
              if (msg.registrationToken !== config.registrationToken) {
                sendError(socket, 'AUTH_REQUIRED', 'Missing or invalid relay registration token')
                socket.close()
                return
              }
            } else {
              // No userToken and no registrationToken — auth is required, reject
              sendError(socket, 'AUTH_REQUIRED', 'Authentication required — run conduit login')
              socket.close()
              return
            }
          }

          // Gate: slug must not have an active owner (grace period OK — same client may reconnect)
          if (registry.hasOwner(slug)) {
            sendError(socket, 'SLUG_IN_USE', `Slug "${slug}" already has an active connection`)
            socket.close()
            return
          }

          let finalToken: string

          if (!config.authRequired) {
            // Auth disabled: open relay — register/reclaim any slug without token validation.
            finalToken = issueSlugToken(slug, config.jwtSecret)
            await storage.registerSlug(slug, finalToken, tokenExpiresAt())
          } else if (msg.token) {
            // Reconnect path: validate existing token
            const validity = await storage.validateSlug(slug, msg.token)
            if (validity === 'valid') {
              finalToken = msg.token
            } else if (validity === 'expired') {
              sendError(
                socket,
                'INVALID_TOKEN',
                'Token expired — run conduit token refresh',
              )
              socket.close()
              return
            } else if (validity === 'invalid') {
              sendError(socket, 'INVALID_TOKEN', 'Token is invalid for this slug')
              socket.close()
              return
            } else {
              // 'not_found' — DB was wiped or slug never registered on this instance.
              // Allow re-registration so clients survive relay restarts without
              // manual token clearing. The 48-bit slug entropy is sufficient protection.
              finalToken = issueSlugToken(slug, config.jwtSecret)
              await storage.registerSlug(slug, finalToken, tokenExpiresAt())
            }
          } else {
            // First registration: issue a new token
            const validity = await storage.validateSlug(slug, '')
            if (validity === 'not_found') {
              finalToken = issueSlugToken(slug, config.jwtSecret)
              await storage.registerSlug(slug, finalToken, tokenExpiresAt())
            } else {
              // Slug exists but no token provided.
              // If the relay requires a registrationToken and the client passed it,
              // they're the relay admin — allow reclaiming the slug with a fresh token.
              if (config.registrationToken) {
                finalToken = issueSlugToken(slug, config.jwtSecret)
                await storage.registerSlug(slug, finalToken, tokenExpiresAt())
              } else {
                sendError(socket, 'SLUG_IN_USE', `Slug "${slug}" is already registered`)
                socket.close()
                return
              }
            }
          }

          // Register in connection registry
          registry.setOwner(slug, socket)
          registered = true
          ownerSlug = slug

          const conduitUrl = `${config.relayProto}://${config.relayDomain}/${slug}/`
          const registeredMsg: TunnelRegistered = {
            type: 'registered',
            slug,
            token: finalToken,
            url: conduitUrl,
          }
          send(socket, registeredMsg)
          broadcastWatcherCount(slug)
          return
        }

        // ── Subsequent messages ───────────────────────────────────────────
        if (!ownerSlug) return

        // Try to parse as any valid inbound message
        try {
          const msgObj = parsed as { type?: string }

          switch (msgObj.type) {
            case 'deregister': {
              const result = DeregisterTunnelSchema.safeParse(parsed)
              if (!result.success) {
                sendError(socket, 'PARSE_ERROR', 'Invalid deregister message')
                return
              }
              // Graceful disconnect — start grace period
              registry.clearOwner(ownerSlug)
              registered = false
              ownerSlug = null
              socket.close(1000, 'Deregistered')
              break
            }

            case 'response': {
              const result = ForwardResponseSchema.safeParse(parsed)
              if (!result.success) {
                sendError(socket, 'PARSE_ERROR', 'Invalid response message')
                return
              }
              pending.resolve(result.data.requestId, result.data)
              break
            }

            case 'fetchRequests': {
              const result = FetchRequestsSchema.safeParse(parsed)
              if (!result.success) {
                sendError(socket, 'PARSE_ERROR', 'Invalid fetchRequests message')
                return
              }
              try {
                const records = await storage.fetchRequests(
                  ownerSlug,
                  result.data.ids.length > 0 ? result.data.ids : undefined,
                  result.data.limit,
                )
                const response: RequestRecords = {
                  type: 'requestRecords',
                  records: records.map((r) => ({
                    id: r.id,
                    slug: r.slug,
                    method: r.method,
                    path: r.path,
                    headers: parseHeadersJson(r.headersJson),
                    body: r.body,
                    bodyEncoding: r.bodyEncoding,
                    bodyTruncated: r.bodyTruncated,
                    status: r.status,
                    responseHeaders: r.responseHeadersJson
                      ? parseHeadersJson(r.responseHeadersJson)
                      : undefined,
                    responseBody: r.responseBody,
                    responseBodyEncoding: r.responseBodyEncoding,
                    responseBodyTruncated: r.responseBodyTruncated,
                    durationMs: r.durationMs,
                    ts: r.ts,
                  })),
                }
                send(socket, response)
              } catch {
                sendError(socket, 'PARSE_ERROR', 'Failed to fetch requests')
              }
              break
            }

            case 'replay': {
              const result = ReplayRequestSchema.safeParse(parsed)
              if (!result.success) {
                sendError(socket, 'PARSE_ERROR', 'Invalid replay message')
                return
              }
              try {
                const records = await storage.fetchRequests(ownerSlug, [result.data.requestId])
                if (records.length === 0) {
                  const replayErr: ReplayError = {
                    type: 'replayError',
                    requestId: result.data.requestId,
                    reason: 'REQUEST_NOT_FOUND',
                  }
                  send(socket, replayErr)
                  return
                }
                const record = records[0]!
                const replayMsg: IncomingRequest = {
                  type: 'request',
                  id: result.data.requestId,
                  method: record.method,
                  path: record.path,
                  headers: parseHeadersJson(record.headersJson),
                  body: record.body,
                  bodyEncoding: record.bodyEncoding,
                  bodyTruncated: record.bodyTruncated,
                  ts: Date.now(),
                }
                send(socket, replayMsg)
              } catch {
                sendError(socket, 'PARSE_ERROR', 'Failed to replay request')
              }
              break
            }

            default:
              sendError(socket, 'PARSE_ERROR', `Unknown message type: ${String(msgObj.type)}`)
          }
        } catch {
          sendError(socket, 'PARSE_ERROR', 'Failed to process message')
        }
        } catch (err) {
          app.log.error({ err }, 'Owner WebSocket message handler unexpected error')
          sendError(socket, 'PARSE_ERROR', 'Internal server error')
        }
      })

      socket.on('close', () => {
        if (ownerSlug) {
          registry.clearOwner(ownerSlug)
          pending.rejectAll(ownerSlug, new Error('Owner disconnected'))
          ownerSlug = null
        }
      })

      socket.on('error', (err: Error) => {
        app.log.error({ err }, 'Owner WebSocket error')
        if (ownerSlug) {
          registry.clearOwner(ownerSlug)
          pending.rejectAll(ownerSlug, err)
          ownerSlug = null
        }
      })
    },
  )
}
