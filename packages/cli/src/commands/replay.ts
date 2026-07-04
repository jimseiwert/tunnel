import { ConduitClient } from '../ws/client.js'
import { loadProjectConfig, DEFAULT_RELAY_WS_URL } from '../config.js'
import type { RequestCompleted, RequestRecords } from '@conduit/types'

export async function cmdReplay(id: string, args: { relay?: string }) {
  const relayUrl = args.relay ?? process.env['CONDUIT_RELAY_URL'] ?? DEFAULT_RELAY_WS_URL
  const cwd = process.cwd()

  let slug = 'watcher'
  let token: string | null = null

  try {
    const entry = loadProjectConfig(cwd)
    if (entry) {
      slug = entry.slug
      token = entry.token
    }
  } catch {
    // Not strictly required for watcher mode
  }

  const result = await new Promise<'success' | 'error'>((resolve, reject) => {
    let completed = false

    const events = {
      onConnected(_slug: string, _tok: string, _url: string) {
        client.sendReplay(id)
      },
      onRequest() {},
      onRequestChunk() {},
      onRequestEnd() {},
      onCompleted(comp: RequestCompleted) {
        if (comp.requestId === id && !completed) {
          completed = true
          console.log(`Replayed: ${comp.method} ${comp.path}`)
          console.log(`  Status:   ${comp.status}`)
          console.log(`  Duration: ${comp.durationMs}ms`)
          client.disconnect()
          resolve('success')
        }
      },
      onWatcherCount() {},
      onRecords(_recs: RequestRecords) {},
      onError(code: string, message: string) {
        if (code === 'REPLAY_ERROR' && !completed) {
          completed = true
          console.error(`Replay failed: ${message}`)
          client.disconnect()
          resolve('error')
        } else {
          client.disconnect()
          reject(new Error(`Relay error [${code}]: ${message}`))
        }
      },
      onDisconnect() {},
    }

    const client = new ConduitClient(relayUrl, slug, token, {}, events)
    client.connect()

    setTimeout(() => {
      if (!completed) {
        completed = true
        client.disconnect()
        reject(new Error('Timed out waiting for replay result'))
      }
    }, 30_000)
  })

  if (result === 'error') {
    process.exit(1)
  }
}
