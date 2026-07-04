<div align="center">
  <img src="./assets/logo.svg" alt="conduit" width="300" />
  <br/><br/>
  <p><strong>Self-hosted developer tunnel with live request inspection, replay, and time-travel diff.</strong></p>
  <p>
    <a href="https://github.com/jimseiwert/conduit/releases/latest"><img src="https://img.shields.io/github/v/release/jimseiwert/conduit?style=flat-square&color=38BDF8&label=release" alt="Latest Release"/></a>
    <a href="https://github.com/jimseiwert/conduit/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/jimseiwert/conduit/ci.yml?style=flat-square&color=6366F1&label=CI" alt="CI"/></a>
    <a href="https://marketplace.visualstudio.com/items?itemName=jimseiwert.conduit-relay"><img src="https://img.shields.io/badge/VS%20Code-extension-A78BFA?style=flat-square" alt="VS Code Extension"/></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/jimseiwert/conduit?style=flat-square&color=38BDF8" alt="License"/></a>
  </p>
  <p>
    <a href="https://github.com/sponsors/jimseiwert"><img src="https://img.shields.io/badge/sponsor-♥-ea4aaa?style=flat-square" alt="Sponsor"/></a>
    <a href="https://ko-fi.com/jimseiwert"><img src="https://img.shields.io/badge/ko--fi-☕-FF5E5B?style=flat-square" alt="Ko-fi"/></a>
  </p>
</div>

---

Conduit routes public HTTPS traffic to your localhost and gives you a full debugging environment to watch, replay, and diff every request in real time. Your data never leaves your infrastructure.

**The key difference from ngrok:** data stays in your cluster, your whole team shares the same live request stream, and you can go back in time to see exactly what changed between any two requests — field by field.

The VS Code extension works standalone — no CLI required to start forwarding traffic.

## Features

**Time-travel debugging.** The relay stores a ring buffer of up to 1,000 requests per slug. `conduit diff <id1> <id2>` gives you a field-level JSON diff between any two of them. Find the exact moment something broke without re-triggering it.

**Request replay.** Hit `r` in the TUI to re-fire any past request against your local server. No copying curl commands, no re-sending from Postman.

**Team observation mode.** Share your slug and token. Your whole team sees the same live traffic stream in their own TUI or VS Code panel simultaneously.

**Full observation plane.** A terminal UI built with Ink, a VS Code sidebar panel, and a persistent storage layer — not just a URL forwarder.

**Self-hosted relay.** Runs as a Kubernetes pod or Docker container on your infrastructure. OIDC and Azure AD (MSAL) auth layers available. No third-party servers in the data path.

## Install

**macOS / Linux**
```bash
curl -fsSL https://get.conduitrelay.com/conduit | bash
```

**Windows (PowerShell)**
```powershell
irm https://get.conduitrelay.com/conduit/install.ps1 | iex
```

