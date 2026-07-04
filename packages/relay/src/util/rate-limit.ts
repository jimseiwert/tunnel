interface Window {
  count: number
  resetAt: number
}

/**
 * In-memory fixed-window rate limiter keyed by an arbitrary string (e.g. client
 * IP). Zero dependencies. `now` is injectable for testing. Call `sweep()`
 * periodically to drop expired windows and bound memory.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, Window>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns true if the request is allowed, false if the key is over its limit. */
  check(key: string): boolean {
    const t = this.now()
    const w = this.windows.get(key)
    if (!w || t >= w.resetAt) {
      this.windows.set(key, { count: 1, resetAt: t + this.windowMs })
      return true
    }
    if (w.count >= this.max) return false
    w.count += 1
    return true
  }

  /** Drops windows whose reset time has passed, bounding map growth. */
  sweep(): void {
    const t = this.now()
    for (const [key, w] of this.windows) {
      if (t >= w.resetAt) this.windows.delete(key)
    }
  }
}
