import { timingSafeEqual } from 'node:crypto'

/**
 * Constant-time string comparison. Returns true only when both strings are
 * byte-for-byte equal. Length is compared first (which leaks only length, the
 * standard trade-off); a dummy comparison is run on mismatch so the mismatched
 * path is not trivially faster than the matched path.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) {
    // Burn comparable time, then report not-equal.
    timingSafeEqual(bb, bb)
    return false
  }
  return timingSafeEqual(ab, bb)
}
