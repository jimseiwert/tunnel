import * as jsondiffpatch from 'jsondiffpatch'
import { ConduitClient } from '../ws/client.js'
import { loadProjectConfig, DEFAULT_RELAY_WS_URL } from '../config.js'
import type { RequestRecords, RequestRecord } from '@conduit/types'

function formatDelta(delta: jsondiffpatch.Delta, path = '', indent = 0): void {
  if (delta === null || delta === undefined) return

  const pad = '  '.repeat(indent)

  if (Array.isArray(delta)) {
    if (delta.length === 1) {
      console.log(`${pad}\x1b[32m+ ${path}: ${JSON.stringify(delta[0])}\x1b[0m`)
    } else if (delta.length === 3 && delta[1] === 0 && delta[2] === 0) {
      console.log(`${pad}\x1b[31m- ${path}: ${JSON.stringify(delta[0])}\x1b[0m`)
    } else if (delta.length === 2) {
      console.log(`${pad}\x1b[33m~ ${path}:\x1b[0m`)
      console.log(`${pad}  \x1b[31m- ${JSON.stringify(delta[0])}\x1b[0m`)
      console.log(`${pad}  \x1b[32m+ ${JSON.stringify(delta[1])}\x1b[0m`)
    }
  } else if (typeof delta === 'object') {
    const isArrayDelta = (delta as Record<string, unknown>)['_t'] === 'a'
    for (const [key, val] of Object.entries(delta as Record<string, jsondiffpatch.Delta>)) {
      if (key === '_t') continue
      const childPath = isArrayDelta
        ? `${path}[${key.replace(/^_/, '')}]`
        : path
        ? `${path}.${key}`
        : key
      formatDelta(val, childPath, indent)
    }
  }
}

export async function cmdDiff(
  id1: string,
  id2: string,
  args: { relay?: string }
) {
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

  const records = await fetchRecords(relayUrl, slug, token, [id1, id2])

  if (records.length < 2) {
    console.error(`Could not fetch both records (got ${records.length})`)
    process.exit(1)
  }

  // Match records to requested IDs
  const rec1 = records.find((r) => r.id === id1) ?? records[0]!
  const rec2 = records.find((r) => r.id === id2) ?? records[1]!

  const differ = jsondiffpatch.create({
    arrays: { detectMove: true },
  })

  const delta = differ.diff(rec1, rec2)

  if (!delta) {
    console.log('No differences found between the two requests.')
    return
  }

  console.log(`\nDiff: ${id1.slice(0, 8)} → ${id2.slice(0, 8)}\n`)
  formatDelta(delta)
  console.log()
}

function fetchRecords(
  relayUrl: string,
  slug: string,
  token: string | null,
  ids: string[]
): Promise<RequestRecord[]> {
  return new Promise((resolve, reject) => {
    const records: RequestRecord[] = []

    const events = {
      onConnected(_slug: string, _tok: string, _url: string) {
        client.sendFetch(ids)
      },
      onRequest() {},
      onRequestChunk() {},
      onRequestEnd() {},
      onCompleted() {},
      onWatcherCount() {},
      onRecords(recs: RequestRecords) {
        for (const r of recs.records) {
          if (ids.includes(r.id)) records.push(r)
        }
        client.disconnect()
        resolve(records)
      },
      onError(code: string, message: string) {
        client.disconnect()
        reject(new Error(`Relay error [${code}]: ${message}`))
      },
      onDisconnect() {},
    }

    const client = new ConduitClient(relayUrl, slug, token, {}, events)
    client.connect()

    // Timeout after 10 seconds
    setTimeout(() => {
      client.disconnect()
      reject(new Error('Timed out waiting for relay response'))
    }, 10_000)
  })
}
