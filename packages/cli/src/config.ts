import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { randomBytes } from 'node:crypto'

/** Default SaaS relay WebSocket URL (public product default; override via CONDUIT_RELAY_URL). */
export const DEFAULT_RELAY_WS_URL = 'wss://relay.conduitrelay.com'
/** Default SaaS relay HTTP base (for REST calls like renew). */
export const DEFAULT_RELAY_HTTP_URL = 'https://relay.conduitrelay.com'
/** Default SaaS dashboard URL used for login. */
export const DEFAULT_DASHBOARD_URL = 'https://app.conduitrelay.com'

/** Host portion of the default SaaS relay, e.g. "relay.conduitrelay.com". */
const DEFAULT_RELAY_HOST = 'relay.conduitrelay.com'

/** True when the given URL targets the default SaaS relay host (ws:// or https://). */
export function isDefaultRelayHost(url: string): boolean {
  if (!url) return false
  try {
    return new URL(url).host === DEFAULT_RELAY_HOST
  } catch {
    return false
  }
}

export interface ProjectEntry {
  slug: string
  token: string | null
  port: number
  httpEnabled: boolean
  relayUrl?: string
}

export interface GlobalConfig {
  relayUrl?: string
  dashboardUrl?: string
}

interface HomeConfig {
  version: number
  global?: GlobalConfig
  projects: Record<string, ProjectEntry>
}

export class ConfigMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigMismatchError'
  }
}

export class ConfigNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigNotFoundError'
  }
}

/**
 * Returns the path to the ~/.conduit directory.
 * Respects the CONDUIT_HOME environment variable override.
 */
export function getHomeConfigDir(): string {
  return process.env['CONDUIT_HOME'] ?? path.join(os.homedir(), '.conduit')
}

/**
 * Returns the path to the ~/.conduit/projects.json file.
 */
function getHomeConfigPath(): string {
  return path.join(getHomeConfigDir(), 'projects.json')
}

/**
 * Reads the home config file and returns all projects, or an empty config if
 * the file does not exist or cannot be parsed.
 */
function readHomeConfig(): HomeConfig {
  const configPath = getHomeConfigPath()
  if (!fs.existsSync(configPath)) {
    return { version: 1, projects: {} }
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as HomeConfig
    if (!parsed.projects || typeof parsed.projects !== 'object') {
      return { version: 1, projects: {} }
    }
    return parsed
  } catch {
    return { version: 1, projects: {} }
  }
}

/**
 * Loads the project config entry for the given project root directory.
 * Returns null if no entry exists for this project.
 */
export function loadProjectConfig(cwd: string): ProjectEntry | null {
  const normalized = path.resolve(cwd)
  const config = readHomeConfig()
  return config.projects[normalized] ?? null
}

/**
 * Saves (or updates) the project config entry for the given project root directory.
 * Writes atomically to ~/.conduit/projects.json.
 */
export function saveProjectConfig(cwd: string, entry: ProjectEntry): void {
  const normalized = path.resolve(cwd)
  const configDir = getHomeConfigDir()
  const configPath = getHomeConfigPath()

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  const config = readHomeConfig()
  config.projects[normalized] = entry

  // Write to a temp file then rename for atomic update
  const tmpPath = configPath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
  fs.renameSync(tmpPath, configPath)
}

// ─── Credentials (stored token from conduit login) ───────────────────────────

export interface StoredCredentials {
  token: string
  userId: string
  email: string
  dashboardUrl: string
  createdAt: number
}

function getCredentialsPath(): string {
  return path.join(getHomeConfigDir(), 'credentials.json')
}

export function loadCredentials(): StoredCredentials | null {
  const credPath = getCredentialsPath()
  if (!fs.existsSync(credPath)) return null
  try {
    return JSON.parse(fs.readFileSync(credPath, 'utf8')) as StoredCredentials
  } catch {
    return null
  }
}

export function saveCredentials(creds: StoredCredentials): void {
  const configDir = getHomeConfigDir()
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
  const credPath = getCredentialsPath()
  const tmpPath = credPath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(creds, null, 2) + '\n', 'utf8')
  fs.renameSync(tmpPath, credPath)
}

export function clearCredentials(): boolean {
  const credPath = getCredentialsPath()
  if (fs.existsSync(credPath)) {
    fs.unlinkSync(credPath)
    return true
  }
  return false
}

// ─── Global config (relay URL, dashboard URL) ─────────────────────────────────

/**
 * Loads the global config (relay URL, dashboard URL) from ~/.conduit/projects.json.
 */
export function loadGlobalConfig(): GlobalConfig {
  return readHomeConfig().global ?? {}
}

/**
 * Saves global config fields (relay URL, dashboard URL) into ~/.conduit/projects.json.
 */
export function saveGlobalConfig(global: GlobalConfig): void {
  const configDir = getHomeConfigDir()
  const configPath = getHomeConfigPath()

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  const config = readHomeConfig()
  config.global = { ...config.global, ...global }

  const tmpPath = configPath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
  fs.renameSync(tmpPath, configPath)
}

/**
 * Returns the effective relay WebSocket URL, checking in order:
 * CONDUIT_RELAY_URL env var → global config → default
 */
export function getRelayUrl(): string {
  return (
    process.env['CONDUIT_RELAY_URL'] ??
    loadGlobalConfig().relayUrl ??
    DEFAULT_RELAY_WS_URL
  )
}

/**
 * Returns the effective dashboard URL for auth, checking in order:
 * CONDUIT_DASHBOARD_URL env var → global config → default
 */
export function getDashboardUrl(): string {
  return (
    process.env['CONDUIT_DASHBOARD_URL'] ??
    loadGlobalConfig().dashboardUrl ??
    DEFAULT_DASHBOARD_URL
  )
}

/**
 * Generates a new unique relay slug in the form "ws-" followed by 12 hex chars.
 * Example: "ws-a3f9c2b1d4e6"
 */
export function generateSlug(): string {
  return 'ws-' + randomBytes(6).toString('hex')
}
