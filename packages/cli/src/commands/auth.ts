import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as child_process from 'node:child_process'
import { DEFAULT_RELAY_HTTP_URL } from '../config.js'

/**
 * Opens a URL in the system default browser.
 */
function openBrowser(url: string): void {
  const platform = process.platform
  let cmd: string
  if (platform === 'darwin') {
    cmd = 'open'
  } else if (platform === 'win32') {
    cmd = 'start'
  } else {
    cmd = 'xdg-open'
  }
  child_process.spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref()
}

/**
 * Writes CONDUIT_USER_TOKEN to the .env file in cwd.
 * Creates if not present, updates the existing line if found.
 */
function writeUserToken(cwd: string, token: string): void {
  const envPath = path.join(cwd, '.env')
  const newLine = `CONDUIT_USER_TOKEN=${token}`

  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, newLine + '\n', 'utf8')
    return
  }

  const content = fs.readFileSync(envPath, 'utf8')
  const lines = content.split('\n')
  const idx = lines.findIndex((l) => l.startsWith('CONDUIT_USER_TOKEN='))

  if (idx >= 0) {
    lines[idx] = newLine
    fs.writeFileSync(envPath, lines.join('\n'), 'utf8')
  } else {
    const appended = content.endsWith('\n')
      ? content + newLine + '\n'
      : content + '\n' + newLine + '\n'
    fs.writeFileSync(envPath, appended, 'utf8')
  }
}

/**
 * Gets a free local port by briefly binding to port 0.
 */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
  })
}

/**
 * Starts a one-shot HTTP callback server and waits for ?token= or ?userToken= query param.
 */
function waitForCallbackToken(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlObj = new URL(req.url ?? '/', `http://localhost:${port}`)
      const tok =
        urlObj.searchParams.get('token') ??
        urlObj.searchParams.get('userToken')

      if (tok) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(
          `<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;text-align:center">` +
            `<h1>Logged in!</h1><p>You can close this tab and return to your terminal.</p></body></html>`
        )
        server.close()
        resolve(tok)
      } else {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Missing token parameter')
      }
    })

    server.on('error', reject)
    server.listen(port, '127.0.0.1')

    // 5-minute timeout
    setTimeout(() => {
      server.close()
      reject(new Error('Auth timed out after 5 minutes. Please try again.'))
    }, 5 * 60 * 1000)
  })
}

/**
 * CLI auth flow:
 * 1. GET {relay}/auth/login?clientType=cli&callbackUrl=... to get browser URL
 * 2. Open browser
 * 3. Wait for OAuth callback with token
 * 4. Persist CONDUIT_USER_TOKEN to .env
 */
export async function cmdAuth(args: { relay?: string }) {
  const relayBase = (args.relay ?? process.env['CONDUIT_RELAY_URL'] ?? DEFAULT_RELAY_HTTP_URL)
    .replace(/^wss?:\/\//, 'https://')
    .replace(/\/$/, '')

  const cwd = process.cwd()
  const callbackPort = await getFreePort()
  const callbackUrl = `http://localhost:${callbackPort}/callback`

  // Step 1: Fetch login URL from relay
  let loginUrl: string
  try {
    const res = await fetch(
      `${relayBase}/auth/login?clientType=cli&callbackUrl=${encodeURIComponent(callbackUrl)}`
    )
    if (!res.ok) {
      console.error(`Auth request failed: ${res.status} ${res.statusText}`)
      process.exit(1)
    }
    const data = (await res.json()) as Record<string, unknown>
    loginUrl = (data['url'] ?? data['redirectUrl'] ?? data['loginUrl']) as string
    if (!loginUrl) {
      console.error('Relay did not return a login URL in the response')
      process.exit(1)
    }
  } catch (err) {
    console.error(`Failed to connect to relay at ${relayBase}: ${(err as Error).message}`)
    process.exit(1)
  }

  console.log('Opening browser for authentication...')
  console.log(`If the browser does not open, visit:\n  ${loginUrl}`)

  // Step 2: Open browser
  openBrowser(loginUrl)

  // Step 3: Wait for callback
  let token: string
  try {
    token = await waitForCallbackToken(callbackPort)
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }

  // Step 4: Persist token
  writeUserToken(cwd, token)

  console.log('Logged in successfully')
}
