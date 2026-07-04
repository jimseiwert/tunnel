# Edition Boundary + FSL License Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the community/cloud edition boundary (build-time flag + private submodule seam + CI-enforced import boundary) and add the FSL license, so Conduit is self-hostable while SaaS-only code has a home that can't leak into the community build.

**Architecture:** A canonical `EDITION` resolver lives in `packages/types` and is consumed by the relay (and, via a workspace dep, the dashboard). SaaS-only code lives under `packages/cloud`, wired as a private git submodule; the community build compiles and runs with that directory absent. A `dependency-cruiser` rule run in CI forbids any core package from importing `packages/cloud`. The public repo carries an FSL `LICENSE`.

**Tech Stack:** Bun + TypeScript 6 monorepo, Fastify relay, Next.js 16 dashboard, `dependency-cruiser` for boundary lint, GitHub Actions CI.

## Global Constraints

- Edition values are exactly `community` and `cloud`; unset/unknown resolves to `community` (safe default). Copied from spec §3.
- Community packages (`relay`, `cli`, `vscode-ext`, `types`) and `apps/dashboard` MUST NOT import from `packages/cloud`; `cloud` MAY import from core. From spec §3.
- Community build MUST compile and run with `packages/cloud` absent (submodule uninitialized). From spec §3 + §6.
- License is FSL-1.1-Apache-2.0 (converts to Apache 2.0 two years per release). Licensor: Jim Seiwert. From spec §2.
- Follow existing patterns: workspace deps use `"*"`; tests use `bun test`; `packages/types` is the shared home for cross-package runtime.

---

### Task 1: FSL LICENSE + README editions section

**Files:**
- Create: `LICENSE`
- Modify: `README.md` (add an "Editions & License" section near the end, before any existing footer)

**Interfaces:**
- Consumes: nothing.
- Produces: a repo-root `LICENSE` file (referenced by the existing README license badge at `README.md:9`).

- [ ] **Step 1: Create the FSL license file**

Create `LICENSE` with the official FSL-1.1-Apache-2.0 text:

```text
# Functional Source License, Version 1.1, Apache 2.0 Future License

## Abbreviation

FSL-1.1-Apache-2.0

## Notice

Copyright 2026 Jim Seiwert

## Terms and Conditions

### Licensor ("We")

The party offering the Software under these Terms and Conditions.

### The Software

The "Software" is each version of the software that we make available under
these Terms and Conditions, as indicated by our inclusion of these Terms and
Conditions with the Software.

### License Grant

Subject to your compliance with this License Grant and the Patents,
Redistribution and Trademark clauses below, we hereby grant you the right to
use, copy, modify, create derivative works, publicly perform, publicly display
and redistribute the Software for any Permitted Purpose identified below.

### Permitted Purpose

A Permitted Purpose is any purpose other than a Competing Use. A Competing Use
means making the Software available to others in a commercial product or
service that:

1. substitutes for the Software;

2. substitutes for any other product or service we offer using the Software
   that exists as of the date we make the Software available; or

3. offers the same or substantially similar functionality as the Software.

Permitted Purposes specifically include using the Software:

1. for your internal use and access;

2. for non-commercial education;

3. for non-commercial research; and

4. in connection with professional services that you provide to a licensee
   using the Software in accordance with these Terms and Conditions.

### Patents

To the extent your use for a Permitted Purpose would necessarily infringe our
patents, the license grant above includes a license under our patents. If you
make a claim against any party that the Software infringes or contributes to
the infringement of any patent, then your patent license to the Software ends
immediately.

### Redistribution

The Terms and Conditions apply to all copies, modifications and derivatives of
the Software.

If you redistribute any copies, modifications or derivatives of the Software,
you must include a copy of or a link to these Terms and Conditions and not
remove any copyright notices provided in or with the Software.

### Disclaimer

THE SOFTWARE IS PROVIDED "AS IS" AND WITHOUT WARRANTIES OF ANY KIND, INCLUDING
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NON-INFRINGEMENT.

IN NO EVENT WILL WE HAVE ANY LIABILITY TO YOU ARISING OUT OF OR RELATED TO THE
SOFTWARE, INCLUDING INDIRECT, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES, EVEN
IF WE HAVE BEEN INFORMED OF THEIR POSSIBILITY IN ADVANCE.

### Trademarks

Except for displaying the License Details and identifying us as the origin of
the Software, you have no right under these Terms and Conditions to use our
trademarks, trade names, service marks or product names.

## Grant of Future License

We hereby irrevocably grant you an additional license to use the Software under
the Apache License, Version 2.0 that is effective on the second anniversary of
the date we make the Software available. On or after that date, you may use the
Software under the Apache License, Version 2.0, in which case the following will
apply:

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License.

You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.
```

