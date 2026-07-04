import { ConduitClient } from '../ws/client.js'
import { loadProjectConfig, DEFAULT_RELAY_WS_URL } from '../config.js'
import type { RequestRecords, RequestRecord } from '@conduit/types'

function formatAge(ts: number): string {
  const ageMs = Date.now() - ts
  const ageSec = Math.floor(ageMs / 1000)
  if (ageSec < 60) return `${ageSec}s ago`
  const ageMin = Math.floor(ageSec / 60)
  if (ageMin < 60) return `${ageMin}m ago`
  return `${Math.floor(ageMin / 60)}h ago`
}

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length)
}

function printTable(records: RequestRecord[]): void {
  const header = [
    pad('ID', 10),
    pad('METHOD', 8),
    pad('PATH', 40),
    pad('STATUS', 8),
    pad('DURATION', 10),
    'AGE',
  ].join('  ')

  const divider = '-'.repeat(header.length)

  console.log(header)
  console.log(divider)

  for (const rec of records) {
    const id = rec.id.slice(0, 8)
    const method = pad(rec.method, 8)
    const p = pad(rec.path.length > 40 ? rec.path.slice(0, 39) + '…' : rec.path, 40)
    const status = pad(rec.status !== null && rec.status !== undefined ? String(rec.status) : '---', 8)
    const dur = pad(
      rec.durationMs !== null && rec.durationMs !== undefined ? `${rec.durationMs}ms` : '---',
      10
    )
    const age = formatAge(rec.ts)

    console.log(`${id}  ${method}  ${p}  ${status}  ${dur}  ${age}`)
  }
}

export async function cmdHistory(args: { limit?: number; relay?: string }) {
  const relayUrl = args.relay ?? process.env['CONDUIT_RELAY_URL'] ?? DEFAULT_RELAY_WS_URL
  const limit = args.limit ?? 50
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

  const records = await new Promise<RequestRecord[]>((resolve, reject) => {
    const events = {
      onConnected(_slug: string, _tok: string, _url: string) {
        client.sendFetch([], limit)
      },
      onRequest() {},
      onRequestChunk() {},
      onRequestEnd() {},
      onCompleted() {},
      onWatcherCount() {},
      onRecords(recs: RequestRecords) {
        client.disconnect()
        resolve(recs.records)
      },
      onError(code: string, message: string) {
        client.disconnect()
        reject(new Error(`Relay error [${code}]: ${message}`))
      },
      onDisconnect() {},
    }

    const client = new ConduitClient(relayUrl, slug, token, {}, events)
    client.connect()

    setTimeout(() => {
      client.disconnect()
      reject(new Error('Timed out waiting for relay response'))
    }, 10_000)
  })

  if (records.length === 0) {
    console.log('No requests found in history.')
    return
  }

  printTable(records)
  console.log(`\n${records.length} record${records.length !== 1 ? 's' : ''}`)
}
