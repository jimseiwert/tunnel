<div align="center">
  <img src="https://raw.githubusercontent.com/jimseiwert/conduit/main/assets/logo-mark.png" alt="conduit" width="80" />
  <br/><br/>
  <p><strong>Live HTTP request inspection and replay for your local server — directly in VS Code.</strong></p>
</div>

---

Conduit streams every HTTP request that hits your tunnel straight into a VS Code sidebar panel. Watch traffic arrive in real time, inspect full headers and body, and replay any past request with one click — without leaving the editor.

No CLI required. The extension connects and proxies traffic on its own.

## What it does

**Live request stream.** A sidebar panel shows every incoming request as it arrives: method, path, status code, and timing. No browser tab to switch to. No separate terminal window.

**One-click replay.** Select any request and hit Replay. Conduit re-fires it against your local server exactly as it came in — same headers, same body. Useful for iterating on webhook handlers without waiting for the real event to fire again.

**Proxy mode (default).** The extension registers your workspace with the relay and forwards incoming requests to your local server. No CLI needed. Your public webhook URL appears in VS Code the moment you connect.

**Watch mode.** If the Conduit CLI is already running as the owner, the extension switches to watcher mode and shows live traffic without forwarding anything. Your whole team can watch the same request stream simultaneously.

**Manual or automatic connection.** Open the Conduit panel from the Activity Bar to connect. Enable `"conduit.autoConnect": true` in settings if you want it to connect automatically when you open a workspace. On first connect it registers a unique slug for the workspace and saves it for future sessions.

## Requirements

You need a Conduit relay to connect to. Options:

- **Use the hosted relay** at `wss://relay.conduitrelay.com` — works out of the box, no setup
- **Self-host** on Kubernetes or Docker — see the [Conduit repo](https://github.com/jimseiwert/conduit) for the Helm chart and Docker Compose file

## Getting started

1. Install this extension
2. Open any workspace in VS Code
3. Open the Conduit panel from the Activity Bar
4. Click "Connect" to register the workspace and generate a webhook URL
5. Your webhook URL appears in a VS Code notification — copy it and send requests to it
6. Requests appear in the Conduit panel in the activity bar instantly

That's it. No CLI, no config files, no tokens to manage manually.

## Modes

### Proxy mode (default)

The extension acts as the tunnel owner. It registers with the relay, receives incoming requests, and forwards them to your local server on the configured port (default: 3000).

Use this when you want the extension to handle everything — no CLI needed.

### Watch mode

The extension connects as a watcher. It shows live traffic from whoever is running as the owner (another VS Code instance or the CLI), but does not forward requests itself.

Use this when the CLI is already running, or when you want to observe traffic without forwarding.

Set in VS Code settings:
```json
{
  "conduit.mode": "watch"
}
```

If the CLI is already running as owner for your workspace, the extension detects this automatically and falls back to watch mode regardless of your setting.

## Commands

| Command | What it does |
|---------|-------------|
| `Conduit: Connect` | Connect to the relay |
| `Conduit: Disconnect` | Disconnect from the relay |
| `Conduit: Clear Stored Token` | Remove saved credentials and force re-authentication |
| `Conduit: Copy Webhook URL` | Copy your public webhook URL to the clipboard |
| `Conduit: Replay Request` | Replay the selected request against your local server |
| `Conduit: Refresh` | Reload the request list |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `conduit.mode` | `proxy` | `proxy`: extension forwards relay traffic to your local server. `watch`: extension observes traffic from an existing owner. |
| `conduit.localPort` | `3000` | Local port to forward incoming requests to (proxy mode only) |
| `conduit.relayUrl` | `wss://relay.conduitrelay.com` | WebSocket URL of your relay server |
| `conduit.autoConnect` | `false` | Auto-connect when VS Code opens a workspace |

## How slugs and tokens work

On first connect, the extension generates a unique slug for your workspace (e.g. `ws-a3f9c2b1d4e6`) and registers it with the relay. The slug and token are saved to `~/.conduit/projects.json` keyed by workspace path and to VS Code's encrypted secret storage.

On subsequent connects, the extension reuses the saved slug and token automatically. Nothing to copy, paste, or manage.

If you self-host the relay and configured auth (`AUTH_PROVIDER=oidc`), the extension will open your browser for login when needed.

## Self-hosting

Point the extension at your relay:

```json
// .vscode/settings.json
{
  "conduit.relayUrl": "wss://relay.yourdomain.com"
}
```

Full relay setup docs and the Helm chart are in the [Conduit repository](https://github.com/jimseiwert/conduit).

## More

- [GitHub](https://github.com/jimseiwert/conduit) — source, issues, CLI docs
- [Conduit CLI](https://github.com/jimseiwert/conduit#install) — terminal UI with time-travel diff and history
