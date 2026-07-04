import jwt from 'jsonwebtoken'
import { loadProjectConfig, saveProjectConfig, DEFAULT_RELAY_HTTP_URL } from '../config.js'

const RENEWAL_THRESHOLD_DAYS = 7

export async function cmdTokenRefresh(args: { relay?: string }) {
  const relayBase = (args.relay ?? process.env['CONDUIT_RELAY_URL'] ?? DEFAULT_RELAY_HTTP_URL)
    .replace(/^wss?:\/\//, 'https://')
    .replace(/\/$/, '')

  const cwd = process.cwd()

  const entry = loadProjectConfig(cwd)
  if (!entry) {
    console.error('No conduit project found for this directory. Run `conduit start` first.')
    process.exit(1)
  }

  if (!entry.token) {
    console.error('No CONDUIT_TOKEN found. Run `conduit start` to register a conduit first.')
    process.exit(1)
  }

  const token = entry.token
  const slug = entry.slug

  // Decode to check expiry
  let decoded: Record<string, unknown> | null = null
  try {
    decoded = jwt.decode(token) as Record<string, unknown> | null
  } catch {
    console.error('Malformed CONDUIT_TOKEN — cannot decode')
    process.exit(1)
  }

  if (!decoded || typeof decoded['exp'] !== 'number') {
    console.error('Token has no expiry field — cannot determine validity')
    process.exit(1)
  }

  const nowSec = Date.now() / 1000
  const expSec = decoded['exp'] as number
  const sevenDaysFromNow = nowSec + RENEWAL_THRESHOLD_DAYS * 86400

  if (expSec < nowSec) {
    // Already expired
    console.log('Token has expired. Attempting renewal...')
  } else if (expSec > sevenDaysFromNow) {
    // Still valid with > 7 days remaining
    const expiryDate = new Date(expSec * 1000).toISOString()
    console.log(`Token is still valid. Expires ${expiryDate}.`)
    return
  } else {
    console.log('Token is near expiry. Renewing...')
  }

  // Attempt renewal
  try {
    const res = await fetch(`${relayBase}/${slug}/renew`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`Renewal failed: ${res.status} ${res.statusText}\n${text}`)
      process.exit(1)
    }

    const data = (await res.json()) as Record<string, unknown>
    const newToken = data['token'] as string | undefined

    if (!newToken) {
      console.error('Relay did not return a new token')
      process.exit(1)
    }

    saveProjectConfig(cwd, { ...entry, token: newToken })

    // Decode new token for display
    const newDecoded = jwt.decode(newToken) as Record<string, unknown> | null
    const newExpiry =
      newDecoded && typeof newDecoded['exp'] === 'number'
        ? new Date((newDecoded['exp'] as number) * 1000).toISOString()
        : 'unknown'

    console.log(`Token refreshed. New expiry: ${newExpiry}.`)
  } catch (err) {
    console.error(`Failed to renew token: ${(err as Error).message}`)
    process.exit(1)
  }
}
