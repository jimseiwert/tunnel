import { WebSocket } from 'ws'
import jwt from 'jsonwebtoken'
import type {
  RelayOutbound,
  IncomingRequest,
  RequestCompleted,
  WatcherCount,
  RequestRecords,
  ForwardResponse,
} from '@conduit/types'
import { decodeStreamFrame, STREAM_FRAME_TYPE, encodeStreamFrame } from '@conduit/types'
import { loadProjectConfig, saveProjectConfig } from '../config.js'
import { forwardRequest } from './forwarder.js'

export function relayUnreachableMessage(relayUrl: string): string {
  return `Cannot reach the relay at ${relayUrl}. Check that it is running and that CONDUIT_RELAY_URL is correct.`
}

export interface ClientEvents {
  onConnected(slug: string, token: string, url: string): void
  onRequest(req: IncomingRequest): void
  onRequestChunk(requestId: string, chunk: Buffer): void
  onRequestEnd(requestId: string): void
  onCompleted(completed: RequestCompleted): void
  onWatcherCount(count: number): void
  onRecords(records: RequestRecords): void
  onError(code: string, message: string): void
  onDisconnect(): void
}

const MAX_RECONNECT_DELAY_MS = 30_000
const RENEWAL_THRESHOLD_DAYS = 7

export class ConduitClient {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private closed = false
  private everConnected = false
  private currentToken: string | null

  constructor(
    private relayUrl: string,
    private slug: string,
    private token: string | null,
    private config: {
      jwtSecret?: string
      registrationToken?: string
      userToken?: string
      httpEnabled?: boolean
      port?: number
      cwd?: string
    },
    private events: ClientEvents
  ) {
    this.currentToken = token
  }

  connect(): void {
    this.closed = false
    this._connect()
  }

  disconnect(): void {
    this.closed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  sendReplay(requestId: string): void {
    this._send({ type: 'replay', requestId })
  }

  sendFetch(ids: string[], limit?: number): void {
    const msg: Record<string, unknown> = { type: 'fetchRequests', ids }
    if (limit !== undefined) msg['limit'] = limit
    this._send(msg)
  }

  sendForwardResponse(resp: ForwardResponse): void {
    this._send(resp)
  }

  sendBinaryFrame(frame: Buffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(frame)
    }
  }

  private _send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private _connect(): void {
    if (this.closed) return

    const wsUrl = `${this.relayUrl.replace(/\/+$/, '')}/${this.slug}`
    const ws = new WebSocket(wsUrl)
    this.ws = ws

    ws.on('open', () => {
      // Reset reconnect delay on successful connection
      this.reconnectDelay = 1000

      // Send registration
      const registerMsg: Record<string, unknown> = {
        type: 'register',
        slug: this.slug,
        httpEnabled: this.config.httpEnabled ?? false,
      }
      if (this.currentToken) {
        registerMsg['token'] = this.currentToken
      }
      if (this.config.registrationToken) {
        registerMsg['registrationToken'] = this.config.registrationToken
      }
      if (this.config.userToken) {
        registerMsg['userToken'] = this.config.userToken
      }
      ws.send(JSON.stringify(registerMsg))
    })

    ws.on('message', (data: Buffer | string, isBinary: boolean) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as unknown as ArrayBuffer)
        try {
          const frame = decodeStreamFrame(buf)
          if (frame.frameType === STREAM_FRAME_TYPE.DATA && frame.chunk) {
            this.events.onRequestChunk(frame.requestId, frame.chunk)
          } else if (frame.frameType === STREAM_FRAME_TYPE.END) {
            this.events.onRequestEnd(frame.requestId)
          }
        } catch {
          // Malformed binary frame — ignore
        }
        return
      }

      let msg: RelayOutbound
      try {
        msg = JSON.parse(data.toString()) as RelayOutbound
      } catch {
        return
      }

