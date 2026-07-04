import type { IncomingRequest, ForwardResponse } from '@conduit/types'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024 // 10 MB

/**
 * Forwards an IncomingRequest to localhost on the specified port.
 * Streams the response body as binary frames via onChunk/onEnd callbacks.
 * Returns ForwardResponse containing status/headers/durationMs.
 *
 * Error handling:
 * - ECONNREFUSED → 502 Bad Gateway
 * - Timeout → 504 Gateway Timeout
 */
export async function forwardRequest(
  req: IncomingRequest,
  port: number,
  maxBodyBytes: number = DEFAULT_MAX_BODY_BYTES,
  onChunk: (requestId: string, chunk: Buffer) => void,
  onEnd: (requestId: string) => void,
): Promise<ForwardResponse> {
  const start = Date.now()
  const requestId = req.id

  // Build request body from IncomingRequest
  let body: string | Buffer | null = null
  if (req.body !== null && req.body !== undefined) {
    if (req.bodyEncoding === 'base64') {
      body = Buffer.from(req.body, 'base64')
    } else {
      body = req.body
    }
  }

  // Strip hop-by-hop headers that shouldn't be forwarded
  const skipHeaders = new Set([
    'host',
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
  ])

  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (!skipHeaders.has(key.toLowerCase())) {
      headers[key] = value
    }
  }

  const url = `http://localhost:${port}${req.path}`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch(url, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(req.method.toUpperCase()) ? undefined : body,
        signal: controller.signal,
        // @ts-ignore — Node 18+ undici supports duplex streaming
        duplex: 'half',
      })
    } catch (err: unknown) {
      clearTimeout(timeoutId)
      const durationMs = Date.now() - start
      const error = err as NodeJS.ErrnoException

      if (error.name === 'AbortError') {
        return buildErrorResponse(requestId, 504, {}, durationMs, 'Conduit: your local server did not respond in time (timeout).')
      }

      // ECONNREFUSED or similar
      if (
        error.cause &&
        typeof error.cause === 'object' &&
        'code' in error.cause &&
        (error.cause as NodeJS.ErrnoException).code === 'ECONNREFUSED'
      ) {
        return buildErrorResponse(requestId, 502, {}, 0, `Conduit: cannot reach your local server at ${url}. Is it running?`)
      }

      // Generic connection error → 502
      return buildErrorResponse(requestId, 502, {}, durationMs, `Conduit: failed to reach your local server at ${url}.`)
    }

    clearTimeout(timeoutId)

    // Collect response headers
    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    // Stream the response body
    if (response.body) {
      const reader = response.body.getReader()
      let bytesRead = 0
      let truncated = false

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          if (value) {
            if (bytesRead + value.length > maxBodyBytes) {
              // Truncate — send what fits
              const remaining = maxBodyBytes - bytesRead
              if (remaining > 0) {
                const chunk = Buffer.from(value.slice(0, remaining))
                onChunk(requestId, chunk)
                bytesRead += remaining
              }
              truncated = true
              break
            }

            const chunk = Buffer.from(value)
            onChunk(requestId, chunk)
            bytesRead += chunk.length
          }
        }
      } finally {
        reader.releaseLock()
      }

      onEnd(requestId)

      const durationMs = Date.now() - start
      return {
        type: 'response',
        requestId,
        status: response.status,
        headers: responseHeaders,
        body: null, // body delivered via streaming frames
        bodyEncoding: 'utf8',
        bodyTruncated: truncated,
        durationMs,
      }
    } else {
      // No body — send end frame immediately
      onEnd(requestId)

      const durationMs = Date.now() - start
      return {
        type: 'response',
        requestId,
        status: response.status,
        headers: responseHeaders,
        body: null,
        bodyEncoding: 'utf8',
        bodyTruncated: false,
        durationMs,
      }
    }
  } catch (err: unknown) {
    const durationMs = Date.now() - start
    return buildErrorResponse(requestId, 502, {}, durationMs)
  }
}

function buildErrorResponse(
  requestId: string,
  status: number,
  headers: Record<string, string>,
  durationMs: number,
  message?: string,
): ForwardResponse {
  const hasBody = typeof message === 'string' && message.length > 0
  return {
    type: 'response',
    requestId,
    status,
    headers: hasBody ? { ...headers, 'content-type': 'text/plain; charset=utf-8' } : headers,
    body: hasBody ? Buffer.from(message, 'utf8').toString('base64') : null,
    bodyEncoding: hasBody ? 'base64' : 'utf8',
    bodyTruncated: false,
    durationMs,
  }
}
