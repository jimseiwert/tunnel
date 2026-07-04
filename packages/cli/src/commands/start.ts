import React from 'react'
import { render } from 'ink'
import jwt from 'jsonwebtoken'
import {
  loadProjectConfig,
  saveProjectConfig,
  generateSlug,
  loadCredentials,
  DEFAULT_RELAY_WS_URL,
  isDefaultRelayHost,
} from '../config.js'
import { ConduitClient } from '../ws/client.js'
import { App } from '../ui/App.js'

import { CLI_VERSION } from '../version.js'

export function loginRequiredMessage(relayUrl: string): string {
  return [
    `Not logged in to ${relayUrl}.`,
    '',
    '  Run `conduit login` to authenticate with the hosted relay.',
    '',
    '  Self-hosting your own relay? Point the CLI at it and no login is needed:',
    '    export CONDUIT_RELAY_URL=wss://relay.yourdomain.com',
  ].join('\n')
}

export async function cmdStart(args: {
  port?: number
  slug?: string  // kept for backward compat but ignored if project already registered
  http?: boolean
  config?: string
  relay?: string
}) {
  const cwd = process.cwd()
  const relayUrl = args.relay ?? process.env['CONDUIT_RELAY_URL'] ?? DEFAULT_RELAY_WS_URL

  // Check if running in VS Code integrated terminal
  const inVscode = !!process.env['VSCODE_PID'] || process.env['TERM_PROGRAM'] === 'vscode'
  if (inVscode) {
    console.log('Tip: The Conduit VS Code extension can show live requests directly in your editor.')
  }

  // Load or create project config
  let entry = loadProjectConfig(cwd)
  const isFirstRun = !entry

  if (!entry) {
    const slug = generateSlug()
    const port = args.port ?? 3000
    const httpEnabled = args.http ?? false
    entry = { slug, token: null, port, httpEnabled, relayUrl }
    saveProjectConfig(cwd, entry)
  } else {
    // Apply any CLI overrides
    if (args.port !== undefined) entry.port = args.port
    if (args.http !== undefined) entry.httpEnabled = args.http
    if (args.relay) entry.relayUrl = args.relay
    // Migrate stale relay URLs from old domains
    if (entry.relayUrl && /debug\.tunnel\.digital|tunnel\.digital/.test(entry.relayUrl)) {
      entry.relayUrl = DEFAULT_RELAY_WS_URL
      saveProjectConfig(cwd, entry)
    }
  }

  const { slug, port, httpEnabled } = entry
  const token = entry.token ?? null
  const effectiveRelay = entry.relayUrl ?? relayUrl

  // Check token expiry
  if (token) {
    try {
      const decoded = jwt.decode(token) as Record<string, unknown> | null
      if (decoded && typeof decoded['exp'] === 'number') {
        const nowSec = Date.now() / 1000
        if (decoded['exp'] < nowSec) {
          console.error('Token expired. Run `conduit token refresh`')
          process.exit(1)
        }
      }
    } catch {
      // Non-fatal — let relay reject if invalid
    }
  }

  let currentUrl = `${effectiveRelay.replace(/^wss?:\/\//, 'https://')}/${slug}/`

  const events = {
    onConnected(_slug: string, newToken: string, url: string) {
      currentUrl = url
      // Persist the issued token back to home config
      const fresh = loadProjectConfig(cwd)
      if (fresh) {
        saveProjectConfig(cwd, { ...fresh, token: newToken, relayUrl: effectiveRelay })
      }
    },
    onRequest() {},
    onRequestChunk() {},
    onRequestEnd() {},
    onCompleted() {},
    onWatcherCount() {},
    onRecords() {},
    onError(code: string, message: string) {
      console.error(`Relay error [${code}]: ${message}`)
    },
    onDisconnect() {},
  }

  const credentials = loadCredentials()
  const userToken = credentials?.token

  // For the hosted relay, require login. Self-hosted relays use registrationToken
  // or RELAY_AUTH_REQUIRED=false, so we only gate on the default production relay.
  const isProductionRelay = isDefaultRelayHost(effectiveRelay)
  if (isProductionRelay && !userToken) {
    console.error(loginRequiredMessage(effectiveRelay))
    process.exit(1)
  }

  const client = new ConduitClient(
    effectiveRelay,
    slug,
    token,
    {
      registrationToken: process.env['CONDUIT_REGISTRATION_TOKEN'],
      userToken,
      httpEnabled,
      port,
      cwd,
    },
    events
  )

  client.connect()

  if (isFirstRun) {
    console.log(`New conduit registered with slug: ${slug}`)
  }

  const { waitUntilExit } = render(
    React.createElement(App, {
      slug,
      url: currentUrl,
      port,
      client,
      version: CLI_VERSION,
      userDisplay: credentials?.email || credentials?.userId,
    })
  )

  await waitUntilExit()
}