      this._handleMessage(msg)
    })

    ws.on('close', () => {
      this.ws = null
      if (!this.closed) {
        this.events.onDisconnect()
        this._scheduleReconnect()
      }
    })

    ws.on('error', () => {
      // The 'close' handler drives reconnect. On the very first failed
      // connection (before we ever registered), surface an actionable reason
      // so the user isn't left with a silent "Disconnected".
      if (!this.everConnected) {
        this.events.onError('CONNECTION', relayUnreachableMessage(this.relayUrl))
      }
    })
  }

  private _handleMessage(msg: RelayOutbound): void {
    switch (msg.type) {
      case 'registered': {
        this.everConnected = true
        this.currentToken = msg.token
        // Persist updated token to home config
        if (this.config.cwd) {
          try {
            const existing = loadProjectConfig(this.config.cwd)
            if (existing) {
              saveProjectConfig(this.config.cwd, { ...existing, token: msg.token })
            }
          } catch {
            // Non-fatal
          }
        }
        this.events.onConnected(msg.slug, msg.token, msg.url)
        break
      }

      case 'error': {
        // On INVALID_TOKEN, clear the stale token so the next reconnect
        // attempt registers fresh (relay re-issues if registrationToken passes).
        if (msg.code === 'INVALID_TOKEN') {
          this.currentToken = null
        }
        this.events.onError(msg.code, msg.message)
        break
      }

      case 'request': {
        this.events.onRequest(msg)
        // Forward to localhost if we have a port
        if (this.config.port) {
          const port = this.config.port
          forwardRequest(
            msg,
            port,
            10 * 1024 * 1024,
            (requestId, chunk) => {
              // Send DATA frame
              const frame = encodeStreamFrame({
                requestId,
                frameType: STREAM_FRAME_TYPE.DATA,
                chunk,
              })
              this.sendBinaryFrame(frame)
            },
            (requestId) => {
              // Send END frame
              const frame = encodeStreamFrame({
                requestId,
                frameType: STREAM_FRAME_TYPE.END,
              })
              this.sendBinaryFrame(frame)
            },
          ).then((resp) => {
            this.sendForwardResponse(resp)
          }).catch(() => {
            this.sendForwardResponse({
              type: 'response',
              requestId: msg.id,
              status: 502,
              headers: {},
              body: null,
              bodyEncoding: 'utf8',
              bodyTruncated: false,
              durationMs: 0,
            })
          })
        }
        break
      }

      case 'completed': {
        this.events.onCompleted(msg)
        break
      }

      case 'watcherCount': {
        this.events.onWatcherCount(msg.count)
        break
      }

      case 'requestRecords': {
        this.events.onRecords(msg)
        break
      }

      case 'replayError': {
        this.events.onError('REPLAY_ERROR', `Replay failed for ${msg.requestId}: ${msg.reason}`)
        break
      }
    }
  }

  private async _scheduleReconnect(): Promise<void> {
    if (this.closed) return

    // Check token expiry before reconnecting
    if (this.currentToken) {
      try {
        const decoded = jwt.decode(this.currentToken) as Record<string, unknown> | null
        if (decoded && typeof decoded['exp'] === 'number') {
          const sevenDaysFromNow = Date.now() / 1000 + RENEWAL_THRESHOLD_DAYS * 86400
          if (decoded['exp'] < sevenDaysFromNow) {
            // Attempt token renewal
            await this._renewToken()
          }
        }
      } catch {
        // Non-fatal — continue with existing token
      }
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this._connect()
    }, this.reconnectDelay)

    // Exponential backoff capped at MAX_RECONNECT_DELAY_MS
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
  }

  private async _renewToken(): Promise<void> {
    if (!this.currentToken) return

    try {
      const renewUrl = `${this.relayUrl.replace(/^ws/, 'http')}/${this.slug}/renew`
      const response = await fetch(renewUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.currentToken}`,
        },
      })

      if (response.ok) {
        const data = await response.json() as Record<string, unknown>
        if (typeof data['token'] === 'string') {
          this.currentToken = data['token']
          if (this.config.cwd) {
            try {
              const existing = loadProjectConfig(this.config.cwd)
              if (existing) {
                saveProjectConfig(this.config.cwd, { ...existing, token: data['token'] as string })
              }
            } catch {
              // Non-fatal
            }
          }
        }
      }
    } catch {
      // Non-fatal — continue with existing token
    }
  }
}
