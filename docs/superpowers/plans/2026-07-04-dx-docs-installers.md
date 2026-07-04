# DX, Docs & Installers Implementation Plan (sub-project #3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove first-run and troubleshooting friction from the CLI, VS Code extension, installers, and docs so a new user gets from install to first forwarded request without hitting undocumented walls.

**Architecture:** Small, focused edits to the existing CLI (`packages/cli`), VS Code extension manifest, installer shell scripts, release workflow, and README. Centralize the duplicated default-URL constants into `config.ts` (single source, still env-overridable). No new npm dependencies; `dotenv` is already a CLI dependency.

**Tech Stack:** Bun + TypeScript 6, Ink TUI, `ws`, GitHub Actions, bash + PowerShell installers. Tests use `bun:test`.

## Global Constraints

- No new npm dependencies (sandbox blocks the registry). `dotenv` + `dotenv-expand` are already in `packages/cli/package.json`.
- Nothing environment-specific hardcoded in scattered places — default relay/dashboard URLs live once in `config.ts` and remain overridable via `--flag` / env / global config. From project rule "no-hardcoded-config". The SaaS default is retained (it is the public product's default) but centralized.
- Preserve existing behavior and tests; add tests, don't weaken them.
- Follow existing patterns: ESM `.js` import specifiers (NodeNext); `bun test`; commands live under `packages/cli/src/commands/`.
- Dashboard-specific self-hosting docs are OUT OF SCOPE here (they depend on sub-project #2). This plan documents the CLI + relay self-host paths and troubleshooting only.

---

### Task 1: Load .env in the CLI

**Files:**
- Create: `packages/cli/src/env.ts`
- Modify: `packages/cli/src/index.ts` (top of file)
- Test: `packages/cli/src/__tests__/env.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadDotenv(cwd?: string): void` — loads `<cwd>/.env` into `process.env` (does not override already-set vars).

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/__tests__/env.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun test src/__tests__/env.test.ts`
Expected: FAIL — cannot resolve `../env.js`.

- [ ] **Step 3: Implement loadDotenv**

Create `packages/cli/src/env.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun test src/__tests__/env.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Call it at CLI startup**

In `packages/cli/src/index.ts`, add after the existing imports (after line 3):

```ts
import { loadDotenv } from './env.js'
```

At the very start of the `main()` function body (before `const argv = ...`), add:

```ts
  loadDotenv()
```

- [ ] **Step 6: Typecheck**

Run: `cd packages/cli && bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/env.ts packages/cli/src/index.ts packages/cli/src/__tests__/env.test.ts
git commit -m "feat(cli): load .env at startup (does not override shell vars)"
```

---

### Task 2: Centralize the default relay/dashboard URLs

**Files:**
- Modify: `packages/cli/src/config.ts` (add exported constants + `isDefaultRelayHost`)
- Modify: `packages/cli/src/commands/start.ts`, `history.ts`, `replay.ts`, `diff.ts`, `token.ts`, `auth.ts`
- Test: `packages/cli/src/__tests__/default-urls.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (from `config.ts`):
  - `export const DEFAULT_RELAY_WS_URL = 'wss://relay.conduitrelay.com'`
  - `export const DEFAULT_RELAY_HTTP_URL = 'https://relay.conduitrelay.com'`
  - `export const DEFAULT_DASHBOARD_URL = 'https://app.conduitrelay.com'`
  - `export function isDefaultRelayHost(url: string): boolean` — true when the URL points at the default SaaS relay host.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/__tests__/default-urls.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import {
  DEFAULT_RELAY_WS_URL,
  DEFAULT_RELAY_HTTP_URL,
  DEFAULT_DASHBOARD_URL,
  isDefaultRelayHost,
} from '../config.js'

describe('default URL constants', () => {
  it('exposes the SaaS defaults', () => {
    expect(DEFAULT_RELAY_WS_URL).toBe('wss://relay.conduitrelay.com')
    expect(DEFAULT_RELAY_HTTP_URL).toBe('https://relay.conduitrelay.com')
    expect(DEFAULT_DASHBOARD_URL).toBe('https://app.conduitrelay.com')
  })

  it('isDefaultRelayHost matches the SaaS relay host, ws or https', () => {
    expect(isDefaultRelayHost('wss://relay.conduitrelay.com')).toBe(true)
    expect(isDefaultRelayHost('https://relay.conduitrelay.com/x')).toBe(true)
    expect(isDefaultRelayHost('wss://relay.mycompany.com')).toBe(false)
    expect(isDefaultRelayHost('')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun test src/__tests__/default-urls.test.ts`
Expected: FAIL — the constants/function are not exported yet.

- [ ] **Step 3: Add the constants + helper to config.ts**

In `packages/cli/src/config.ts`, add near the top (after the imports, before other exports):

```ts
/** Default SaaS relay WebSocket URL (public product default; override via CONDUIT_RELAY_URL). */
export const DEFAULT_RELAY_WS_URL = 'wss://relay.conduitrelay.com'
/** Default SaaS relay HTTP base (for REST calls like renew). */
export const DEFAULT_RELAY_HTTP_URL = 'https://relay.conduitrelay.com'
/** Default SaaS dashboard URL used for login. */
export const DEFAULT_DASHBOARD_URL = 'https://app.conduitrelay.com'

/** Host portion of the default SaaS relay, e.g. "relay.conduitrelay.com". */
const DEFAULT_RELAY_HOST = 'relay.conduitrelay.com'

/** True when the given URL targets the default SaaS relay host (ws:// or https://). */
export function isDefaultRelayHost(url: string): boolean {
  if (!url) return false
  try {
    return new URL(url).host === DEFAULT_RELAY_HOST
  } catch {
    return false
  }
}
```

Update the two existing resolver defaults to reference the constants. In `getRelayUrl()` change the fallback literal `'wss://relay.conduitrelay.com'` to `DEFAULT_RELAY_WS_URL`; in `getDashboardUrl()` change `'https://app.conduitrelay.com'` to `DEFAULT_DASHBOARD_URL`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun test src/__tests__/default-urls.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Replace the duplicated constants in each command**

In each of these files, delete the local `const DEFAULT_RELAY = ...` line and import the shared constant instead, then update the reference.

`packages/cli/src/commands/history.ts` — remove `const DEFAULT_RELAY = 'wss://relay.conduitrelay.com'`; add to the config import `DEFAULT_RELAY_WS_URL`; change `?? DEFAULT_RELAY` to `?? DEFAULT_RELAY_WS_URL`.

`packages/cli/src/commands/replay.ts` — same as history.ts (WS URL).

`packages/cli/src/commands/diff.ts` — same as history.ts (WS URL).

`packages/cli/src/commands/token.ts` — remove `const DEFAULT_RELAY = 'https://relay.conduitrelay.com'`; import `DEFAULT_RELAY_HTTP_URL`; change `?? DEFAULT_RELAY` to `?? DEFAULT_RELAY_HTTP_URL`.

`packages/cli/src/commands/auth.ts` — same as token.ts (HTTP URL).

`packages/cli/src/commands/start.ts` — remove `const DEFAULT_RELAY = 'wss://relay.conduitrelay.com'`; import `DEFAULT_RELAY_WS_URL` (and `isDefaultRelayHost` for Task 3). Change both `?? DEFAULT_RELAY` and `entry.relayUrl = DEFAULT_RELAY` to use `DEFAULT_RELAY_WS_URL`.

(Each command already imports from `'../config.js'`; add the names to the existing import statement rather than adding a second import.)

- [ ] **Step 6: Verify no local default-URL constants remain + typecheck**

Run: `cd packages/cli && grep -rn "const DEFAULT_RELAY " src/commands; bunx tsc --noEmit`
Expected: grep prints nothing; tsc exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/config.ts packages/cli/src/commands
git commit -m "refactor(cli): centralize default relay/dashboard URLs in config"
```

---

### Task 3: Actionable "not logged in" guidance on start

**Files:**
- Modify: `packages/cli/src/commands/start.ts` (production-relay login gate)
- Test: `packages/cli/src/__tests__/start-guard.test.ts`

**Interfaces:**
- Consumes: `isDefaultRelayHost` from `../config.js` (Task 2).
- Produces: `export function loginRequiredMessage(relayUrl: string): string` (exported from `start.ts`) — the actionable message shown when login is required.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/__tests__/start-guard.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { loginRequiredMessage } from '../commands/start.js'

describe('loginRequiredMessage', () => {
  it('names the login command and the relay', () => {
    const msg = loginRequiredMessage('wss://relay.conduitrelay.com')
    expect(msg).toContain('conduit login')
    expect(msg).toContain('relay.conduitrelay.com')
  })
  it('mentions the self-host escape hatch', () => {
    const msg = loginRequiredMessage('wss://relay.conduitrelay.com')
    expect(msg).toMatch(/CONDUIT_RELAY_URL|self-host/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun test src/__tests__/start-guard.test.ts`
Expected: FAIL — `loginRequiredMessage` is not exported.

- [ ] **Step 3: Add the message helper and use it**

In `packages/cli/src/commands/start.ts`, add an exported helper near the top (after imports):

```ts
export function loginRequiredMessage(relayUrl: string): string {
  return [
    `Not logged in to ${relayUrl}.`,
    '',
    '  Run `conduit login` to authenticate with the hosted relay.',
    '',
    '  Self-hosting your own relay? Point the CLI at it and no login is needed:',
    '    export CONDUIT_RELAY_URL=wss://relay.yourdomain.com',
  ].join('\n')
}
```

Replace the existing gate. Change:

```ts
  const isProductionRelay = effectiveRelay.includes('conduitrelay.com')
  if (isProductionRelay && !userToken) {
    console.error('Not logged in. Run `conduit login` to authenticate.')
    process.exit(1)
  }
```

to:

```ts
  const isProductionRelay = isDefaultRelayHost(effectiveRelay)
  if (isProductionRelay && !userToken) {
    console.error(loginRequiredMessage(effectiveRelay))
    process.exit(1)
  }
```

(The `isDefaultRelayHost` import was added to start.ts in Task 2 Step 5. If not present, add it to the `'../config.js'` import.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun test src/__tests__/start-guard.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `cd packages/cli && bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/start.ts packages/cli/src/__tests__/start-guard.test.ts
git commit -m "feat(cli): actionable not-logged-in guidance with self-host hint"
```

---

### Task 4: Actionable local-server + relay connection errors

**Files:**
- Modify: `packages/cli/src/ws/forwarder.ts` (`buildErrorResponse` + the two connect-failure paths)
- Modify: `packages/cli/src/ws/client.ts` (surface socket errors via `onError`)
- Test: `packages/cli/src/__tests__/forwarder-errors.test.ts`

**Interfaces:**
- Consumes: `ClientEvents.onError(code, message)` (existing).
- Produces:
  - `buildErrorResponse(requestId, status, headers, durationMs, message?)` — optional plain-text body written as the response body.
  - `export function relayUnreachableMessage(relayUrl: string): string` (from `client.ts`).

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/__tests__/forwarder-errors.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { relayUnreachableMessage } from '../ws/client.js'

describe('relayUnreachableMessage', () => {
  it('names the relay URL and a next step', () => {
    const msg = relayUnreachableMessage('wss://relay.example.com')
    expect(msg).toContain('relay.example.com')
    expect(msg).toMatch(/reach|connect|running/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun test src/__tests__/forwarder-errors.test.ts`
Expected: FAIL — `relayUnreachableMessage` not exported.

- [ ] **Step 3: Add an actionable body to forwarder error responses**

In `packages/cli/src/ws/forwarder.ts`, change the `buildErrorResponse` signature and body:

```ts
function buildErrorResponse(
  requestId: string,
  status: number,
  headers: Record<string, string>,
  durationMs: number,
  message?: string,
): ForwardResponse {
  const hasBody = typeof message === 'string' && message.length > 0
  return {
    type: 'response',
    requestId,
    status,
    headers: hasBody ? { ...headers, 'content-type': 'text/plain; charset=utf-8' } : headers,
    body: hasBody ? Buffer.from(message, 'utf8').toString('base64') : null,
    bodyEncoding: hasBody ? 'base64' : 'utf8',
    bodyTruncated: false,
    durationMs,
  }
}
```

Update the three connect-failure return sites to pass a message. The AbortError (timeout) path:

```ts
      if (error.name === 'AbortError') {
        return buildErrorResponse(requestId, 504, {}, durationMs, 'Conduit: your local server did not respond in time (timeout).')
      }
```

The `ECONNREFUSED` path:

```ts
        return buildErrorResponse(requestId, 502, {}, 0, `Conduit: cannot reach your local server at ${url}. Is it running?`)
```

The generic connection-error path (the `return buildErrorResponse(requestId, 502, {}, durationMs)` immediately after the ECONNREFUSED block):

```ts
      return buildErrorResponse(requestId, 502, {}, durationMs, `Conduit: failed to reach your local server at ${url}.`)
```

(Leave the unrelated `buildErrorResponse(requestId, 502, {}, durationMs)` at the very end of the file — line ~166 — unchanged; it is a different failure path.)

- [ ] **Step 4: Surface relay connection errors in client.ts**

In `packages/cli/src/ws/client.ts`, add the exported helper near the top (after imports):

```ts
export function relayUnreachableMessage(relayUrl: string): string {
  return `Cannot reach the relay at ${relayUrl}. Check that it is running and that CONDUIT_RELAY_URL is correct.`
}
```

Add a field to track whether a connection ever succeeded. In the class body near the other private fields (e.g. after `private closed = false`), add:

```ts
  private everConnected = false
```

Set it where a successful registration happens — in `_handleMessage`, inside the `case 'registered':` handler, add `this.everConnected = true` as the first line.

Replace the empty error handler. Change:

```ts
    ws.on('error', () => {
      // Error event always precedes close; let close handle reconnect
    })
```

to:

```ts
    ws.on('error', () => {
      // The 'close' handler drives reconnect. On the very first failed
      // connection (before we ever registered), surface an actionable reason
      // so the user isn't left with a silent "Disconnected".
      if (!this.everConnected) {
        this.events.onError('CONNECTION', relayUnreachableMessage(this.relayUrl))
      }
    })
```

- [ ] **Step 5: Run test to verify it passes + typecheck**

Run: `cd packages/cli && bun test src/__tests__/forwarder-errors.test.ts && bunx tsc --noEmit`
Expected: PASS (1 test) and tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/ws/forwarder.ts packages/cli/src/ws/client.ts packages/cli/src/__tests__/forwarder-errors.test.ts
git commit -m "feat(cli): actionable errors for local-server and relay connection failures"
```

---

### Task 5: Fix README quickstart & CLI reference

**Files:**
- Modify: `README.md` (CLI Reference block + quickstart flow)

**Interfaces:**
- Consumes: nothing.
- Produces: corrected docs (no code).

- [ ] **Step 1: Correct the CLI Reference block**

In `README.md`, in the `## CLI Reference` fenced block, change the `conduit auth` line to the login/logout commands so it matches the actual CLI:

```
conduit start               Start the tunnel and open the TUI dashboard
conduit login               Log in to the hosted relay (opens browser)
conduit logout              Log out and clear stored credentials
conduit diff <id1> <id2>    Field-level diff between two requests in the ring buffer
conduit history             List recent requests (default: last 50)
conduit replay <id>         Replay a stored request
conduit token refresh       Refresh your slug token before it expires
```

- [ ] **Step 2: Add a login-first note to the CLI quickstart**

In `README.md`, find the `### CLI` quickstart section (the numbered steps under Quickstart). Ensure step 1 is logging in. Add this line as the first step of the CLI quickstart (renumber the following steps):

```markdown
1. **Log in** (hosted relay only): `conduit login`. Self-hosting your own relay? Skip this and set `CONDUIT_RELAY_URL` instead (see Self-Hosting).
```

- [ ] **Step 3: Note the legacy alias**

Immediately after the CLI Reference fenced block, add:

```markdown
> `conduit auth` is a deprecated alias for `conduit login` and still works.
```

- [ ] **Step 4: Verify the README no longer presents `conduit auth` as the primary command**

Run: `grep -n "conduit auth" README.md`
Expected: the only remaining match is the deprecation note added in Step 3.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: fix CLI reference (login vs auth) and login-first quickstart"
```

---

### Task 6: Add a Troubleshooting section to the README

**Files:**
- Modify: `README.md` (new `## Troubleshooting` section)

**Interfaces:**
- Consumes: nothing.
- Produces: docs (no code).

- [ ] **Step 1: Add the section**

In `README.md`, add a `## Troubleshooting` section before `## Self-Hosting` (or before `## Editions & License` if that reads better) with these entries:

```markdown
## Troubleshooting

**"Not logged in" when running `conduit start`.** The hosted relay requires a login.
Run `conduit login`. If you self-host, set `CONDUIT_RELAY_URL=wss://relay.yourdomain.com`
(no login required when `RELAY_AUTH_REQUIRED=false` or a registration token is configured).

**"Cannot reach the relay at …".** The relay URL is unreachable. Confirm the relay is
running, the URL/scheme is correct (`wss://` for TLS), and that `CONDUIT_RELAY_URL` points
at your deployment. Network proxies and firewalls can block WebSocket upgrades.

**Requests return 502 / "cannot reach your local server".** Your local app isn't
listening on the forwarded port. Start it, or pass the right port: `conduit start --port <port>`.

**Requests return 504.** Your local server accepted the connection but didn't respond in
time. Check for a hung handler; the relay's forward timeout is `FORWARD_TIMEOUT_MS`.

**Invalid or expired token.** Slug tokens expire and are invalidated if the relay's
`CONDUIT_JWT_SECRET` is rotated. Run `conduit token refresh`; if that fails, re-run
`conduit login` (hosted) or re-register against your self-hosted relay.

**Reset a workspace's slug.** Delete the workspace entry from `~/.conduit/projects.json`
(keyed by workspace path). The next `conduit start` generates a fresh slug.
```

- [ ] **Step 2: Verify the section renders and links resolve**

Run: `grep -n "## Troubleshooting" README.md`
Expected: prints the new heading line.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Troubleshooting section"
```

---

### Task 7: VS Code activation on-demand + honest auto-connect docs

**Files:**
- Modify: `packages/vscode-ext/package.json` (`activationEvents`)
- Modify: `packages/vscode-ext/README.md` (auto-connect wording)

**Interfaces:**
- Consumes: nothing.
- Produces: manifest + docs change (no TS logic change).

- [ ] **Step 1: Scope activation to the view and a project marker**

In `packages/vscode-ext/package.json`, change:

```json
  "activationEvents": ["onStartupFinished"],
```

to:

```json
  "activationEvents": ["onView:conduit.requests", "workspaceContains:**/.conduit"],
```

- [ ] **Step 2: Confirm the view id exists**

Run: `grep -n "conduit.requests" packages/vscode-ext/package.json`
Expected: at least one match under `contributes.views` (the view the activation now targets). If the view id differs, use the actual id from `contributes.views` in Step 1 instead.

- [ ] **Step 3: Align the README wording with the real default**

In `packages/vscode-ext/README.md`, replace any claim that the extension "auto-connects" on open with wording that matches the `conduit.autoConnect` default of `false`. Use:

```markdown
Open the Conduit panel from the Activity Bar to connect. Enable
`"conduit.autoConnect": true` in settings if you want it to connect automatically
when you open a workspace.
```

- [ ] **Step 4: Verify**

Run: `grep -n "onStartupFinished" packages/vscode-ext/package.json; grep -in "auto-connect\|autoConnect" packages/vscode-ext/README.md`
Expected: no `onStartupFinished` match remains; README mentions auto-connect only in the corrected, opt-in form.

- [ ] **Step 5: Commit**

```bash
git add packages/vscode-ext/package.json packages/vscode-ext/README.md
git commit -m "fix(vscode): activate on-demand and correct auto-connect docs"
```

---

### Task 8: Installer checksum verification

**Files:**
- Modify: `.github/workflows/release.yml` (publish a `SHA256SUMS` file)
- Modify: `installer/install.sh` (verify before install)
- Modify: `installer/install.ps1` (verify before install)

**Interfaces:**
- Consumes: the release assets (`conduit-<platform>` binaries).
- Produces: a `SHA256SUMS` release asset and checksum verification in both installers.

- [ ] **Step 1: Publish SHA256SUMS in the release workflow**

In `.github/workflows/release.yml`, in the job that collects `dist/` and runs `softprops/action-gh-release@v2` (the step with `path: dist/` at line ~260 and `files: dist/**/*` at ~266), add a step BEFORE the release step that generates checksums over the collected binaries:

```yaml
      - name: Generate SHA256SUMS
        run: |
          cd dist
          find . -type f ! -name 'SHA256SUMS' -exec sha256sum {} \; | sed 's| \./| |' > SHA256SUMS
          cat SHA256SUMS
```

(`files: dist/**/*` already uploads everything in `dist/`, so `SHA256SUMS` is included automatically.)

- [ ] **Step 2: Verify the checksum in install.sh**

In `installer/install.sh`, replace the download + "verify binary runs" block (lines 36-45, from the `URL=` line through the `fi` after the `--version` check) with:

```bash
URL="https://github.com/${REPO}/releases/download/${TAG}/${BINARY}-${PLATFORM}"
SUMS_URL="https://github.com/${REPO}/releases/download/${TAG}/SHA256SUMS"
echo "Downloading ${BINARY} ${TAG} for ${PLATFORM}..."
curl -fsSL -o "/tmp/${BINARY}" "$URL"

# Verify SHA256 against the published SHA256SUMS
echo "Verifying checksum..."
EXPECTED=$(curl -fsSL "$SUMS_URL" | grep " ${BINARY}-${PLATFORM}$" | awk '{print $1}')
if [ -z "$EXPECTED" ]; then
  echo "Could not find a checksum for ${BINARY}-${PLATFORM} in SHA256SUMS" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL=$(sha256sum "/tmp/${BINARY}" | awk '{print $1}')
else
  ACTUAL=$(shasum -a 256 "/tmp/${BINARY}" | awk '{print $1}')
fi
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum mismatch! expected ${EXPECTED}, got ${ACTUAL}" >&2
  rm -f "/tmp/${BINARY}"
  exit 1
fi
chmod +x "/tmp/${BINARY}"
```

(macOS ships `shasum`, Linux ships `sha256sum`; the branch handles both. This replaces the run-the-binary check with a cryptographic one.)

- [ ] **Step 3: Syntax-check install.sh**

Run: `bash -n installer/install.sh`
Expected: exit 0 (no output).

- [ ] **Step 4: Verify the checksum in install.ps1**

In `installer/install.ps1`, after the binary is downloaded to its temp path and before it is moved into place, add checksum verification. Insert (adjust the variable names to match the script's existing download path variable):

```powershell
$sumsUrl = "https://github.com/$Repo/releases/download/$Tag/SHA256SUMS"
Write-Host "Verifying checksum..."
$sums = (Invoke-WebRequest -UseBasicParsing -Uri $sumsUrl).Content
$assetName = "$Binary-$Platform"
$expected = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($assetName) + '$' } | ForEach-Object { ($_ -split '\s+')[0] })
if (-not $expected) { Write-Error "No checksum for $assetName in SHA256SUMS"; exit 1 }
$actual = (Get-FileHash -Algorithm SHA256 -Path $tmpPath).Hash.ToLower()
if ($expected.ToLower() -ne $actual) { Remove-Item $tmpPath -Force; Write-Error "Checksum mismatch for $assetName"; exit 1 }
```

Read `installer/install.ps1` first and match `$Repo`, `$Tag`, `$Binary`, `$Platform`, and the temp download path variable (`$tmpPath` above) to the names the script actually uses. If the script uses different names, adapt this snippet to them rather than introducing new ones.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml installer/install.sh installer/install.ps1
git commit -m "feat(installers): verify SHA256 checksums against published SHA256SUMS"
```

---

## Self-Review

**Spec coverage (design spec §5 sub-project #3):**
- README quickstart fixed (login step, `login` vs `auth`) → Tasks 5 ✅
- Load dotenv → Task 1 ✅
- Actionable relay-unreachable / local-server-down errors → Task 4 ✅
- Startup connectivity guidance (suggest CONDUIT_RELAY_URL) → Task 3 (login gate) + Task 4 (connection error) ✅
- Installer checksums → Task 8 ✅
- VS Code activation on-demand → Task 7 ✅
- Troubleshooting guide → Task 6 ✅
- Self-hosting-the-dashboard guide → DEFERRED (depends on #2), called out in Global Constraints. Not a gap for #3.
- Bonus: centralize duplicated default URLs (no-hardcode rule) → Task 2 ✅

**Placeholder scan:** No TBD/TODO. Task 4 and Task 8 Step 4 instruct reading the target file to match existing identifiers before editing — these are grounding instructions, not placeholders (the code to insert is fully specified).

**Type consistency:** `DEFAULT_RELAY_WS_URL`/`DEFAULT_RELAY_HTTP_URL`/`DEFAULT_DASHBOARD_URL`/`isDefaultRelayHost` defined in Task 2 are consumed with identical names in Tasks 2/3. `loginRequiredMessage` (Task 3), `relayUnreachableMessage` (Task 4), `loadDotenv` (Task 1), and the extended `buildErrorResponse(…, message?)` (Task 4) are each defined and used consistently. `ClientEvents.onError(code, message)` matches the existing interface.

**Scope:** CLI/installer/VS Code/docs DX only. No new dependencies. No dashboard, relay-protocol, or edition-boundary changes. Dashboard self-host docs deferred to after #2.
