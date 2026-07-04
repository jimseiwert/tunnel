export type Edition = 'community' | 'cloud'

/**
 * Resolve the build/runtime edition. Unset or unknown values fall back to
 * 'community' so a fresh clone is always the self-hostable edition.
 */
export function resolveEdition(
  env: Record<string, string | undefined> = process.env,
): Edition {
  return env['EDITION'] === 'cloud' ? 'cloud' : 'community'
}

export const EDITION: Edition = resolveEdition()
