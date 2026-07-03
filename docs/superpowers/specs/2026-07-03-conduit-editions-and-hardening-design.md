# Conduit — Editions Boundary & Hardening Design

**Date:** 2026-07-03
**Status:** Approved (boundary + sequencing)
**Scope:** Establish a two-edition (community / cloud) architecture with a defensible open-core moat, then execute the four audit-driven improvement clusters (relay hardening, self-hostable dashboard, DX/docs, dashboard UX). Building out the cloud SaaS features themselves is a deferred, separate track.

---

## 1. Goals & non-goals

### Goals
- Make Conduit **fully self-hostable for internal/enterprise use** — relay **and** dashboard — from a single documented path.
- Prevent third parties from **reselling Conduit as their own hosted SaaS**, via a three-layer moat (architectural + build-time + legal).
- Ship the four audit clusters so the codebase is something developers are proud of and users find simple, modern, and fun.
- Keep one monorepo, one build system, shared types — no fork, no divergence between the self-hosted and hosted codebases.

### Non-goals (this effort)
- Building out the actual cloud SaaS features (multi-tenancy runtime, billing, metering, public signup, marketing site). That is sub-project #5, a separate future track. This effort only establishes the **boundary** those features will live behind.
- Changing the tunnel wire protocol or the CLI/VS Code core forwarding behavior beyond hardening and DX.

---

## 2. Product decisions (locked)

| Decision | Choice |
|---|---|
| Moat model | **Single-tenant moat + source-available license** (belt & suspenders) |
| SaaS-only capabilities | **Multi-tenant org isolation, billing & usage metering, public self-signup, hosted marketing site + install redirect** — all four |
| Self-hosted auth | **Bootstrap admin (env) + optional OIDC/SAML SSO + admin-invite only.** No public signup in community edition. |
| SaaS code home | **Private git submodule** in the monorepo (`packages/cloud`); public repo references it but does not contain the source |
| License | **FSL (Functional Source License)** — forbids competing/hosted-service use; each release auto-converts to Apache 2.0 after 2 years |

---

## 3. Two-edition architecture (the moat)

```
conduit/ (public repo, FSL-licensed, self-hostable)
├── packages/relay        community — relay server (already portable)
├── packages/cli          community
├── packages/vscode-ext   community
├── packages/types        community — shared protocol + types
├── apps/dashboard        community — SINGLE-ORG dashboard
└── packages/cloud        PRIVATE git submodule — NOT in public repo
                          multi-tenancy · billing/metering · public signup · marketing
```

### Three independent moat layers
1. **Architectural.** All SaaS-making code lives in `packages/cloud`, wired as a private git submodule. The public repo contains only a submodule reference (gitlink), not the source. The self-hosted build never includes it.
2. **Build-time.** An `EDITION` env/build flag with values `community` (default) and `cloud`. The community build has no code path that reaches multi-tenancy or billing; the dashboard is hardwired to a single org.
3. **Legal.** FSL on the public repo forbids offering the software as a hosted/managed service to third parties. Auto-converts to Apache 2.0 two years per release.

### Enforced import boundary
- **Rule:** core packages (`relay`, `dashboard`, `cli`, `vscode-ext`, `types`) may **never** import from `packages/cloud`. `cloud` **may** import from core.
- **Enforcement:** a dependency-boundary check in CI (dependency-cruiser or ESLint `no-restricted-imports`/`import/no-restricted-paths`). A violating import fails CI.
- **Why:** this is what makes "extract cloud to fully private later" a near-zero-churn guarantee, and prevents the two editions from silently coupling over time.

### Edition resolution
- `EDITION` defaults to `community` when unset (safe default: a fresh clone/build is always the self-hostable edition).
- The `cloud` edition is selected only in the hosted build pipeline, which has the submodule checked out.
- Community builds must compile and run with `packages/cloud` **absent** (submodule not initialized). No import, config, or type may hard-require cloud.

---

## 4. Self-hosted dashboard architecture (single-org)

- **Auth:** `better-auth`, made pluggable.
  - First-run bootstrap: if no users exist, create one admin from `CONDUIT_ADMIN_EMAIL` + `CONDUIT_ADMIN_PASSWORD`. Solo devs are running with zero IdP.
  - Optional OIDC/SAML SSO (community edition) — reuses the relay's existing OIDC/MSAL concepts.
  - Additional users join **only by admin invite**. Public/open registration exists only in `cloud`.
  - OAuth providers (Google/GitHub) become **optional** — registered only when their env vars are present; no `!` non-null assertions that crash when unset.
