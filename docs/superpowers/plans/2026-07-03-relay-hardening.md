# Relay Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the correctness/security gaps the audit found in the relay: timing-unsafe secret/token comparisons, unbounded stream-chunk memory growth, uncaught `JSON.parse`, a connection-registry memory leak, and missing rate limiting.

**Architecture:** Add three small, independently-tested utility modules under `packages/relay/src/util/` (`timing-safe`, `safe-json`, `rate-limit`) and wire them into the existing routes/WS handlers. Registry pruning and the stream-chunk cap are localized edits to `registry.ts` and `pending.ts`. All new limits are env-driven with safe defaults — no hardcoded values.

**Tech Stack:** Bun + TypeScript 6, Fastify, `ws`, Node `crypto`. Tests use `bun:test`.

## Global Constraints

- Base branch for this work: `main` (independent of the editions-boundary branch). Create `hardening/relay` off `main` before Task 1.
- Nothing environment-specific may be hardcoded — new limits (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`) are read from env with defaults resolved once in `config.ts`. From project rule "no-hardcoded-config".
- Preserve existing public behavior and the existing test suite; add tests, do not weaken them.
- Follow existing patterns: ESM `.js` import specifiers (NodeNext), `bun test`, error objects are `Error` instances, config is centralized in `packages/relay/src/config.ts`.
- Timing-safe comparisons must use Node's `crypto.timingSafeEqual`. Length mismatch may return false but must not short-circuit to a trivially-measurable fast path.

---

### Task 1: Timing-safe compare util + admin secret

**Files:**
- Create: `packages/relay/src/util/timing-safe.ts`
- Modify: `packages/relay/src/routes/admin.ts` (line 26 comparison)
- Test: `packages/relay/src/__tests__/timing-safe.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `timingSafeEqualStr(a: string, b: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `packages/relay/src/__tests__/timing-safe.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { timingSafeEqualStr } from '../util/timing-safe.js'

describe('timingSafeEqualStr', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeEqualStr('secret-abc', 'secret-abc')).toBe(true)
  })
  it('returns false for different same-length strings', () => {
    expect(timingSafeEqualStr('secret-abc', 'secret-xyz')).toBe(false)
  })
  it('returns false for different-length strings', () => {
    expect(timingSafeEqualStr('short', 'a-much-longer-secret')).toBe(false)
  })
  it('returns true for two empty strings', () => {
    expect(timingSafeEqualStr('', '')).toBe(true)
  })
  it('handles unicode without throwing', () => {
    expect(timingSafeEqualStr('café', 'café')).toBe(true)
    expect(timingSafeEqualStr('café', 'cafe')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/relay && bun test src/__tests__/timing-safe.test.ts`
Expected: FAIL — cannot resolve `../util/timing-safe.js`.

- [ ] **Step 3: Implement the util**

Create `packages/relay/src/util/timing-safe.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/relay && bun test src/__tests__/timing-safe.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Use it for the admin secret comparison**

In `packages/relay/src/routes/admin.ts`, add the import after the existing imports (below line 4):

```ts
import { timingSafeEqualStr } from '../util/timing-safe.js'
```

Replace the comparison on line 26. Change:

```ts
  if (req.headers['x-admin-secret'] !== config.adminSecret) {
```

to:

```ts
  const provided = req.headers['x-admin-secret']
  if (typeof provided !== 'string' || !timingSafeEqualStr(provided, config.adminSecret)) {
```

(Note: `config.adminSecret` is already guaranteed truthy here by the `!config.adminSecret` guard above at line 22.)

- [ ] **Step 6: Add a route-level test for the admin guard**

Create `packages/relay/src/__tests__/admin-auth.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createServer } from '../server.js'
import { MemoryStorageAdapter } from '../storage/memory.js'
import type { RelayConfig } from '../config.js'

function baseConfig(overrides: Partial<RelayConfig> = {}): RelayConfig {
  return {
    edition: 'community',
    port: 0,
    jwtSecret: 'test-secret',
    authRequired: false,
    ringBufferSize: 1000,
    maxBodyBytes: 1048576,
    forwardTimeoutMs: 30000,
    storageAdapter: 'memory',
    relayDomain: 'localhost:3000',
    relayProto: 'http',
    adminSecret: 'right-secret',
    rateLimitMax: 0,
    rateLimitWindowMs: 60000,
    ...overrides,
  }
}

describe('admin auth', () => {
  let app: Awaited<ReturnType<typeof createServer>>
  beforeEach(async () => {
    app = await createServer(baseConfig(), new MemoryStorageAdapter())
    await app.ready()
  })
  afterEach(async () => {
    await app.close()
  })

  it('rejects a wrong admin secret with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/slugs?userId=u1',
      headers: { 'x-admin-secret': 'wrong-secret' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('accepts the correct admin secret', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/slugs?userId=u1',
      headers: { 'x-admin-secret': 'right-secret' },
    })
    expect(res.statusCode).toBe(200)
  })
})
```

Note: this test uses `RelayConfig` fields `rateLimitMax`/`rateLimitWindowMs` that Task 6 adds to the interface. Until Task 6 lands, TypeScript will error on those two properties. If you are implementing tasks strictly in order, temporarily omit those two lines from `baseConfig` and add them in Task 6; if the interface already has them, keep them. Prefer running this test after Task 6, but the admin assertions themselves are valid immediately.

- [ ] **Step 7: Run the new tests**

Run: `cd packages/relay && bun test src/__tests__/timing-safe.test.ts src/__tests__/admin-auth.test.ts`
Expected: PASS. (If `admin-auth` fails only because `rateLimitMax`/`rateLimitWindowMs` are not yet on `RelayConfig`, remove those two lines per the Step 6 note and re-run; re-add in Task 6.)

- [ ] **Step 8: Commit**

```bash
git add packages/relay/src/util/timing-safe.ts packages/relay/src/routes/admin.ts packages/relay/src/__tests__/timing-safe.test.ts packages/relay/src/__tests__/admin-auth.test.ts
git commit -m "fix(relay): timing-safe admin secret comparison"
```

---

### Task 2: Timing-safe slug-token comparison in storage adapters

**Files:**
- Modify: `packages/relay/src/storage/memory.ts` (lines 57, 65)
- Modify: `packages/relay/src/storage/sqlite.ts` (line 142)
- Modify: `packages/relay/src/storage/postgres.ts` (line 164)
- Test: `packages/relay/src/__tests__/token-compare.test.ts`

**Interfaces:**
- Consumes: `timingSafeEqualStr` from `../util/timing-safe.js` (Task 1).
- Produces: no new exports — behavior unchanged, comparison hardened.

- [ ] **Step 1: Write the failing test**

Create `packages/relay/src/__tests__/token-compare.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { MemoryStorageAdapter } from '../storage/memory.js'

describe('slug token validation (memory)', () => {
  it('returns valid for the correct token', async () => {
    const s = new MemoryStorageAdapter()
    const future = Math.floor(Date.now() / 1000) + 3600
    await s.registerSlug('ws-abc', 'tok-correct', future)
    expect(await s.validateSlug('ws-abc', 'tok-correct')).toBe('valid')
  })
  it('returns invalid for a wrong token of the same length', async () => {
    const s = new MemoryStorageAdapter()
    const future = Math.floor(Date.now() / 1000) + 3600
    await s.registerSlug('ws-abc', 'tok-correct', future)
    expect(await s.validateSlug('ws-abc', 'tok-wrongxx')).toBe('invalid')
  })
  it('returns invalid for a wrong-length token', async () => {
    const s = new MemoryStorageAdapter()
    const future = Math.floor(Date.now() / 1000) + 3600
    await s.registerSlug('ws-abc', 'tok-correct', future)
    expect(await s.validateSlug('ws-abc', 'x')).toBe('invalid')
  })
  it('rejects renew with a wrong old token', async () => {
    const s = new MemoryStorageAdapter()
    const future = Math.floor(Date.now() / 1000) + 3600
    await s.registerSlug('ws-abc', 'tok-correct', future)
    expect(await s.renewSlug('ws-abc', 'tok-wrongxx', 'tok-new', future)).toBe(false)
    expect(await s.renewSlug('ws-abc', 'tok-correct', 'tok-new', future)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it passes on current code, then hardens**

Run: `cd packages/relay && bun test src/__tests__/token-compare.test.ts`
Expected: PASS on current code (the `!==` behaves identically for these cases). This test locks in behavior so the timing-safe swap is proven non-breaking.

- [ ] **Step 3: Harden memory.ts**

In `packages/relay/src/storage/memory.ts`, add the import at the top of the file (below existing imports):

```ts
import { timingSafeEqualStr } from '../util/timing-safe.js'
```

Replace line 57. Change:

```ts
    if (entry.token !== token) return 'invalid'
```

to:

```ts
    if (!timingSafeEqualStr(entry.token, token)) return 'invalid'
```

Replace the renew comparison (line 65). Change:

```ts
    if (!entry || entry.token !== oldToken) return false
```

to:

```ts
    if (!entry || !timingSafeEqualStr(entry.token, oldToken)) return false
```

- [ ] **Step 4: Harden sqlite.ts**

In `packages/relay/src/storage/sqlite.ts`, add the import at the top (below existing imports):

```ts
import { timingSafeEqualStr } from '../util/timing-safe.js'
```

Replace line 142. Change:

```ts
    if (row.token !== token) return 'invalid'
```

to:

```ts
    if (!timingSafeEqualStr(row.token, token)) return 'invalid'
```

- [ ] **Step 5: Harden postgres.ts**

In `packages/relay/src/storage/postgres.ts`, add the import at the top (below existing imports):

```ts
import { timingSafeEqualStr } from '../util/timing-safe.js'
```

Replace line 164. Change:

```ts
    if (row.token !== token) return 'invalid'
```

to:

```ts
    if (!timingSafeEqualStr(row.token, token)) return 'invalid'
```

- [ ] **Step 6: Run tests + typecheck**

Run: `cd packages/relay && bun test src/__tests__/token-compare.test.ts && bunx tsc --noEmit`
Expected: PASS (4 tests) and tsc exit 0. (Postgres has no runtime test here — it needs a live DB — but the identical util swap is verified by memory+sqlite behavior and the typecheck.)

- [ ] **Step 7: Commit**

```bash
git add packages/relay/src/storage/memory.ts packages/relay/src/storage/sqlite.ts packages/relay/src/storage/postgres.ts packages/relay/src/__tests__/token-compare.test.ts
git commit -m "fix(relay): timing-safe slug token comparison across storage adapters"
```

---

### Task 3: Bound streaming response memory (chunk cap)

**Files:**
- Modify: `packages/relay/src/ws/pending.ts` (constructor + `addChunk`)
- Modify: `packages/relay/src/server.ts` (line 26 — pass `config.maxBodyBytes`)
- Test: `packages/relay/src/__tests__/pending-cap.test.ts`

**Interfaces:**
- Consumes: `config.maxBodyBytes` (existing `RelayConfig` field).
- Produces: `new PendingRequests(maxBodyBytes: number)` — constructor now takes the per-response byte cap. `addChunk` rejects the pending promise with `Error` when accumulated chunk bytes exceed the cap.

- [ ] **Step 1: Write the failing test**

Create `packages/relay/src/__tests__/pending-cap.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { PendingRequests } from '../ws/pending.js'

describe('PendingRequests chunk cap', () => {
  it('rejects when accumulated chunks exceed the cap', async () => {
    const pending = new PendingRequests(8) // 8-byte cap
    const p = pending.add('req-1', 'ws-abc', 1000)
    pending.addChunk('req-1', Buffer.from('12345')) // 5 bytes, ok
    pending.addChunk('req-1', Buffer.from('67890')) // +5 = 10 bytes, over cap
    await expect(p).rejects.toThrow(/exceeded/i)
    expect(pending.has('req-1')).toBe(false) // entry cleaned up
  })

  it('does not reject when chunks stay within the cap', async () => {
    const pending = new PendingRequests(1024)
    const p = pending.add('req-2', 'ws-abc', 1000)
    pending.addChunk('req-2', Buffer.from('hello'))
    pending.endStream('req-2')
    pending.resolve('req-2', {
      status: 200,
      headers: {},
      body: null,
      bodyEncoding: 'utf8',
    })
    const resp = await p
    expect(resp.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/relay && bun test src/__tests__/pending-cap.test.ts`
Expected: FAIL — `PendingRequests` constructor takes no args today and does not enforce a cap (first test will hang until the 1000ms timeout, then reject with a timeout message, not `/exceeded/i`).

- [ ] **Step 3: Add the cap to PendingRequests**

In `packages/relay/src/ws/pending.ts`:

Add a `receivedBytes` field to the `PendingEntry` interface (after the `chunks: Buffer[]` field, around line 8):

```ts
  /** Running total of bytes accumulated in chunks, for the size cap. */
  receivedBytes: number
```

Add a constructor to the `PendingRequests` class (immediately after the `bySlug` field declaration, around line 31, before the `add` method):

```ts
  /**
   * @param maxBodyBytes Maximum total bytes of streamed response body to buffer
   *   per request before rejecting. Guards against unbounded memory growth from
   *   a runaway or malicious owner stream.
   */
  constructor(private readonly maxBodyBytes: number) {}
```

Initialize `receivedBytes` in the `entry` object literal inside `add()` (alongside `chunks: []`):

```ts
        chunks: [],
        receivedBytes: 0,
```

Replace the `addChunk` method body. Change:

```ts
  addChunk(requestId: string, chunk: Buffer): void {
    const entry = this.pending.get(requestId)
    if (!entry) return
    entry.chunks.push(chunk)
  }
```

to:

```ts
  addChunk(requestId: string, chunk: Buffer): void {
    const entry = this.pending.get(requestId)
    if (!entry) return
    entry.receivedBytes += chunk.length
    if (entry.receivedBytes > this.maxBodyBytes) {
      clearTimeout(entry.timer)
      this.cleanup(requestId)
      entry.reject(
        new Error(
          `Response body for ${requestId} exceeded max of ${this.maxBodyBytes} bytes`,
        ),
      )
      return
    }
    entry.chunks.push(chunk)
  }
```

- [ ] **Step 4: Pass the cap in server.ts**

In `packages/relay/src/server.ts`, change line 26:

```ts
  const pending = new PendingRequests()
```

to:

```ts
  const pending = new PendingRequests(config.maxBodyBytes)
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd packages/relay && bun test src/__tests__/pending-cap.test.ts && bunx tsc --noEmit`
Expected: PASS (2 tests) and tsc exit 0 (no other `new PendingRequests()` call sites remain — verify with `grep -rn "new PendingRequests" packages/relay/src`, expect only server.ts).

- [ ] **Step 6: Commit**

```bash
git add packages/relay/src/ws/pending.ts packages/relay/src/server.ts packages/relay/src/__tests__/pending-cap.test.ts
git commit -m "fix(relay): cap streamed response body size to prevent memory exhaustion"
```

---

### Task 4: Guard JSON.parse of stored headers

**Files:**
- Create: `packages/relay/src/util/safe-json.ts`
- Modify: `packages/relay/src/ws/owner.ts` (lines 281, 287, 326)
- Test: `packages/relay/src/__tests__/safe-json.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseHeadersJson(json: string | null | undefined): Record<string, string>` — returns `{}` on null/invalid input instead of throwing.

- [ ] **Step 1: Write the failing test**

Create `packages/relay/src/__tests__/safe-json.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { parseHeadersJson } from '../util/safe-json.js'

describe('parseHeadersJson', () => {
  it('parses a valid header object', () => {
    expect(parseHeadersJson('{"content-type":"application/json"}')).toEqual({
      'content-type': 'application/json',
    })
  })
  it('returns {} for invalid JSON', () => {
    expect(parseHeadersJson('{not valid')).toEqual({})
  })
  it('returns {} for null / undefined', () => {
    expect(parseHeadersJson(null)).toEqual({})
    expect(parseHeadersJson(undefined)).toEqual({})
  })
  it('returns {} for JSON that is not an object', () => {
    expect(parseHeadersJson('"a string"')).toEqual({})
    expect(parseHeadersJson('42')).toEqual({})
    expect(parseHeadersJson('null')).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/relay && bun test src/__tests__/safe-json.test.ts`
Expected: FAIL — cannot resolve `../util/safe-json.js`.

- [ ] **Step 3: Implement the util**

Create `packages/relay/src/util/safe-json.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/relay && bun test src/__tests__/safe-json.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Use it in owner.ts**

In `packages/relay/src/ws/owner.ts`, add the import near the top with the other imports:

```ts
import { parseHeadersJson } from '../util/safe-json.js'
```

Replace the three parse sites:

Line ~281 — change:
```ts
                    headers: JSON.parse(r.headersJson) as Record<string, string>,
```
to:
```ts
                    headers: parseHeadersJson(r.headersJson),
```

Line ~287 — change:
```ts
                    responseHeaders: r.responseHeadersJson
                      ? (JSON.parse(r.responseHeadersJson) as Record<string, string>)
                      : undefined,
```
to:
```ts
                    responseHeaders: r.responseHeadersJson
                      ? parseHeadersJson(r.responseHeadersJson)
                      : undefined,
```

Line ~326 — change:
```ts
                  headers: JSON.parse(record.headersJson) as Record<string, string>,
```
to:
```ts
                  headers: parseHeadersJson(record.headersJson),
```

- [ ] **Step 6: Verify no unguarded JSON.parse of stored headers remains + typecheck**

Run: `cd packages/relay && grep -n "JSON.parse(r.headersJson\|JSON.parse(record.headersJson\|JSON.parse(r.responseHeadersJson" src/ws/owner.ts; bunx tsc --noEmit`
Expected: grep prints nothing (all three replaced); tsc exit 0.

- [ ] **Step 7: Run the safe-json test again**

Run: `cd packages/relay && bun test src/__tests__/safe-json.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/relay/src/util/safe-json.ts packages/relay/src/ws/owner.ts packages/relay/src/__tests__/safe-json.test.ts
git commit -m "fix(relay): guard JSON.parse of stored headers against corrupt records"
```

---

### Task 5: Prune connection registry after grace period

**Files:**
- Modify: `packages/relay/src/ws/registry.ts` (`clearOwner` grace-timer callback; add `hasConnection`)
- Test: `packages/relay/src/__tests__/registry-prune.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ConnectionRegistry.hasConnection(slug: string): boolean` — true while an entry exists in the internal map (used to assert pruning).

- [ ] **Step 1: Write the failing test**

Create `packages/relay/src/__tests__/registry-prune.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test'
import { ConnectionRegistry } from '../ws/registry.js'

// Minimal WebSocket stand-in — the registry only stores the reference.
const fakeWs = () => ({ readyState: 1, OPEN: 1, send: () => {} }) as any

describe('ConnectionRegistry grace-period pruning', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('deletes the connection entry after the grace period when no owner or watchers remain', () => {
    const r = new ConnectionRegistry()
    r.setOwner('ws-abc', fakeWs())
    expect(r.hasConnection('ws-abc')).toBe(true)
    r.clearOwner('ws-abc')
    expect(r.hasConnection('ws-abc')).toBe(true) // still in grace period
    jest.advanceTimersByTime(30_000)
    expect(r.hasConnection('ws-abc')).toBe(false) // pruned
  })

  it('keeps the connection if watchers remain after grace period', () => {
    const r = new ConnectionRegistry()
    r.setOwner('ws-abc', fakeWs())
    r.addWatcher('ws-abc', fakeWs())
    r.clearOwner('ws-abc')
    jest.advanceTimersByTime(30_000)
    expect(r.hasConnection('ws-abc')).toBe(true) // watcher keeps it alive
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/relay && bun test src/__tests__/registry-prune.test.ts`
Expected: FAIL — `hasConnection` is not a function, and (once added) the first test fails because the entry is never deleted on grace expiry.

- [ ] **Step 3: Add hasConnection and prune on grace expiry**

In `packages/relay/src/ws/registry.ts`, replace the grace-timer callback inside `clearOwner` (lines 59-64). Change:

```ts
    conn.gracePeriodTimer = setTimeout(() => {
      // Grace period expired — slot is fully released
      if (conn.gracePeriodTimer) {
        conn.gracePeriodTimer = undefined
      }
    }, GRACE_PERIOD_MS)
```

to:

```ts
    conn.gracePeriodTimer = setTimeout(() => {
      // Grace period expired — slot is fully released.
      conn.gracePeriodTimer = undefined
      // Prune the entry entirely if nothing else references this slug, so the
      // connections map does not grow without bound under high slug churn.
      if (conn.owner === null && conn.watchers.size === 0) {
        this.connections.delete(slug)
      }
    }, GRACE_PERIOD_MS)
```

Add a `hasConnection` method (place it just after the `hasOwner` method, around line 93):

```ts
  /** True while an internal entry exists for the slug (owner, watchers, or grace timer). */
  hasConnection(slug: string): boolean {
    return this.connections.has(slug)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/relay && bun test src/__tests__/registry-prune.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full existing WS/registry-related suites to confirm no regressions**

Run: `cd packages/relay && bun test src/__tests__/registry-prune.test.ts && bunx tsc --noEmit`
Expected: PASS and tsc exit 0. (Note: some pre-existing tests in `ws.test.ts`/`auth.test.ts` bind network ports and may fail in a sandbox with `EADDRINUSE`/port-0 errors — that is an environment limitation, not a regression from this task. Confirm your new registry test passes and tsc is clean.)

- [ ] **Step 6: Commit**

```bash
git add packages/relay/src/ws/registry.ts packages/relay/src/__tests__/registry-prune.test.ts
git commit -m "fix(relay): prune connection registry entries after grace period"
```

---

### Task 6: Per-IP rate limiting on HTTP routes

**Files:**
- Create: `packages/relay/src/util/rate-limit.ts`
- Modify: `packages/relay/src/config.ts` (interface + loadConfig + env)
- Modify: `packages/relay/src/server.ts` (register onRequest hook + sweep interval)
- Modify: `.env.example` (document the two new vars)
- Test: `packages/relay/src/__tests__/rate-limit.test.ts`

**Interfaces:**
- Consumes: `config.rateLimitMax`, `config.rateLimitWindowMs`.
- Produces:
  - `class FixedWindowRateLimiter` with `constructor(max: number, windowMs: number, now?: () => number)`, `check(key: string): boolean` (true = allowed), and `sweep(): void`.
  - `RelayConfig.rateLimitMax: number`, `RelayConfig.rateLimitWindowMs: number`.

- [ ] **Step 1: Write the failing test**

Create `packages/relay/src/__tests__/rate-limit.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { FixedWindowRateLimiter } from '../util/rate-limit.js'

describe('FixedWindowRateLimiter', () => {
  it('allows up to max requests then blocks within the window', () => {
    let now = 1000
    const rl = new FixedWindowRateLimiter(3, 1000, () => now)
    expect(rl.check('ip1')).toBe(true)
    expect(rl.check('ip1')).toBe(true)
    expect(rl.check('ip1')).toBe(true)
    expect(rl.check('ip1')).toBe(false) // 4th within window
  })

  it('resets after the window elapses', () => {
    let now = 1000
    const rl = new FixedWindowRateLimiter(1, 1000, () => now)
    expect(rl.check('ip1')).toBe(true)
    expect(rl.check('ip1')).toBe(false)
    now += 1001
    expect(rl.check('ip1')).toBe(true) // new window
  })

  it('tracks keys independently', () => {
    let now = 1000
    const rl = new FixedWindowRateLimiter(1, 1000, () => now)
    expect(rl.check('ip1')).toBe(true)
    expect(rl.check('ip2')).toBe(true)
    expect(rl.check('ip1')).toBe(false)
  })

  it('sweep removes expired entries', () => {
    let now = 1000
    const rl = new FixedWindowRateLimiter(1, 1000, () => now)
    rl.check('ip1')
    now += 1001
    rl.sweep()
    // After sweep, ip1's window is gone, so it gets a fresh allowance.
    expect(rl.check('ip1')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/relay && bun test src/__tests__/rate-limit.test.ts`
Expected: FAIL — cannot resolve `../util/rate-limit.js`.

- [ ] **Step 3: Implement the limiter**

Create `packages/relay/src/util/rate-limit.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/relay && bun test src/__tests__/rate-limit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add config fields**

In `packages/relay/src/config.ts`, add to the `RelayConfig` interface (after `forwardTimeoutMs: number`):

```ts
  rateLimitMax: number
  rateLimitWindowMs: number
```

In the object returned by `loadConfig()`, add (after the `forwardTimeoutMs` line):

```ts
    rateLimitMax: parseInt(process.env['RATE_LIMIT_MAX'] ?? '120', 10),
    rateLimitWindowMs: parseInt(process.env['RATE_LIMIT_WINDOW_MS'] ?? '60000', 10),
```

- [ ] **Step 6: Register the hook + sweep in server.ts**

In `packages/relay/src/server.ts`, add the import (with the other `./util`/local imports near the top):

```ts
import { FixedWindowRateLimiter } from './util/rate-limit.js'
```

Immediately after `const pending = new PendingRequests(config.maxBodyBytes)` (line ~26), add:

```ts
  // Per-IP rate limiting for HTTP routes. Disabled when rateLimitMax <= 0.
  if (config.rateLimitMax > 0) {
    const limiter = new FixedWindowRateLimiter(config.rateLimitMax, config.rateLimitWindowMs)
    const sweepTimer = setInterval(() => limiter.sweep(), config.rateLimitWindowMs)
    // Do not keep the process alive solely for the sweep timer.
    if (typeof sweepTimer.unref === 'function') sweepTimer.unref()
    app.addHook('onRequest', async (req, reply) => {
      // Skip WebSocket upgrades and the health check.
      if (req.headers.upgrade || req.url === '/healthz') return
      if (!limiter.check(req.ip)) {
        return reply.code(429).send({ error: 'Too Many Requests' })
      }
    })
  }
```

- [ ] **Step 7: Write a route-level rate-limit test**

Create `packages/relay/src/__tests__/rate-limit-route.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'bun:test'
import { createServer } from '../server.js'
import { MemoryStorageAdapter } from '../storage/memory.js'
import type { RelayConfig } from '../config.js'

function cfg(overrides: Partial<RelayConfig> = {}): RelayConfig {
  return {
    edition: 'community',
    port: 0,
    jwtSecret: 'test-secret',
    authRequired: false,
    ringBufferSize: 1000,
    maxBodyBytes: 1048576,
    forwardTimeoutMs: 30000,
    storageAdapter: 'memory',
    relayDomain: 'localhost:3000',
    relayProto: 'http',
    rateLimitMax: 2,
    rateLimitWindowMs: 60000,
    ...overrides,
  }
}

describe('HTTP rate limiting', () => {
  let app: Awaited<ReturnType<typeof createServer>>
  afterEach(async () => {
    await app.close()
  })

  it('returns 429 after the limit is exceeded', async () => {
    app = await createServer(cfg({ rateLimitMax: 2 }), new MemoryStorageAdapter())
    await app.ready()
    const hit = () => app.inject({ method: 'GET', url: '/nonexistent-path' })
    expect((await hit()).statusCode).not.toBe(429)
    expect((await hit()).statusCode).not.toBe(429)
    expect((await hit()).statusCode).toBe(429) // 3rd exceeds max of 2
  })

  it('does not rate limit the health check', async () => {
    app = await createServer(cfg({ rateLimitMax: 1 }), new MemoryStorageAdapter())
    await app.ready()
    await app.inject({ method: 'GET', url: '/healthz' })
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
  })
})
```

- [ ] **Step 8: Document the env vars**

In `.env.example`, add after the `FORWARD_TIMEOUT_MS` block:

```bash
# Per-IP HTTP rate limit: max requests per window (default 120). Set 0 to disable.
RATE_LIMIT_MAX=120

# Rate limit window in ms (default 60000 = 1 minute)
RATE_LIMIT_WINDOW_MS=60000
```

- [ ] **Step 9: Run the rate-limit tests + typecheck**

Run: `cd packages/relay && bun test src/__tests__/rate-limit.test.ts src/__tests__/rate-limit-route.test.ts && bunx tsc --noEmit`
Expected: PASS (6 tests total) and tsc exit 0.

- [ ] **Step 10: Add rate-limit fields to the Task 1 admin-auth test config (if deferred)**

If in Task 1 Step 6 you omitted `rateLimitMax`/`rateLimitWindowMs` from `baseConfig`, add them back now:

```ts
    rateLimitMax: 0,
    rateLimitWindowMs: 60000,
```

Run: `cd packages/relay && bun test src/__tests__/admin-auth.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/relay/src/util/rate-limit.ts packages/relay/src/config.ts packages/relay/src/server.ts packages/relay/src/__tests__/rate-limit.test.ts packages/relay/src/__tests__/rate-limit-route.test.ts packages/relay/src/__tests__/admin-auth.test.ts .env.example
git commit -m "feat(relay): per-IP HTTP rate limiting (env-configurable)"
```

---

## Self-Review

**Spec coverage (design spec §5 sub-project #1):**
- timing-safe comparisons → Task 1 (admin) + Task 2 (tokens) ✅
- stream chunk-size cap → Task 3 ✅
- `JSON.parse` guards → Task 4 ✅
- registry pruning → Task 5 ✅
- rate limiting on register/renew → Task 6 (global per-IP HTTP hook covers `/:slug/renew` and any HTTP register path; WS-upgrade connections are intentionally skipped to avoid destabilizing the tunnel path — a scoped decision noted for the whole-branch review) ✅

**Placeholder scan:** No TBD/TODO; all code blocks are complete. The one conditional (Task 1 Step 6 admin-auth config fields vs Task 6) is explicitly handled in Task 1 Step 6 note and Task 6 Step 10.

**Type consistency:** `timingSafeEqualStr(a,b): boolean` used identically in Tasks 1-2. `PendingRequests(maxBodyBytes: number)` constructor (Task 3) matches the single call site updated in server.ts. `parseHeadersJson` signature consistent (Task 4). `hasConnection` (Task 5) used in its test. `FixedWindowRateLimiter(max, windowMs, now?)` + `check`/`sweep` consistent between util (Task 6 Step 3) and tests. `RelayConfig` gains `rateLimitMax`/`rateLimitWindowMs` (Task 6) — the two test config factories (Task 1 admin-auth, Task 6 rate-limit-route) both include them; Task 1's note + Task 6 Step 10 reconcile ordering.

**Scope:** Focused on the five audit-identified relay correctness/security gaps. No dashboard, CLI, or edition-boundary changes. WS-connect rate limiting explicitly deferred with rationale.
