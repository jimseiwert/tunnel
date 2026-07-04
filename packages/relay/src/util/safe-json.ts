/**
 * Parses a stored headers JSON string into a plain object. Returns {} for
 * null/undefined input or any malformed/non-object JSON, so a corrupt or
 * partially-migrated storage record cannot crash the WebSocket handler.
 */
export function parseHeadersJson(
  json: string | null | undefined,
): Record<string, string> {
  if (json == null) return {}
  try {
    const parsed = JSON.parse(json) as unknown
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>
    }
    return {}
  } catch {
    return {}
  }
}