- **Database:** `better-auth` via Kysely supports SQLite. Community edition **defaults to SQLite** (single container, single volume, matches the relay). Postgres remains an option via `DATABASE_URL`. Cloud edition uses Postgres.
- **Relay URLs:** all `relay.conduitrelay.com` hardcodes removed. The public relay URL is derived from config (e.g. `NEXT_PUBLIC_RELAY_URL` / server-side `RELAY_PUBLIC_URL`) so a self-hoster's own domain renders in the UI.
- **Coupling documented & configured:** `RELAY_INTERNAL_URL`, `RELAY_ADMIN_SECRET`, and the shared `CONDUIT_JWT_SECRET` are documented in a dashboard `.env.example` and the root `.env.example`.
- **Deployment:** dashboard gets a Dockerfile, a `docker-compose.yml` service, and a Helm template; it is built and published by CI alongside the relay.

---

## 5. Sub-projects (decomposition & sequencing)

Each sub-project is independently shippable and gets its own spec → plan → implementation cycle.

**Order:** 0 → 1 (parallel) → 2 → 3 & 4 (parallel) → 5 later.

### #0 — Edition boundary + FSL license *(foundation)*
- `packages/cloud` private submodule scaffold (empty placeholder acceptable initially).
- `EDITION=community|cloud` flag plumbed through relay + dashboard build/runtime.
- Import-boundary lint rule wired into CI.
- FSL `LICENSE` file; README section explaining editions + license + the moat.
- Community build verified to compile/run with the submodule absent.
- **Depends on:** nothing.

### #1 — Relay hardening *(independent, low-risk)*
- Timing-safe comparisons (`crypto.timingSafeEqual`) for admin secret and all token checks.
- Stream chunk-size cap in `PendingRequests.addChunk` to prevent unbounded memory growth.
- `try/catch` around stored-header `JSON.parse` in the owner handler.
- Prune expired grace-period entries from the connection registry.
- Rate limiting on registration and token renewal.
- Tests for each.
- **Depends on:** nothing (can run parallel to #0).

### #2 — Self-hostable dashboard *(core portability win)*
- Everything in section 4: Dockerfile, compose service, SQLite-default better-auth, bootstrap-admin auth, optional OIDC/SSO, optional OAuth providers, env-driven relay URLs, Helm template, CI publish, completed `.env.example` files.
- **Depends on:** #0 (edition flag + boundary).

### #3 — DX, docs & installers
- README quickstart fixed: add `conduit login` step; standardize on `login` (document `auth` as legacy alias).
- Load `dotenv` in the CLI so documented `.env` usage works.
- Relay-unreachable and local-server-down produce **actionable** error messages (not silent disconnect / bare 502).
- Startup connectivity check that suggests `CONDUIT_RELAY_URL` on failure.
- Installer checksum verification (`install.sh`, `install.ps1`).
- VS Code activation on-demand (not `onStartupFinished` for every window); align "auto-connect" docs with the actual default.
- Troubleshooting guide + self-hosting-the-dashboard guide.
- **Depends on:** #2 (docs reference the new deploy path).

### #4 — Dashboard UX overhaul
- Live request stream via the relay's WebSocket watcher (replaces static server-render).
- Request-detail/payload inspector view.
- Replay and time-travel diff in the UI (parity with CLI + README promises).
- Dark mode, responsive breakpoints, design tokens.
- Error boundaries + loading/empty states.
- Zod validation of relay responses (remove `as Promise<T>` assertions).
- **Depends on:** #2.

### #5 — Cloud module build-out *(deferred, separate track)*
- Actual multi-tenancy runtime, billing/metering, public signup, marketing site — inside `packages/cloud`.
- **Depends on:** #0, #2. Out of scope for this effort.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Community build breaks when `packages/cloud` submodule is absent | CI job that builds community edition with the submodule uninitialized; import-boundary lint blocks hard deps |
| better-auth on SQLite has feature gaps vs Postgres | Verify required better-auth features (sessions, accounts, verification) on the Kysely SQLite dialect during #2; fall back to documenting Postgres if a blocker surfaces |
| Removing OAuth `!` assertions changes existing hosted deploy | Cloud edition keeps OAuth via env presence; behavior unchanged when vars are set |
| Timing-safe / rate-limit changes alter relay behavior under load | Add targeted tests; keep limits configurable via env with safe defaults |
| Hardcoded-URL removal misses a spot → self-hosters still see SaaS domain | Grep-based check in #2 acceptance; add a test/lint guard against literal `conduitrelay.com` in community code |

---

## 7. Acceptance (per sub-project, high level)
- **#0:** community build compiles and runs with submodule absent; boundary lint fails on a deliberate cross-import; FSL `LICENSE` present; README documents editions.
- **#1:** new tests pass; no `!==`/`===` secret/token comparisons remain; memory bounded under a large-stream test.
- **#2:** `docker compose up` yields relay + dashboard + persistence with SQLite and no OAuth required; no `conduitrelay.com` literal in community code; dashboard image published by CI.
- **#3:** README quickstart works end-to-end for a new user; installers verify checksums; troubleshooting + self-host-dashboard docs exist.
- **#4:** dashboard shows live requests, detail, replay, diff; dark mode + responsive; relay responses Zod-validated.