**VS Code** — Install [Conduit Relay](https://marketplace.visualstudio.com/items?itemName=jimseiwert.conduit-relay) from the Marketplace.

## Quickstart

### VS Code extension (no CLI needed)

1. Install the [Conduit Relay](https://marketplace.visualstudio.com/items?itemName=jimseiwert.conduit-relay) extension
2. Open any workspace — the extension auto-connects and generates a unique slug
3. Your public webhook URL appears in a VS Code notification
4. Send a request to it and watch it arrive in the Conduit sidebar panel

### CLI

```bash
# Register a slug and start forwarding to localhost:3000
conduit start --port 3000
```

Your public URL appears in the TUI header. Send a request to it — it shows up immediately.

```
https://relay.conduitrelay.com/ws-a3f9c2b1d4e6/
```

On your next run, conduit reads your workspace config from `~/.conduit/projects.json` and reconnects automatically. No flags needed.

## TUI Controls

| Key | Action |
|-----|--------|
| `↑` `↓` | Navigate requests |
| `r` | Replay selected request against localhost |
| `d` | Mark as diff base — press again on a second request to compare |
| `Esc` | Clear diff selection |
| `q` | Quit |

## CLI Reference

```
conduit start               Start the tunnel and open the TUI dashboard
conduit auth                Authenticate with the relay server
conduit diff <id1> <id2>    Field-level diff between two requests in the ring buffer
conduit history             List recent requests (default: last 50)
conduit replay <id>         Replay a stored request
conduit token refresh       Refresh your slug token before it expires

Options (start):
  --port <port>             Local port to forward to (default: 3000)
  --http                    Accept HTTP in addition to HTTPS
  --relay <url>             Custom relay WebSocket URL
```

## Config

Conduit stores workspace configuration in `~/.conduit/projects.json`, keyed by workspace root path. On first run, it generates a unique `ws-` prefixed slug for the workspace and saves the slug and token automatically. No config files to create or manage.

The only thing you need to configure manually is a custom relay URL, if you self-host:

```bash
export CONDUIT_RELAY_URL=wss://relay.yourdomain.com
```

Or set `CONDUIT_HOME` to use a different directory for the projects config:

```bash
export CONDUIT_HOME=/path/to/config
```

**Sharing a tunnel with your team:** share the slug and token from `~/.conduit/projects.json`. Teammates connect as watchers with `conduit start --relay wss://relay.conduitrelay.com` or via the VS Code extension in watch mode.

## Self-Hosting

The relay is a Fastify WebSocket server. It proxies requests to the owner's CLI, persists a request ring buffer, and broadcasts live traffic to all connected watchers.

### Any Linux VM (recommended quickstart)

The repo includes a `docker-compose.yml` with Caddy for automatic HTTPS and `wss://`. Caddy gets a Let's Encrypt cert on first boot and auto-renews it — no cert management needed.

**1. Install Docker**

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
```

**2. Clone the repo**

```bash
sudo git clone https://github.com/jimseiwert/conduit.git /opt/conduit
sudo chown -R $USER:$USER /opt/conduit
cd /opt/conduit
```

**3. Create your `.env`**

```bash
cp .env.example .env
```

Set at minimum:

```
CONDUIT_JWT_SECRET=your-strong-random-secret-here
```

**4. Point your domain at the server, then start**

Make sure `relay.yourdomain.com` has an A record pointing at the server's IP, update the `Caddyfile` with your domain, then:

```bash
nano Caddyfile  # replace relay.conduitrelay.com with your domain
docker compose up -d
```

**5. Keep it running across reboots and crashes**

```bash
sudo tee /etc/systemd/system/conduit.service > /dev/null <<EOF
[Unit]
Description=Conduit Relay
Requires=docker.service
After=docker.service network-online.target

[Service]
WorkingDirectory=/opt/conduit
ExecStart=docker compose up
ExecStop=docker compose down
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now conduit
```

**6. Point your CLI at the relay**

Add this to each project's `.env` (the file conduit reads automatically):

```
CONDUIT_RELAY_URL=wss://relay.yourdomain.com
```

Now `conduit start --slug myapp` connects to your relay instead of conduitrelay.com.

**Updating to a new release:**

```bash
cd /opt/conduit && git pull && docker compose pull && sudo systemctl restart conduit
```

> **Restarts and state:** `docker compose down` (without `-v`) preserves the SQLite volume, so slug registrations survive a restart. Keep your `.conduit` file on the client and the CLI will reconnect with its existing token automatically. If you need a completely clean slate (e.g. changed `CONDUIT_JWT_SECRET`), use `docker compose down -v` — this wipes stored slugs, so clients will need to re-register with `conduit start --slug <name>`.

### Kubernetes (Helm)

The chart is published to GHCR on every release and installed directly via OCI.

**Prerequisites:** a running ingress controller (e.g. [ingress-nginx](https://kubernetes.github.io/ingress-nginx/deploy/)) and an A record for `relay.yourdomain.com` pointing at your cluster's load balancer IP.

**1. Install**

```bash
helm install conduit-relay oci://ghcr.io/jimseiwert/charts/conduit-relay \
  --namespace conduit \
  --create-namespace \
  --set env.CONDUIT_JWT_SECRET=$(openssl rand -hex 32) \
  --set env.RELAY_DOMAIN=relay.yourdomain.com \
  --set env.RELAY_PROTO=https \
  --set ingress.enabled=true \
  --set ingress.host=relay.yourdomain.com
```

If your ingress controller uses a class name other than `nginx`, add `--set ingress.className=<your-class>`.

**2. Point your CLI at the relay**

Add to each project's `.env`:

```
CONDUIT_RELAY_URL=wss://relay.yourdomain.com
```

**Updating to a new release:**

```bash
helm upgrade conduit-relay oci://ghcr.io/jimseiwert/charts/conduit-relay \
  --namespace conduit \
  --reuse-values
```

> **Keep `replicaCount: 1`.** The relay holds an in-memory WebSocket registry. Horizontal scaling via Redis pub/sub is planned for v1.1.

> **State:** `helm upgrade` preserves the PVC — slug registrations survive upgrades. `helm uninstall` removes the PVC and wipes all stored slugs. Clients will need to re-register with `conduit start --slug <name>` after a full uninstall.

### Storage Adapters

| Adapter | When to use |
|---------|-------------|
| `memory` | Development and ephemeral environments |
| `sqlite` | Single-pod production — persistent, zero-dependency (default) |
| `postgres` | Production with an external database |

**Docker Compose** — set in `.env`:

```
STORAGE_ADAPTER=sqlite
SQLITE_PATH=/data/conduit.db
# or
STORAGE_ADAPTER=postgres
DATABASE_URL=postgres://user:pass@host/db
```

**Helm** — pass as `--set` flags:

```bash
--set env.STORAGE_ADAPTER=postgres \
--set env.DATABASE_URL=postgres://user:pass@host/db
```

### Auth (optional)

Set `AUTH_PROVIDER=oidc` or `AUTH_PROVIDER=msal` (Azure AD) on the relay to require user authentication on top of token-bound slugs.

**Docker Compose** — set in `.env`. See `.env.example` for the full variable list.

**Helm:**

```bash
--set env.AUTH_PROVIDER=oidc \
--set env.OIDC_ISSUER=https://accounts.google.com \
--set env.OIDC_CLIENT_ID=<client-id> \
--set env.OIDC_CLIENT_SECRET=<client-secret> \
--set env.OIDC_REDIRECT_URI=https://relay.yourdomain.com/auth/callback
```

## Architecture

```
External HTTP request
        │
        ▼
  Relay pod (Fastify + WebSocket)
  ├── /:slug/*              ← HTTP proxy — all methods
  ├── WS /:slug             ← Owner (CLI or VS Code ext in proxy mode)
  └── WS /:slug/watch       ← Watchers (teammates, VS Code in watch mode)
        │
        ▼
  ConduitClient (CLI or VS Code ext)
  ├── Forwards request to localhost:PORT
  ├── Streams response back via binary WebSocket frames
  └── Ink TUI / VS Code panel shows live traffic
```

**Packages:**

| Package | Role |
|---------|------|
| `packages/types` | Shared Zod schemas for the WebSocket wire protocol |
| `packages/relay` | Fastify relay server, JWT auth, ring buffer, storage adapters |
| `packages/cli` | Ink TUI, WebSocket client, `diff` / `history` / `replay` commands |
| `packages/vscode-ext` | VS Code sidebar panel with live request list and replay |
| `apps/relay-chart` | Helm chart for Kubernetes |

## Contributing

```bash
bun install
bun run build        # Build all packages (types → relay → cli)
bun run dev:relay    # Start relay in watch mode
bun test             # Run the full test suite
```

The wire protocol is defined in `packages/types/src/`. All messages are Zod-validated JSON over WebSocket. If you're adding a new message type, start there.

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

## Sponsoring

Conduit is free and open source. Hosting the public relay, database, and CDN costs roughly **$30/month**.

If Conduit saves you time, consider sponsoring — it keeps the project alive and the hosted relay running for everyone.

- [**GitHub Sponsors**](https://github.com/sponsors/jimseiwert) — one-time or monthly
- [**Ko-fi**](https://ko-fi.com/jimseiwert) — buy a coffee

The goal is never to paywall features. Sponsorship just covers the lights.