- [ ] **Step 2: Add the Editions & License section to README**

Append this section to `README.md` (place it after the last content section, before the closing footer/links if any):

```markdown
## Editions & License

Conduit ships in two editions from one codebase:

- **Community** (this repo) — the relay, CLI, VS Code extension, and a
  **single-organization** dashboard. Fully self-hostable for internal and
  enterprise use. This is what you get by default.
- **Cloud** — the multi-tenant hosted service (`relay.conduitrelay.com`),
  including org isolation, billing, public signup, and the marketing site.
  These SaaS-only components live in a private module and are not part of this
  repository.

The community edition is the default for every build. There is no code path
from the community build into the cloud components.

### License

Conduit is licensed under the [Functional Source License, Version 1.1,
Apache 2.0 Future License](LICENSE) (FSL-1.1-Apache-2.0). In short: you may use,
modify, and self-host Conduit for any purpose **except** offering it to others
as a competing hosted or managed service. Two years after each release, that
release becomes available under the Apache License 2.0.
```

- [ ] **Step 3: Verify the license badge resolves**

Run: `test -f LICENSE && head -1 LICENSE`
Expected: prints `# Functional Source License, Version 1.1, Apache 2.0 Future License`

- [ ] **Step 4: Commit**

```bash
git add LICENSE README.md
git commit -m "docs: add FSL-1.1 license and editions section"
```

---

### Task 2: Canonical EDITION resolver in packages/types

**Files:**
- Create: `packages/types/src/edition.ts`
- Modify: `packages/types/src/index.ts`
- Test: `packages/types/src/__tests__/edition.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Edition = 'community' | 'cloud'`
  - `function resolveEdition(env?: Record<string, string | undefined>): Edition`
  - `const EDITION: Edition` (resolved once from `process.env` at import)

- [ ] **Step 1: Write the failing test**

Create `packages/types/src/__tests__/edition.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { resolveEdition } from '../edition.js'

describe('resolveEdition', () => {
  it('returns community when EDITION is unset', () => {
    expect(resolveEdition({})).toBe('community')
  })

  it('returns cloud when EDITION=cloud', () => {
    expect(resolveEdition({ EDITION: 'cloud' })).toBe('cloud')
  })

  it('returns community for any unknown value', () => {
    expect(resolveEdition({ EDITION: 'enterprise' })).toBe('community')
    expect(resolveEdition({ EDITION: '' })).toBe('community')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/types && bun test src/__tests__/edition.test.ts`
Expected: FAIL — cannot resolve module `../edition.js`

- [ ] **Step 3: Write the resolver**

Create `packages/types/src/edition.ts`:

```ts
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
```

- [ ] **Step 4: Export from the package index**

Modify `packages/types/src/index.ts` to add below the existing export:

```ts
export * from './protocol.js'
export * from './edition.js'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/types && bun test src/__tests__/edition.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Rebuild types so downstream packages see the new export**

Run: `cd packages/types && bun run build`
Expected: exits 0; `dist/edition.js` and `dist/edition.d.ts` exist.

- [ ] **Step 7: Commit**

```bash
git add packages/types/src/edition.ts packages/types/src/index.ts packages/types/src/__tests__/edition.test.ts packages/types/dist
git commit -m "feat(types): add canonical EDITION resolver"
```

---

### Task 3: Wire edition into relay config

**Files:**
- Modify: `packages/relay/src/config.ts` (interface `RelayConfig` + `loadConfig` return)
- Test: `packages/relay/src/__tests__/edition.test.ts`

**Interfaces:**
- Consumes: `resolveEdition`, `Edition` from `@conduit/types`.
- Produces: `RelayConfig.edition: Edition` populated by `loadConfig()`.

- [ ] **Step 1: Write the failing test**

Create `packages/relay/src/__tests__/edition.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'bun:test'
import { loadConfig } from '../config.js'

