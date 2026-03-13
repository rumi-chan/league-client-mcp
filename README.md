<div align="center">

# ⚔️ league-client-mcp

**A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives AI assistants live, programmatic access to the League of Legends Client**

[![License: MIT](https://img.shields.io/badge/License-MIT-C8AA6E?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-43853d?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3158c6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-7C3AED?style=flat-square)](https://modelcontextprotocol.io)
[![Pengu Loader](https://img.shields.io/badge/Pengu%20Loader-required-C8AA6E?style=flat-square)](https://github.com/PenguLoader/PenguLoader)

<video src="https://github.com/user-attachments/assets/b05a1aeb-8241-4933-bba9-fe31419fdb91" autoplay loop muted playsinline></video>

*Inspect the live DOM · Inject CSS & JavaScript · Call the LCU API · Export finished plugins — all from a chat interface*

</div>

---

## Overview

`league-client-mcp` bridges AI coding assistants to a **live League of Legends Client** via the MCP protocol. It consists of two components:

- **MCP Server** — a Node.js process that exposes tools to any MCP-compatible AI client via stdio
- **Pengu Loader Plugin** — a TypeScript plugin that runs inside the LoL Client (CEF/Chromium), connects back to the server over WebSocket, and executes tool actions directly in the client's DOM

Together they let AI assistants build, iterate, and ship Pengu Loader plugins from a single chat conversation.

---

## Architecture

```
 Claude · Cursor · Gemini · Windsurf · Copilot · Codex
                         │
                   MCP stdio (tool calls)
                         │
                         ▼
              ┌─────────────────────┐
              │   MCP Server        │  Node.js — exposes MCP tools
              │   (mcp-server/)     │  via stdio to any AI client
              └─────────┬───────────┘
                        │  WebSocket  ws://127.0.0.1:8080
                        ▼
              ┌─────────────────────┐
              │  Pengu Loader       │  TypeScript plugin loaded
              │  Plugin             │  inside the LoL Client process
              │  (lol-plugin/)      │  · DOM access & mutation
              └─────────┬───────────┘  · CSS/JS injection
                        │              · LCU fetch()
                        ▼
              ┌─────────────────────┐
              │  League of Legends  │  CEF / Chromium / Ember.js
              │  Client             │
              └─────────────────────┘
```

---

## AI Agent Support

Agent instruction files are pre-configured for all major AI coding tools. Each agent automatically loads its rules file when working in this repository.

| Agent | Rules File | Location |
|---|---|---|
| **Claude Code** | `CLAUDE.md` | Project root |
| **Gemini CLI** | `GEMINI.md` | Project root |
| **OpenAI Codex CLI** | `AGENTS.md` | Project root |
| **OpenCode** | `AGENTS.md` | Project root |
| **Cursor** | `.cursor/rules/league-client.mdc` | `.cursor/rules/` |
| **Windsurf** | `.windsurf/rules/league-client.md` | `.windsurf/rules/` |
| **GitHub Copilot** | `.github/copilot-instructions.md` | `.github/` |

`CLAUDE.md` uses `@AGENTS.md` to import the master instruction document for Claude Code.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 18+** | `node -v` to verify |
| **pnpm** | For the Pengu Loader plugin (`npm i -g pnpm`) |
| **[Pengu Loader](https://github.com/PenguLoader/PenguLoader)** | Installed and active in LoL |
| **League of Legends** | Must be running when using the MCP tools |

---

## Installation

### 1. Clone

```bash
git clone https://github.com/rumi-chan/league-client-mcp.git
cd league-client-mcp
```

### 2. Build the MCP Server

```bash
cd mcp-server
npm install
npm run build
```

### 3. Build the Pengu Loader Plugin

Set your Pengu Loader path in `lol-plugin/package.json`:

```json
"config": {
  "penguPath": "C:\\path\\to\\your\\pengu-loader"
}
```

```bash
cd lol-plugin
pnpm install
pnpm build
```

Copy dist/index.js into a plugin folder inside your Pengu Loader plugins/ directory if not using the dev watch mode (see below).

### 4. Configure Your AI Client

<details>
<summary><b>Claude Desktop</b> — <code>claude_desktop_config.json</code></summary>

```json
{
  "mcpServers": {
    "league-client-mcp": {
      "command": "node",
      "args": ["C:/path/to/league-client-mcp/mcp-server/dist/server.js"]
    }
  }
}
```

</details>

<details>
<summary><b>Cursor / Windsurf</b> — <code>mcp_config.json</code> or MCP settings</summary>

```json
{
  "mcpServers": {
    "league-client-mcp": {
      "command": "node",
      "args": ["C:/path/to/league-client-mcp/mcp-server/dist/server.js"]
    }
  }
}
```

</details>


### 5. Start

1. Launch **League of Legends** with **Pengu Loader** active
2. The plugin connects automatically to `ws://127.0.0.1:8080` on client load
3. Open your AI assistant — all MCP tools will be available

---

## Core Workflow

```
1. get_lol_dom_snapshot      → map the current page (find selectors & component tree)
2. inject_lol_css            → prototype visual changes instantly
3. query_lol_element         → verify a specific selector or computed style
4. inject_lol_plugin         → add persistent JS behaviour with optional CSS
5. reload_lol_plugin         → hot-reload after code changes
6. export_plugin_to_pengu    → write finished plugin to disk
7. reload_lol_client         → activate — plugin now loads on every startup
```

---

## MCP Tools

### DOM Inspection

| Tool | Description |
|---|---|
| `get_lol_dom_snapshot` | Sanitized HTML snapshot of the current page. Strips SVG paths, `data-*` attrs, inline handlers, long `src`/`href` values. **Start here.** |
| `query_lol_element` | Tag, text, bounding rect, and computed styles for a single element by CSS selector. |

### CSS & JavaScript

| Tool | Description |
|---|---|
| `inject_lol_css` | Inject or replace the global `<style>` tag. Each call wipes the previous CSS entirely. Use `!important`. |
| `execute_lol_javascript` | Run an async JS snippet. Supports `return`. Not persistent — does not survive navigation. |

### Plugin Management

| Tool | Description |
|---|---|
| `inject_lol_plugin` | Named persistent plugin (JS + optional CSS). Survives SPA navigation. Re-calling hot-updates it. **Must return a cleanup `() => void`.** |
| `reload_lol_plugin` | Teardown + re-execute a plugin in place. Use while iterating. |
| `remove_lol_plugin` | Remove a plugin and call its cleanup function. |
| `export_plugin_to_pengu` | Write plugin to a `.js` file in the Pengu Loader plugins folder. |

### LCU API

| Tool | Description |
|---|---|
| `lcu_request` | HTTP request to the LCU REST API. No auth headers needed — runs inside the client. Supports GET/POST/PUT/PATCH/DELETE. |

### DOM Interaction

| Tool | Description |
|---|---|
| `click_lol_element` | Click a DOM element by CSS selector. |
| `type_into_lol_element` | Type into an input, dispatching native events. |
| `wait_for_lol_element` | Poll until a selector appears (up to 13 s). |

### Client Utilities

| Tool | Description |
|---|---|
| `get_lol_client_state` | Active URL, viewport, document title, list of injected plugins. |
| `get_lol_performance_metrics` | JS heap, DOM node count, stylesheet count, paint timings. |
| `get_lol_screenshot` | Captures the LeagueClientUx window screenshot into a temporary PNG file. Returns temp file path.Windows-only. |
| `reload_lol_client` | Full client reload. Clears all injected plugins. |

---

## LCU API Reference

1,288 endpoints available — no authentication needed from inside the plugin.

<details>
<summary><b>Summoner · Gameflow · Champion Select</b></summary>

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-summoner/v1/current-summoner` | id, puuid, displayName, summonerLevel |
| GET | `/lol-gameflow/v1/gameflow-phase` | `None`·`Lobby`·`ChampSelect`·`InProgress`·`EndOfGame` |
| GET | `/lol-gameflow/v1/session` | Full session with game data |
| GET | `/lol-champ-select/v1/session` | Picks, bans, timer, actions |
| PATCH | `/lol-champ-select/v1/session/actions/{id}` | Hover/pick/ban a champion |
| POST | `/lol-champ-select/v1/session/actions/{id}/complete` | Lock in action |
| GET | `/lol-champ-select/v1/session/my-selection` | My champion and spells |
| PATCH | `/lol-champ-select/v1/session/my-selection` | Update summoner spells |
| GET | `/lol-champ-select/v1/pickable-champion-ids` | Available picks |
| GET | `/lol-champ-select/v1/bannable-champion-ids` | Available bans |
| GET | `/lol-champ-select/v1/all-grid-champions` | All champions with ownership |

</details>

<details>
<summary><b>Lobby · Matchmaking · Invitations</b></summary>

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-lobby/v2/lobby` | Current lobby (gameConfig, members) |
| POST | `/lol-lobby/v2/lobby` | Create lobby `{queueId}` |
| DELETE | `/lol-lobby/v2/lobby` | Leave/destroy lobby |
| POST | `/lol-lobby/v2/lobby/matchmaking/search` | Start queue |
| DELETE | `/lol-lobby/v2/lobby/matchmaking/search` | Cancel queue |
| GET | `/lol-lobby/v2/received-invitations` | Pending invitations |
| POST | `/lol-lobby/v2/received-invitations/{id}/accept` | Accept invitation |
| POST | `/lol-lobby/v2/lobby/invitations` | Send invitations |
| PUT | `/lol-lobby/v2/lobby/members/localMember/position-preferences` | Set lane preferences |

</details>

<details>
<summary><b>Chat · Friends · Social</b></summary>

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-chat/v1/friends` | Friends with availability and game status |
| GET | `/lol-chat/v1/me` | My chat state |
| PUT | `/lol-chat/v1/me` | Update status (`chat`·`away`·`mobile`·`offline`) |
| GET | `/lol-chat/v1/conversations` | Active conversations |
| POST | `/lol-chat/v1/conversations/{id}/messages` | Send message |
| POST | `/lol-chat/v2/friend-requests` | Send friend request |

</details>

<details>
<summary><b>Ranked · Match History · Mastery</b></summary>

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-ranked/v1/current-ranked-stats` | Tier, division, LP, wins, losses |
| GET | `/lol-ranked/v1/ranked-stats/{puuid}` | Any player's ranked stats |
| GET | `/lol-match-history/v1/products/lol/current-summoner/matches` | Recent matches |
| GET | `/lol-match-history/v1/games/{gameId}` | Detailed game data |
| GET | `/lol-champion-mastery/v1/local-player/champion-mastery` | All mastery data |

</details>

<details>
<summary><b>Runes · Loot · Honor · End of Game</b></summary>

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-perks/v1/pages` | All rune pages |
| GET | `/lol-perks/v1/currentpage` | Active rune page |
| PUT | `/lol-perks/v1/currentpage` | Set active rune page `{id}` |
| GET | `/lol-loot/v1/player-loot` | Loot inventory |
| GET | `/lol-inventory/v1/wallet` | Wallet (RP, BE) |
| GET | `/lol-honor-v2/v1/ballot` | Post-game honor ballot |
| POST | `/lol-honor-v2/v1/honor-player` | Honor a player |
| GET | `/lol-end-of-game/v1/eog-stats-block` | Full post-game stats |

</details>

---

## Plugin Development

### Template

```js
// inject_lol_plugin({ name: 'my-plugin', code: `...`, css: `...` })

// 1. Create your UI
const el = Object.assign(document.createElement('div'), { id: 'my-plugin' });
Object.assign(el.style, {
  position: 'fixed', top: '10px', right: '10px',
  zIndex: '99999', background: 'rgba(0,0,0,0.85)',
  color: 'var(--color-gold-2)', fontFamily: 'var(--font-body)',
  padding: '8px 12px', borderRadius: '4px', pointerEvents: 'none'
});
document.body.appendChild(el);

// 2. Fetch LCU data
async function render() {
  const s = await fetch('/lol-summoner/v1/current-summoner').then(r => r.json());
  el.textContent = `${s.displayName} — Lv.${s.summonerLevel}`;
}

// 3. Re-render on SPA navigation (Ember.js DOM is async — debounce 350 ms)
const obs = new MutationObserver(() => {
  clearTimeout(window._myTimer);
  window._myTimer = setTimeout(render, 350);
});
obs.observe(document.body, { childList: true, subtree: false });

const interval = setInterval(render, 5000);
render();

// 4. REQUIRED: return cleanup
return () => {
  obs.disconnect();
  clearInterval(interval);
  clearTimeout(window._myTimer);
  document.getElementById('my-plugin')?.remove();
};
```

### Key Patterns

```js
// Persistent storage
await DataStore.set('config', { theme: 'dark' });
const cfg = await DataStore.get('config') ?? {};

// LCU fetch inside a plugin (no auth needed)
const phase = await fetch('/lol-gameflow/v1/gameflow-phase').then(r => r.json());
if (phase === 'ChampSelect') { /* show overlay */ }
```

### CSS Design Tokens

```css
/* Always use !important — LoL CSS is heavily layered */
.my-element {
  font-family: var(--font-display) !important;  /* Beaufort for LOL */
  color: var(--color-gold-2) !important;        /* LoL gold */
  background: var(--color-grey-6) !important;   /* near-black */
}
```

| Token | Description |
|---|---|
| `--font-display` | Heading font — Beaufort for LOL |
| `--font-body` | Body font — Spiegel |
| `--color-gold-{1–5}` | Gold palette (lightest → darkest) |
| `--color-blue-{1–6}` | Blue palette |
| `--color-grey-{1–6}` | Neutral palette (near-white → near-black) |

---

## Development Mode

The plugin supports watch mode with automatic hot-reload on every save:

```bash
cd lol-plugin
pnpm dev
```

`tsup.config.ts` rebuilds on change, copies the output to the Pengu plugins directory, and signals a client reload via a local WebSocket on port 3000.

For the MCP server:

```bash
cd mcp-server
npm run dev   # runs via tsx, no build step
```

---

## Project Structure

```
league-client-mcp/
├── mcp-server/                 # Node.js MCP server
│   └── src/server.ts           # WebSocket bridge + MCP tool definitions
│
├── lol-plugin/                 # Pengu Loader plugin
│   └── src/index.ts            # WS client + tool implementations (DOM/CSS/JS/LCU)
│
├── .cursor/rules/              # Cursor agent rules
├── .windsurf/rules/            # Windsurf agent rules
├── .github/                    # GitHub Copilot instructions
├── AGENTS.md                   # Codex CLI · OpenCode (master doc)
├── CLAUDE.md                   # Claude Code
└── GEMINI.md                   # Gemini CLI
```

---

## Contributing

Pull requests are welcome! For large changes, open an issue first to discuss scope.

## License

[MIT](LICENSE)

