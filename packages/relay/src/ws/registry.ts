import type { WebSocket } from 'ws'

/** Grace period in milliseconds before an owner slot is cleared after disconnect. */
const GRACE_PERIOD_MS = 30_000

interface SlugConnection {
  owner: WebSocket | null
  watchers: Set<WebSocket>
  gracePeriodTimer?: ReturnType<typeof setTimeout>
}

/**
 * In-memory registry of active WebSocket connections per conduit slug.
 *
 * Owner lifecycle:
 *   1. connect  → setOwner(slug, ws)          — cancels any active grace timer
 *   2. graceful → clearOwner(slug)            — starts 30 s grace period
 *   3. hard close → clearOwner(slug)          — same; owner can reconnect within 30 s
 *   4. grace expires → owner slot set to null — next connect treated as new registration
 */
export class ConnectionRegistry {
  private readonly connections = new Map<string, SlugConnection>()

  private getOrCreate(slug: string): SlugConnection {
    let conn = this.connections.get(slug)
    if (!conn) {
      conn = { owner: null, watchers: new Set() }
      this.connections.set(slug, conn)
    }
    return conn
  }

  setOwner(slug: string, ws: WebSocket): void {
    const conn = this.getOrCreate(slug)
    // Cancel any pending grace period — this is a reconnect
    if (conn.gracePeriodTimer) {
      clearTimeout(conn.gracePeriodTimer)
      conn.gracePeriodTimer = undefined
    }
    conn.owner = ws
  }

  /**
   * Clears the owner reference and starts the 30 s grace period.
   * While the grace period is active, hasOwner() still returns false so new
   * owners cannot steal the slot — but the same owner can reconnect and call
   * setOwner() to cancel the timer.
   */
  clearOwner(slug: string): void {
    const conn = this.connections.get(slug)
    if (!conn) return

    conn.owner = null

    if (conn.gracePeriodTimer) {
      clearTimeout(conn.gracePeriodTimer)
    }

    conn.gracePeriodTimer = setTimeout(() => {
      // Grace period expired — slot is fully released.
      conn.gracePeriodTimer = undefined
      // Prune the entry entirely if nothing else references this slug, so the
      // connections map does not grow without bound under high slug churn.
      if (conn.owner === null && conn.watchers.size === 0) {
        this.connections.delete(slug)
      }
    }, GRACE_PERIOD_MS)
  }

  addWatcher(slug: string, ws: WebSocket): void {
    const conn = this.getOrCreate(slug)
    conn.watchers.add(ws)
  }

  removeWatcher(slug: string, ws: WebSocket): void {
    const conn = this.connections.get(slug)
    if (!conn) return
    conn.watchers.delete(ws)
  }

  getOwner(slug: string): WebSocket | null {
    return this.connections.get(slug)?.owner ?? null
  }

  getWatchers(slug: string): Set<WebSocket> {
    return this.connections.get(slug)?.watchers ?? new Set()
  }

  /**
   * Returns true only when there is an active (non-null) owner WebSocket.
   * During a grace period the owner is null, so this returns false — which
   * allows the same client to re-establish ownership.
   */
  hasOwner(slug: string): boolean {
    return this.connections.get(slug)?.owner != null
  }

  /** True while an internal entry exists for the slug (owner, watchers, or grace timer). */
  hasConnection(slug: string): boolean {
    return this.connections.has(slug)
  }

  /**
   * Returns true if the slug is within its grace period (owner just disconnected
   * but the slot has not yet been fully released).
   */
  isInGracePeriod(slug: string): boolean {
    const conn = this.connections.get(slug)
    return conn != null && conn.owner === null && conn.gracePeriodTimer != null
  }

  broadcastToAll(slug: string, data: string): void {
    const conn = this.connections.get(slug)
    if (!conn) return
    const send = (ws: WebSocket) => {
      if (ws.readyState === ws.OPEN) ws.send(data)
    }
    if (conn.owner) send(conn.owner)
    conn.watchers.forEach(send)
  }

  broadcastToWatchers(slug: string, data: string): void {
    const conn = this.connections.get(slug)
    if (!conn) return
    conn.watchers.forEach((ws) => {
      if (ws.readyState === ws.OPEN) ws.send(data)
    })
  }
}
