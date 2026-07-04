#!/usr/bin/env node
// Steer contributors to Bun. Conduit is a Bun workspace (only bun.lock is
// committed). Running `npm install` triggers a known npm/arborist crash while
// deduping workspace symlinks against this repo's root `overrides`
// ("Cannot read properties of null (reading 'matches')"). Fail fast with a
// clear message instead of that cryptic stack trace.
//
// Fail-open for unknown package managers, fail-closed only for npm/yarn/pnpm,
// so `bun install` (npm_config_user_agent = "bun/...") is never blocked.
const ua = process.env.npm_config_user_agent || ''

if (ua.startsWith('bun/')) process.exit(0)

if (ua.startsWith('npm/') || ua.startsWith('yarn/') || ua.startsWith('pnpm/')) {
  const pm = ua.split('/')[0]
  console.error(
    `\n  Conduit uses Bun, but you ran ${pm}.\n` +
      `  Please install with:  bun install\n` +
      `  (npm/yarn/pnpm are not supported — see the README.)\n`,
  )
  process.exit(1)
}

// Unknown or empty user agent (e.g. a direct `node scripts/require-bun.mjs`
// invocation): do not block.
process.exit(0)