const orig = process.env['EDITION']
afterEach(() => {
  if (orig === undefined) delete process.env['EDITION']
  else process.env['EDITION'] = orig
})

describe('relay config edition', () => {
  it('defaults to community', () => {
    delete process.env['EDITION']
    process.env['CONDUIT_JWT_SECRET'] = 'x'
    expect(loadConfig().edition).toBe('community')
  })

  it('reads cloud from EDITION', () => {
    process.env['EDITION'] = 'cloud'
    process.env['CONDUIT_JWT_SECRET'] = 'x'
    expect(loadConfig().edition).toBe('cloud')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/relay && bun test src/__tests__/edition.test.ts`
Expected: FAIL — `edition` is `undefined` on the config object.

- [ ] **Step 3: Add `edition` to the config interface**

In `packages/relay/src/config.ts`, add the import at the top of the file:

```ts
import { resolveEdition, type Edition } from '@conduit/types'
```

Add this field to the `RelayConfig` interface (after `port: number`):

```ts
  edition: Edition
```

- [ ] **Step 4: Populate `edition` in loadConfig**

In the object returned by `loadConfig()`, add as the first property (before `port`):

```ts
    edition: resolveEdition(),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/relay && bun test src/__tests__/edition.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Run the full relay suite to confirm no regressions**

Run: `cd packages/relay && bun test --timeout 10000`
Expected: PASS (same pass count as before, plus the 2 new tests)

- [ ] **Step 7: Commit**

```bash
git add packages/relay/src/config.ts packages/relay/src/__tests__/edition.test.ts
git commit -m "feat(relay): resolve edition in config"
```

---

### Task 4: Wire edition into the dashboard

**Files:**
- Modify: `apps/dashboard/package.json` (add `@conduit/types` workspace dep)
- Create: `apps/dashboard/src/lib/edition.ts`

**Interfaces:**
- Consumes: `EDITION`, `type Edition` from `@conduit/types`.
- Produces: `apps/dashboard/src/lib/edition.ts` re-exporting `EDITION` and `Edition` for dashboard code.

- [ ] **Step 1: Add the workspace dependency**

In `apps/dashboard/package.json`, add to `dependencies` (keep alphabetical-ish with the existing `better-auth` entry):

```json
    "@conduit/types": "*",
```

(`apps/dashboard/next.config.ts` already lists `transpilePackages: ['@conduit/types']`, so no config change is needed.)

- [ ] **Step 2: Install so the workspace symlink is created**

Run: `bun install`
Expected: exits 0; `apps/dashboard/node_modules/@conduit/types` resolves to the workspace package.

- [ ] **Step 3: Create the dashboard edition util**

Create `apps/dashboard/src/lib/edition.ts`:

```ts
// Canonical edition logic lives in @conduit/types. Re-exported here so
// dashboard code imports from a single local module.
export { EDITION, resolveEdition, type Edition } from '@conduit/types'
```

- [ ] **Step 4: Verify it typechecks**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/package.json apps/dashboard/src/lib/edition.ts bun.lock
git commit -m "feat(dashboard): consume shared EDITION from @conduit/types"
```

---

### Task 5: packages/cloud submodule seam

**Files:**
- Create: `packages/cloud/README.md`
- Create: `docs/CLOUD_SUBMODULE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a `packages/cloud/` directory documented as the private-submodule mount point. No code; no workspace registration.

Note: `packages/cloud` is intentionally NOT added to the root `package.json` `workspaces` array — the community build must succeed when this directory is absent. The actual `git submodule add <private-repo-url> packages/cloud` is run once by the maintainer against a real private repo; this task only establishes the seam and documents the procedure.

- [ ] **Step 1: Create the placeholder README**

Create `packages/cloud/README.md`:

```markdown
# @conduit/cloud (private)

This directory is the mount point for Conduit's **cloud edition** — the
SaaS-only components (multi-tenant org isolation, billing & metering, public
signup, marketing site). It is a **private git submodule** and is not part of
the public, FSL-licensed repository.

The community build does not include this module and has no import path into it
(enforced by the dependency-boundary lint in CI). See
[docs/CLOUD_SUBMODULE.md](../../docs/CLOUD_SUBMODULE.md) for setup.
```

- [ ] **Step 2: Document the submodule procedure**

Create `docs/CLOUD_SUBMODULE.md`:

```markdown
# Cloud submodule

The cloud edition lives in a private repository mounted at `packages/cloud`.

## Maintainer: attach the private repo (one time)

```bash
git submodule add git@github.com:jimseiwert/conduit-cloud.git packages/cloud
git commit -m "chore: wire packages/cloud private submodule"
```

This writes a `.gitmodules` entry and a gitlink. The public repo stores only
the reference, not the contents.

## Building the cloud edition

```bash
git submodule update --init packages/cloud
EDITION=cloud bun run build
```

## Community build (default)

Do nothing. With the submodule uninitialized, `packages/cloud` is empty and the
community build ignores it. `EDITION` is unset, so it resolves to `community`.

## Boundary rule

Core packages must never import from `packages/cloud`. CI enforces this via
`dependency-cruiser` (see `.dependency-cruiser.cjs`). `cloud` may import from
core packages.
```

- [ ] **Step 3: Verify community build ignores the directory**

Run: `git status --porcelain packages/cloud`
Expected: shows the two new untracked files only; the directory is not wired into any workspace build.

- [ ] **Step 4: Commit**

```bash
git add packages/cloud/README.md docs/CLOUD_SUBMODULE.md
git commit -m "chore: add packages/cloud submodule seam and docs"
```

---

### Task 6: Import-boundary check (zero-dep) + CI job

**Files:**
- Create: `scripts/check-boundaries.mjs`
- Modify: `package.json` (root — add `lint:boundaries` script; NO new dependency)
- Modify: `docs/CLOUD_SUBMODULE.md` (update the boundary-rule paragraph to reference this script instead of dependency-cruiser)
- Modify: `.github/workflows/ci.yml` (add `boundaries` job)

**Interfaces:**
- Consumes: nothing.
- Produces: `bun run lint:boundaries` (runs `node scripts/check-boundaries.mjs`) that exits non-zero when any core package source imports from `packages/cloud`.

**Design note:** The approved plan originally used `dependency-cruiser`; it was replaced with a zero-dependency Node script because (a) the build environment blocks the npm registry so the dep cannot be installed/verified, and (b) a full graph-analysis dependency is over-engineered for a single import rule. The script uses only Node built-ins.

- [ ] **Step 1: Create the boundary-check script**

Create `scripts/check-boundaries.mjs`:

```js
#\!/usr/bin/env node
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
      if (dot \!== -1 && exts.has(e.name.slice(dot))) out.push(full)
    }
  }
  return out
}

// Captures the module specifier from:
//   import ... from '<spec>'   /   export ... from '<spec>'
//   require('<spec>')          /   import('<spec>')
const specRe =
  /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g

function hitsCloud(spec, fileDir) {
  // Bare workspace specifier for the cloud package.
  if (spec === '@conduit/cloud' || spec.startsWith('@conduit/cloud/')) return true
  // Relative specifier that resolves into packages/cloud.
  if (spec.startsWith('.')) {
    const rel = relative(cloudDir, resolve(fileDir, spec))
    if (rel === '' || \!rel.startsWith('..')) return true
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
    while ((m = specRe.exec(src)) \!== null) {
      const spec = m[1] || m[2] || m[3]
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
```

- [ ] **Step 2: Add the root script**

In root `package.json`, add to `scripts`:

```json
    "lint:boundaries": "node scripts/check-boundaries.mjs"
```

(No dependency changes. Do NOT add dependency-cruiser.)

- [ ] **Step 3: Run it clean**

Run: `bun run lint:boundaries`
Expected: prints `Import boundary OK: no core -> packages/cloud imports`, exit 0.

- [ ] **Step 4: Prove the rule catches a violation (temporary)**

Create a temporary offending file `packages/relay/src/__boundary_probe.ts`:

```ts
// TEMPORARY — used only to verify the boundary check fires.
export { EDITION } from '../../cloud/index.js'
```

Run: `bun run lint:boundaries`
Expected: FAIL (exit 1); stderr lists `packages/relay/src/__boundary_probe.ts:2 imports '../../cloud/index.js'`.

- [ ] **Step 5: Remove the probe and confirm clean again**

Run: `rm packages/relay/src/__boundary_probe.ts && bun run lint:boundaries`
Expected: exit 0, prints the OK line.

- [ ] **Step 6: Update the cloud submodule doc's boundary paragraph**

In `docs/CLOUD_SUBMODULE.md`, replace the boundary-rule paragraph so it references this script. The section should read:

```markdown
## Boundary rule

Core packages must never import from `packages/cloud`. CI enforces this via a
zero-dependency check (`scripts/check-boundaries.mjs`, run with
`bun run lint:boundaries`). `cloud` may import from core packages.
```

- [ ] **Step 7: Add the CI job**

In `.github/workflows/ci.yml`, add this job under `jobs:` (sibling of `test-units`):

```yaml
  boundaries:
    name: Import boundary check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Check edition import boundary
        run: bun run lint:boundaries
```

(No `bun install` needed for this job — the script uses only Node/Bun built-ins.)

- [ ] **Step 8: Commit**

```bash
git add scripts/check-boundaries.mjs package.json docs/CLOUD_SUBMODULE.md .github/workflows/ci.yml
git commit -m "ci: enforce community->cloud import boundary (zero-dep check)"
```

### Task 7: CI job — community build with cloud absent

**Files:**
- Modify: `.github/workflows/ci.yml` (add `community-build` job)

**Interfaces:**
- Consumes: the existing root `build` script (`bun run build:types && bun run build:relay && bun run build:cli`).
- Produces: a CI job proving the community build succeeds with `packages/cloud` uninitialized and `EDITION` unset.

- [ ] **Step 1: Add the community-build job**

In `.github/workflows/ci.yml`, add this job under `jobs:`:

```yaml
  community-build:
    name: Community build (cloud absent)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: false

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Assert cloud module is absent
        run: |
          if [ -e packages/cloud/index.ts ] || [ -e packages/cloud/package.json ]; then
            echo "packages/cloud must not contain buildable code in the public checkout"
            exit 1
          fi

      - name: Install dependencies
        run: bun install

      - name: Community build
        run: bun run build
        env:
          EDITION: ''
```

- [ ] **Step 2: Reproduce the job locally**

Run: `EDITION='' bun run build`
Expected: exits 0; builds `packages/types`, `packages/relay`, `packages/cli` with no reference to `packages/cloud`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: verify community build with cloud absent"
```

---

## Self-Review

**Spec coverage (spec §3 sub-project #0):**
- `packages/cloud` submodule scaffold → Task 5 ✅
- `EDITION` flag through relay + dashboard → Tasks 3, 4 (canonical in Task 2) ✅
- Import-boundary lint in CI → Task 6 ✅
- FSL `LICENSE` + README editions/license section → Task 1 ✅
- Community build verified with submodule absent → Task 7 ✅

**Placeholder scan:** No TBD/TODO; the one temporary probe file (Task 6 Step 4) is created and removed within the same task with explicit commands. FSL text is included in full.

**Type consistency:** `Edition` and `resolveEdition` defined in Task 2 are imported with identical names in Tasks 3 (`resolveEdition`, `Edition`) and 4 (`EDITION`, `Edition`). `RelayConfig.edition` typed as `Edition` matches. `lint:boundaries` script name matches its CI invocation in Tasks 6 & 7.

**Scope:** Focused on the boundary + license foundation only. Cloud feature build-out is out of scope (spec sub-project #5). Relay/dashboard/DX improvements are separate sub-projects (#1–4).
