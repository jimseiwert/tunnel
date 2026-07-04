#!/usr/bin/env node
import { ConfigMismatchError, DEFAULT_RELAY_WS_URL, DEFAULT_DASHBOARD_URL } from './config.js'
import { CLI_VERSION as VERSION } from './version.js'
import { loadDotenv } from './env.js'

function printHelp(): void {
  console.log(`
conduit - Conduit CLI

USAGE
  conduit <command> [options]

COMMANDS
  start               Start the conduit and open the TUI dashboard
  login               Log in to Conduit (opens browser)
  logout              Log out and clear stored credentials
  diff <id1> <id2>    Show diff between two recorded requests
  history             Show recent request history
  replay <id>         Replay a previously recorded request
  token refresh       Refresh the conduit token

OPTIONS (start)
  --port <port>       Local port to forward to (default: 3000)
  --http              Enable HTTP (not just HTTPS) on the conduit
  --relay <url>       Relay WebSocket URL (default: ${DEFAULT_RELAY_WS_URL})

OPTIONS (login)
  --dashboard <url>   Dashboard URL (default: ${DEFAULT_DASHBOARD_URL})

OPTIONS (diff / history / replay / token)
  --relay <url>       Relay WebSocket URL

OPTIONS (history)
  --limit <n>         Number of records to fetch (default: 50)

GLOBAL
  --help              Show this help
  --version           Show version

EXAMPLES
  conduit login
  conduit start
  conduit start --port 3001
  conduit history --limit 20
  conduit replay 550e8400-e29b-41d4-a716-446655440000
  conduit diff <id1> <id2>
  conduit token refresh
`.trim())
}

function parseArgs(argv: string[]): {
  command: string
  positional: string[]
  flags: Record<string, string | boolean>
} {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}

  let i = 0
  // Find first positional (command)
  while (i < argv.length) {
    const arg = argv[i]!
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i += 2
      } else {
        flags[key] = true
        i++
      }
    } else {
      positional.push(arg)
      i++
    }
  }

  const command = positional[0] ?? ''
  const restPositional = positional.slice(1)

  return { command, positional: restPositional, flags }
}

async function main(): Promise<void> {
  loadDotenv()
  const argv = process.argv.slice(2)
  const { command, positional, flags } = parseArgs(argv)

  if (flags['help'] || command === 'help' || command === '') {
    printHelp()
    return
  }

  if (flags['version'] || command === 'version') {
    console.log(`conduit v${VERSION}`)
    return
  }

  try {
    switch (command) {
      case 'start': {
        const { cmdStart } = await import('./commands/start.js')
        await cmdStart({
          port: flags['port'] ? Number(flags['port']) : undefined,
          slug: flags['slug'] as string | undefined,
          http: flags['http'] === true,
          config: flags['config'] as string | undefined,
          relay: flags['relay'] as string | undefined,
        })
        break
      }

      case 'login': {
        const { cmdLogin } = await import('./commands/login.js')
        await cmdLogin({
          dashboard: flags['dashboard'] as string | undefined,
        })
        break
      }

      case 'logout': {
        const { cmdLogout } = await import('./commands/logout.js')
        cmdLogout()
        break
      }

      case 'auth': {
        // Legacy alias for login
        const { cmdLogin } = await import('./commands/login.js')
        await cmdLogin({
          dashboard: flags['dashboard'] as string | undefined,
        })
        break
      }

      case 'diff': {
        const id1 = positional[0]
        const id2 = positional[1]
        if (!id1 || !id2) {
          console.error('Usage: conduit diff <id1> <id2>')
          process.exit(1)
        }
        const { cmdDiff } = await import('./commands/diff.js')
        await cmdDiff(id1, id2, {
          relay: flags['relay'] as string | undefined,
        })
        break
      }

      case 'history': {
        const { cmdHistory } = await import('./commands/history.js')
        await cmdHistory({
          limit: flags['limit'] ? Number(flags['limit']) : undefined,
          relay: flags['relay'] as string | undefined,
        })
        break
      }

      case 'replay': {
        const id = positional[0]
        if (!id) {
          console.error('Usage: conduit replay <request-id>')
          process.exit(1)
        }
        const { cmdReplay } = await import('./commands/replay.js')
        await cmdReplay(id, {
          relay: flags['relay'] as string | undefined,
        })
        break
      }

      case 'token': {
        const sub = positional[0]
        if (sub === 'refresh') {
          const { cmdTokenRefresh } = await import('./commands/token.js')
          await cmdTokenRefresh({
            relay: flags['relay'] as string | undefined,
          })
        } else {
          console.error(`Unknown token subcommand: ${sub ?? '(none)'}`)
          console.error('Usage: conduit token refresh')
          process.exit(1)
        }
        break
      }

      default: {
        console.error(`Unknown command: ${command}`)
        console.error('Run `conduit --help` for usage.')
        process.exit(1)
      }
    }
  } catch (err) {
    if (err instanceof ConfigMismatchError) {
      console.error(`\nConfig mismatch:\n  ${err.message}\n`)
      process.exit(1)
    }
    // Re-throw unexpected errors
    throw err
  }
}

main().catch((err) => {
  console.error('Unexpected error:', (err as Error).message)
  process.exit(1)
})
