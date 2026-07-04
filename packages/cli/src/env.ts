import { existsSync } from 'node:fs'
import { join } from 'node:path'
import dotenv from 'dotenv'

/**
 * Loads `<cwd>/.env` into process.env if present. Does NOT override variables
 * already set in the environment (shell/flags win over the file).
 */
export function loadDotenv(cwd: string = process.cwd()): void {
  const path = join(cwd, '.env')
  if (!existsSync(path)) return
  dotenv.config({ path, override: false })
}
