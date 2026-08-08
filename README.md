# VaultForge

<p align="center">
  <img src="assets/logo.png" alt="VaultForge logo" width="180">
</p>

VaultForge is an Obsidian community plugin that embeds a local [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server directly inside your vault, giving Claude Code / Claude Desktop live read, write, and search access to your notes — no separate REST API or bridge process required.

> **Status:** early development. Core MCP server, vault tools, the chat assistant, and Claude Skills management are functional; template generation is planned next.

## Table of contents

- [Why VaultForge](#why-vaultforge)
- [How it works](#how-it-works)
- [Available MCP tools](#available-mcp-tools)
- [Security model](#security-model)
- [Installation](#installation)
- [Connecting Claude to the server](#connecting-claude-to-the-server)
- [Chat assistant](#chat-assistant)
- [Claude Skills](#claude-skills)
- [Development](#development)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Roadmap](#roadmap)

## Why VaultForge

Existing options each cover part of the problem:

| Plugin | Chat/Agent | Claude Code agent | Skills support |
|---|---|---|---|
| Claudian | ✅ | ❌ | ❌ |
| Local REST API + MCP (coddingtonbear) | ➖ (via external MCP client) | ✅ | ➖ |
| **VaultForge** | Planned | ✅ (via MCP) | Planned — core focus |

VaultForge's differentiator is treating **Claude Skills as first-class citizens inside the vault**, not just chat and file access.

## How it works

Everything runs inside the same process as Obsidian itself (the Electron renderer). The plugin is marked `isDesktopOnly: true` in `manifest.json`, which is what allows it to import Node.js core modules (`http`, `crypto`) that wouldn't otherwise be available in a browser-style plugin context.

```
Obsidian (Electron renderer process)
└─ VaultForge plugin
   ├─ Settings tab (toggle server, configure port, view API key)
   └─ MCP server (src/mcp/server.ts)
      ├─ node:http server, bound to 127.0.0.1 only
      ├─ StreamableHTTPServerTransport (@modelcontextprotocol/sdk)
      └─ Tools → operate directly on `app.vault` (Obsidian's Vault API)
```

**Request flow, step by step:**

1. Plugin loads → reads settings from `data.json` (`mcpServerEnabled`, `mcpServerPort`). The API key is loaded separately via `app.loadLocalStorage()` — see [Security model](#security-model) for why it's kept out of `data.json`.
2. If the server is enabled, `VaultForgeMcpServer.start()` registers the three tools below on an `McpServer` instance and starts a plain Node `http.Server` listening on `127.0.0.1:<port>`.
3. For every incoming request:
   - Only `POST /mcp` is accepted — everything else gets a `404`.
   - The `Authorization: Bearer <apiKey>` header is checked — missing or wrong key gets a `401`.
   - The JSON body is parsed manually (no Express, no body-parser dependency).
   - A **fresh `StreamableHTTPServerTransport`** is created per request (stateless mode: `sessionIdGenerator: undefined`), which avoids request-ID collisions across concurrent calls.
   - The MCP server connects to that transport and hands off the request; the transport bridges Node's `req`/`res` to the Web-standard Request/Response objects the MCP protocol expects (via `@hono/node-server` internally), runs the matching tool handler, and writes the JSON-RPC response back.
4. On disconnect (`res.on("close")`) the transport is closed and cleaned up.

Because the server lives inside the same process as Obsidian, tool handlers call `app.vault` directly — there's no HTTP hop to a separate REST API layer like in the Local REST API + MCP reference setup.

## Available MCP tools

| Tool | Description |
|---|---|
| `vault_read` | Reads a note's content by vault-relative path. |
| `vault_patch` | Creates or edits a note. `mode`: `overwrite` (default), `append`, `prepend`, or `create` (fails if the file already exists). |
| `search_query` | Case-insensitive substring search across all Markdown notes; returns matching paths with a snippet around each hit. |
| `skills_list` | Lists Claude Skills found under the configured skills folder (name + description, parsed from each `SKILL.md`'s frontmatter). |

## Security model

A local HTTP server with vault read/write access is a real attack surface on shared machines, so VaultForge applies the same baseline as the Local REST API plugin, plus one deliberate deviation:

- **Localhost-only binding** — the server listens on `127.0.0.1`, never `0.0.0.0`; it is not reachable from the network.
- **Bearer-token authentication** — a random 24-byte hex API key is generated on first use. Every request must include `Authorization: Bearer <key>`. No key is baked into the code or shipped anywhere — each installation generates its own.
- **Key storage: device-local, not vault-local.** The key is stored via Obsidian's `app.saveLocalStorage()` / `loadLocalStorage()` API instead of the plugin's `data.json`. `data.json` lives inside the vault and travels with it — through Obsidian Sync, iCloud/Dropbox/OneDrive, a shared team vault, or (if someone ever slipped up) a git commit. `localStorage` values do not; they're tied to Obsidian's own app data on that specific device. So if the vault is ever synced or shared, the bearer token doesn't go along for the ride.
  - We looked at Electron's `safeStorage` (OS-keychain-backed encryption) first, since the plugin already has Node/Electron access via `isDesktopOnly: true`. It's confirmed unavailable to Obsidian plugins (disabled in the renderer sandbox — see the [Obsidian forum thread](https://forum.obsidian.md/t/electron-safestorage-available/54844)), so `loadLocalStorage` is the practical alternative that still solves the actual risk (the key propagating via a synced/shared vault).
- **Masked in the UI** — the settings tab shows the key as a password field by default (eye-icon toggle to reveal), so it isn't casually exposed via screenshots or screen shares.
- **One-click rotation** — a "regenerate" button in settings issues a new key (with a confirmation prompt, since it invalidates already-configured MCP clients) and restarts the server if it's running.
- **Legacy cleanup** — earlier builds stored the key in `data.json`. `loadSettings()` detects and strips that field automatically on load so it stops lingering in vault files from older installs.

## Installation

VaultForge is not yet on the Obsidian community plugin registry. Manual install:

1. Download or build `manifest.json`, `main.js`, and `styles.css` (if present) — see [Development](#development).
2. Copy those files into `<YourVault>/.obsidian/plugins/vaultforge/`.
3. In Obsidian: **Settings → Community plugins** → disable "Restricted mode" if needed → enable **VaultForge**.
4. Open the VaultForge settings tab and toggle **MCP server** on. Click the eye icon next to **API-Key** to reveal it (masked by default).

## Connecting Claude to the server

Once the server is running (default `http://127.0.0.1:27124/mcp`), point an MCP-capable client at it with the bearer token from the settings tab.

Example: quick manual check with `curl`:

```bash
curl -X POST http://127.0.0.1:27124/mcp \
  -H "Authorization: Bearer <API-KEY-FROM-SETTINGS>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

**Windows / PowerShell:** the `\` line continuation above is Bash-only — PowerShell splits each line into its own command. Use `` ` `` instead, and call `curl.exe` explicitly (plain `curl` is a PowerShell alias for `Invoke-WebRequest`, which takes different flags):

```powershell
curl.exe -X POST http://127.0.0.1:27124/mcp `
  -H "Authorization: Bearer <API-KEY-FROM-SETTINGS>" `
  -H "Content-Type: application/json" `
  -H "Accept: application/json, text/event-stream" `
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

This should return a JSON-RPC response listing `vault_read`, `vault_patch`, and `search_query`.

For Claude Desktop / Claude Code, add an HTTP MCP server entry pointing at the same URL and header, per that client's MCP configuration docs.

## Chat assistant

VaultForge also ships a chat sidebar that talks to the Anthropic API directly from inside Obsidian (separate from, and independent of, the MCP server above — this is the plugin acting as a client, not a server).

1. Open **Settings → VaultForge → Chat** and paste an Anthropic API key (stored device-locally via `loadLocalStorage`, same as the MCP bearer token — never written to `data.json`). Optionally override the model ID.
2. Click the message-circle icon in the ribbon (or run the **VaultForge: Chat öffnen** command) to open the chat view in the right sidebar.
3. Ask questions or give instructions. The assistant has the same `vault_read` / `vault_patch` / `search_query` / `skills_list` tools available as external MCP clients, executed directly against `app.vault` — every tool call is shown inline in the transcript (`🔧 tool(args)`) for transparency.

This is a v1: responses are non-streaming (a single request/response per turn, via Obsidian's `requestUrl` to avoid CORS issues) and history is in-memory only, cleared on reload.

## Claude Skills

VaultForge treats a vault folder (default `Skills/`, configurable in settings) as a directory of Claude Skills — one subfolder per skill, each containing a `SKILL.md` with `name`/`description` frontmatter, following the same progressive-disclosure pattern Claude Skills use elsewhere: the chat assistant's system prompt lists every discovered skill's name and description, and it loads the full `SKILL.md` via `vault_read` only when a skill is actually relevant.

Manage skills from **Settings → VaultForge → Claude Skills**: the list shows every discovered skill with buttons to open or delete it, and "Neuen Skill anlegen" scaffolds a new `Skills/<name>/SKILL.md`. The same discovery is exposed to external MCP clients via the `skills_list` tool.

## Development

Requirements: Node.js, npm.

```bash
npm install       # install dependencies
npm run dev        # esbuild in watch mode → builds main.js on every change
npm run build       # type-check (tsc --noEmit) + production build (minified)
npm run sync         # copy manifest.json + main.js (+ styles.css) into the bundled test vault
```

`npm run build` and `npm run sync` are separate on purpose: `build` produces the artifacts, `sync` deploys them into the local test vault described below.

## Testing

This repository ships a ready-to-use test vault at [`vaultforge/`](vaultforge/) (it already contains a `.obsidian/` folder, so Obsidian recognizes it as a vault).

**One-time setup / after every change:**

```bash
npm run build && npm run sync
```

This compiles the plugin and copies the build output into `vaultforge/.obsidian/plugins/vaultforge/`.

**In the Obsidian desktop app:**

1. **Open folder as vault** → select the `vaultforge/` folder in this repo.
2. **Settings → Community plugins** → disable restricted mode if prompted.
3. Enable **VaultForge** in the plugin list.
4. Open the VaultForge settings pane and toggle the **MCP server** on — a notice confirms the port, and a masked API key field appears. Click the eye icon to reveal it, or the refresh icon to rotate it.
5. Verify the server responds using the `curl` command from [Connecting Claude to the server](#connecting-claude-to-the-server).

**Iterating on code changes:**

Run two terminals:

```bash
# terminal 1 — rebuilds main.js automatically on save
npm run dev

# terminal 2 — run after each meaningful change
npm run sync
```

Obsidian does **not** hot-reload plugin files automatically. After syncing, reload the plugin (toggle it off/on in Community plugins) or reload the whole app (`Ctrl/Cmd+P` → "Reload app without saving") to pick up the new `main.js`.

> **Tip:** installing the community "Hot Reload" plugin (by pjeby) inside the test vault will auto-reload VaultForge whenever `main.js` changes, removing the manual reload step.

**Windows note:** a symlink from the test vault's plugin folder to the project root would avoid the copy step entirely, but `New-Item -ItemType SymbolicLink` requires Administrator rights or Developer Mode enabled on Windows — hence the `npm run sync` copy script instead.

## Project structure

```
vaultforge-obsidian/
├─ manifest.json          # Obsidian plugin manifest
├─ package.json
├─ tsconfig.json
├─ esbuild.config.mjs      # bundles src/main.ts → main.js
├─ version-bump.mjs        # keeps manifest.json/versions.json in sync on release
├─ copy-to-vault.mjs        # deploys build output into the local test vault
├─ styles.css               # chat UI styling (copied into the vault by `npm run sync`)
├─ src/
│  ├─ main.ts              # plugin entry point, settings tab, server/chat lifecycle
│  ├─ tools.ts              # shared vault_read/vault_patch/search_query handlers (used by MCP server + chat)
│  ├─ skills.ts             # Claude Skills discovery (SKILL.md frontmatter) + scaffold creation
│  ├─ mcp/
│  │  └─ server.ts          # MCP server: HTTP transport, auth, tool definitions
│  ├─ claude/
│  │  ├─ client.ts          # Anthropic Messages API client (via Obsidian's requestUrl)
│  │  └─ tools.ts            # tool schemas for the chat assistant + the tool-use loop
│  └─ chat/
│     └─ ChatView.ts         # sidebar chat ItemView
└─ vaultforge/              # bundled test vault
   └─ .obsidian/             # personal/session config (workspace.json etc.) gitignored
      └─ plugins/vaultforge/ # build output (manifest.json/main.js) - tracked; data.json (no secrets) tracked too
```

> The key itself is never in any of these files — it lives in `localStorage`, outside the vault folder entirely. See [Security model](#security-model).

## Roadmap

- [x] Plugin scaffold (esbuild, TypeScript, manifest)
- [x] Local MCP server with `vault_read` / `vault_patch` / `search_query`
- [x] Chat / coding assistance UI inside Obsidian
- [ ] Template generation for notes
- [x] Claude Skills discovery and management from within the vault
