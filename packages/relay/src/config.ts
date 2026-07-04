export interface RelayConfig {
  port: number
  jwtSecret: string
  authRequired: boolean
  registrationToken?: string
  ringBufferSize: number
  maxBodyBytes: number
  forwardTimeoutMs: number
  rateLimitMax: number
  rateLimitWindowMs: number
  storageAdapter: 'memory' | 'sqlite' | 'postgres'
  sqlitePath?: string
  databaseUrl?: string
  relayDomain: string
  relayProto: string
  adminSecret?: string
  authProvider?: 'oidc' | 'msal'
  // OIDC config
  oidcIssuer?: string
  oidcClientId?: string
  oidcClientSecret?: string
  oidcRedirectUri?: string
  // MSAL config
  msalTenantId?: string
  msalClientId?: string
  msalClientSecret?: string
}

/**
 * Parses an integer env var, falling back to `fallback` when unset or
 * non-numeric. `min` clamps the low end (e.g. window must be >= 1ms). A
 * non-numeric RATE_LIMIT_* must not silently disable the limiter, so we fall
 * back rather than yield NaN.
 */
function parseIntEnv(raw: string | undefined, fallback: number, min: number): number {
  if (raw === undefined) return fallback
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return n < min ? min : n
}

export function loadConfig(): RelayConfig {
  const jwtSecret = process.env['CONDUIT_JWT_SECRET']
  if (!jwtSecret) {
    throw new Error('CONDUIT_JWT_SECRET environment variable is required')
  }

  const storageAdapter = (process.env['STORAGE_ADAPTER'] ?? 'memory') as RelayConfig['storageAdapter']
  if (!['memory', 'sqlite', 'postgres'].includes(storageAdapter)) {
    throw new Error(`Invalid STORAGE_ADAPTER: "${storageAdapter}". Must be "memory", "sqlite", or "postgres"`)
  }

  if (storageAdapter === 'sqlite' && !process.env['SQLITE_PATH']) {
    throw new Error('SQLITE_PATH is required when STORAGE_ADAPTER=sqlite')
  }

  if (storageAdapter === 'postgres' && !process.env['DATABASE_URL']) {
    throw new Error('DATABASE_URL is required when STORAGE_ADAPTER=postgres')
  }

  const authProvider = process.env['AUTH_PROVIDER'] as RelayConfig['authProvider'] | undefined
  if (authProvider && !['oidc', 'msal'].includes(authProvider)) {
    throw new Error(`Invalid AUTH_PROVIDER: "${authProvider}". Must be "oidc" or "msal"`)
  }

  return {
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    jwtSecret,
    authRequired: process.env['RELAY_AUTH_REQUIRED'] !== 'false',
    registrationToken: process.env['RELAY_REGISTRATION_TOKEN'],
    ringBufferSize: parseInt(process.env['RING_BUFFER_SIZE'] ?? '1000', 10),
    maxBodyBytes: parseInt(process.env['MAX_BODY_BYTES'] ?? '1048576', 10),
    forwardTimeoutMs: parseInt(process.env['FORWARD_TIMEOUT_MS'] ?? '30000', 10),
    // min 0 for max: 0 explicitly disables the limiter; a non-numeric value
    // falls back to 120 rather than disabling silently.
    rateLimitMax: parseIntEnv(process.env['RATE_LIMIT_MAX'], 120, 0),
    // min 1 for the window so the sweep interval is always positive.
    rateLimitWindowMs: parseIntEnv(process.env['RATE_LIMIT_WINDOW_MS'], 60000, 1),
    storageAdapter,
    sqlitePath: process.env['SQLITE_PATH'],
    databaseUrl: process.env['DATABASE_URL'],
    relayDomain: process.env['RELAY_DOMAIN'] ?? 'relay.conduitrelay.com',
    relayProto: process.env['RELAY_PROTO'] ?? 'https',
    adminSecret: process.env['RELAY_ADMIN_SECRET'],
    authProvider,
    oidcIssuer: process.env['OIDC_ISSUER'],
    oidcClientId: process.env['OIDC_CLIENT_ID'],
    oidcClientSecret: process.env['OIDC_CLIENT_SECRET'],
    oidcRedirectUri: process.env['OIDC_REDIRECT_URI'],
    msalTenantId: process.env['MSAL_TENANT_ID'],
    msalClientId: process.env['MSAL_CLIENT_ID'],
    msalClientSecret: process.env['MSAL_CLIENT_SECRET'],
  }
}
