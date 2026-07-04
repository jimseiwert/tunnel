import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDotenv } from '../env.js'

let dir: string | null = null
afterEach(() => {
  delete process.env['CONDUIT_TEST_VAR']
  if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null }
})

describe('loadDotenv', () => {
  it('loads variables from <cwd>/.env', () => {
    dir = mkdtempSync(join(tmpdir(), 'conduit-env-'))
    writeFileSync(join(dir, '.env'), 'CONDUIT_TEST_VAR=from_dotenv\n')
    loadDotenv(dir)
    expect(process.env['CONDUIT_TEST_VAR']).toBe('from_dotenv')
  })

  it('does not override an already-set variable', () => {
    dir = mkdtempSync(join(tmpdir(), 'conduit-env-'))
    writeFileSync(join(dir, '.env'), 'CONDUIT_TEST_VAR=from_dotenv\n')
    process.env['CONDUIT_TEST_VAR'] = 'from_shell'
    loadDotenv(dir)
    expect(process.env['CONDUIT_TEST_VAR']).toBe('from_shell')
  })

  it('is a no-op when no .env exists', () => {
    dir = mkdtempSync(join(tmpdir(), 'conduit-env-'))
    expect(() => loadDotenv(dir!)).not.toThrow()
  })
})
