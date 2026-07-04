#!/usr/bin/env node
// Zero-dependency import-boundary check.
// Core packages must NOT import from packages/cloud (the private cloud edition).
// Exits 1 and lists offenders on violation; exits 0 when clean.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cloudDir = join(repoRoot, 'packages', 'cloud')

// Source roots whose code must never reach into packages/cloud.
const coreRoots = [
  'packages/relay/src',
  'packages/cli/src',
  'packages/vscode-ext/src',
  'packages/types/src',
  'apps/dashboard/src',
]

const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

function walk(dir) {
  let out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue
      out = out.concat(walk(full))
    } else {
      const dot = e.name.lastIndexOf('.')
      if (dot !== -1 && exts.has(e.name.slice(dot))) out.push(full)
    }
  }
  return out
}

// Captures the module specifier from:
//   import ... from '<spec>'   /   export ... from '<spec>'
//   require('<spec>')          /   import('<spec>')
//   import '<spec>'            (bare side-effect import)
const specRe =
  /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g

function hitsCloud(spec, fileDir) {
  // Bare workspace specifier for the cloud package.
  if (spec === '@conduit/cloud' || spec.startsWith('@conduit/cloud/')) return true
  // Relative specifier that resolves into packages/cloud.
  if (spec.startsWith('.')) {
    const rel = relative(cloudDir, resolve(fileDir, spec))
    if (rel === '' || !rel.startsWith('..')) return true
  }
  // Any explicit mention of the path.
  if (spec.includes('packages/cloud')) return true
  return false
}

const violations = []
for (const root of coreRoots) {
  for (const file of walk(join(repoRoot, root))) {
    const src = readFileSync(file, 'utf8')
    specRe.lastIndex = 0
    let m
    while ((m = specRe.exec(src)) !== null) {
      const spec = m[1] || m[2] || m[3] || m[4]
      if (spec && hitsCloud(spec, dirname(file))) {
        const line = src.slice(0, m.index).split('\n').length
        violations.push(`${relative(repoRoot, file)}:${line} imports '${spec}'`)
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Import boundary violation: core packages must not import from packages/cloud')
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log('Import boundary OK: no core -> packages/cloud imports')
