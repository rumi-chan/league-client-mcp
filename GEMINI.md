# League Client MCP — Gemini CLI Instructions

> **Gemini CLI** loads this file automatically when you run `gemini` in this directory.

You are working with a **live League of Legends Client** via the `league-client-mcp` MCP
server. The server bridges tool calls to a Pengu Loader plugin running inside the LoL
Client (CEF/Chromium) over WebSocket at `ws://127.0.0.1:8080`.

---

## Architecture

```
Gemini CLI  ──MCP stdio──►  MCP Server (Node.js)
                                │  WebSocket ws://127.0.0.1:8080
                                ▼
                     Pengu Loader Plugin  (inside LoL Client)
                                │  DOM · CSS · JS · LCU fetch()
                                ▼
                     League of Legends Client  (CEF / Chromium / Ember.js)
```

League must be running with Pengu Loader active. The plugin auto-connects on client load.

---

## Standard Workflow

```
1. get_lol_dom_snapshot      → map the current page (selectors, component hierarchy)
2. inject_lol_css            → prototype visual changes (replaced on each call)
3. query_lol_element         → verify selector, computed style, or bounding rect
4. inject_lol_plugin         → add persistent JS behaviour with optional CSS
5. reload_lol_plugin         → iterate after updating code
6. export_plugin_to_pengu    → write finished plugin to disk
7. reload_lol_client         → activate the exported plugin permanently
```

---

## Tool Reference

### DOM Inspection

**`get_lol_dom_snapshot`** — Sanitized HTML snapshot of the active page. SVG paths,
`data-*` attrs, inline handlers, and long `src`/`href` values are stripped.
Start every session here. No parameters.

**`query_lol_element`** — Tag, text, bounding rect, and computed styles for a single element.

| Parameter | Type | Description |
|---|---|---|
| `selector` | `string` | CSS selector |
| `index` | `number?` | Which match (default 0) |
| `attributes` | `string[]?` | Extra attributes to read |

### CSS & JavaScript

**`inject_lol_css`** — Replaces the global `<style>` tag. Use `!important` on all rules.

| `css` | `string` | CSS to inject |

**`execute_lol_javascript`** — One-off async JS execution. Not persistent.

| `code` | `string` | JS to execute. Use `return` to get a value back. |

### Plugin Management

**`inject_lol_plugin`** — Named, persistent plugin. Hot-updates on same name. Return a
cleanup `() => void` — required for reload/remove to work correctly.

| `name` | `string` | Unique plugin ID |
| `code` | `string` | JS code with cleanup return |
| `css` | `string?` | Scoped CSS for this plugin |

**`remove_lol_plugin`** / **`reload_lol_plugin`** — Remove or restart a plugin by name.

**`export_plugin_to_pengu`** — Write plugin to Pengu Loader plugins folder.

| `name` | `string` | Plugin to export |
| `fileName` | `string?` | Output filename without `.js` |
| `penguPluginsPath` | `string?` | Plugins folder (default: `C:\Program Files\Pengu Loader\plugins`) |

### LCU API

**`lcu_request`** — HTTP to the LCU REST API inside the client (no auth needed).

| `method` | `GET\|POST\|PUT\|PATCH\|DELETE` | HTTP method |
| `endpoint` | `string` | API path |
| `body` | `any?` | Request body |

### DOM Interaction

**`click_lol_element`** — Click by selector. `index` selects which match.

**`type_into_lol_element`** — Type into input/textarea. `clear` clears first.

**`wait_for_lol_element`** — Poll until selector appears. `timeout` (ms), `visible` (bool).

### Client Utilities

**`get_lol_client_state`** — Active URL, viewport, title, injected plugin names.

**`get_lol_performance_metrics`** — JS heap, DOM nodes, stylesheet count, paint timings.

**`get_lol_screenshot`** — Captures `LeagueClientUx` into a temporary PNG file and returns temp path. Use this to visually verify changes or for debugging. Windows-only.

**`reload_lol_client`** — Full client reload. Clears all injected plugins.

---

## LCU API Reference

1 288 endpoints total. Most relevant ones:

### Summoner
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-summoner/v1/current-summoner` | id, puuid, displayName, summonerLevel, profileIconId |
| GET | `/lol-summoner/v1/summoners/{id}` | Summoner by internal ID |
| GET | `/lol-summoner/v2/summoners/puuid/{puuid}` | Summoner by PUUID |
| GET | `/lol-summoner/v1/current-summoner/rerollPoints` | ARAM reroll points |
| PUT | `/lol-summoner/v1/current-summoner/icon` | Change profile icon |

### Gameflow
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-gameflow/v1/gameflow-phase` | `None`·`Lobby`·`Matchmaking`·`ReadyCheck`·`ChampSelect`·`GameStart`·`InProgress`·`WaitingForStats`·`PreEndOfGame`·`EndOfGame` |
| GET | `/lol-gameflow/v1/session` | Full session (gameData, map, queue) |
| POST | `/lol-gameflow/v1/reconnect` | Reconnect to in-progress game |
| POST | `/lol-gameflow/v1/spectate/launch` | Launch spectator |

### Champion Select
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-champ-select/v1/session` | Full session (actions, bans, picks, timer) |
| PATCH | `/lol-champ-select/v1/session/actions/{id}` | Hover/pick/ban a champion |
| POST | `/lol-champ-select/v1/session/actions/{id}/complete` | Lock in |
| GET | `/lol-champ-select/v1/session/my-selection` | My current champion and spells |
| PATCH | `/lol-champ-select/v1/session/my-selection` | Update summoner spells |
| GET | `/lol-champ-select/v1/pickable-champion-ids` | Champions available to pick |
| GET | `/lol-champ-select/v1/bannable-champion-ids` | Champions available to ban |
| GET | `/lol-champ-select/v1/session/timer` | Phase and time remaining |
| GET | `/lol-champ-select/v1/all-grid-champions` | All champions with ownership data |

### Lobby
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-lobby/v2/lobby` | Current lobby (gameConfig, members, invitations) |
| POST | `/lol-lobby/v2/lobby` | Create lobby — body: `{queueId}` |
| DELETE | `/lol-lobby/v2/lobby` | Leave/destroy lobby |
| POST | `/lol-lobby/v2/lobby/invitations` | Send invitations |
| GET | `/lol-lobby/v2/received-invitations` | Pending invitations |
| POST | `/lol-lobby/v2/received-invitations/{id}/accept` | Accept invitation |
| POST | `/lol-lobby/v2/lobby/matchmaking/search` | Start queue |
| DELETE | `/lol-lobby/v2/lobby/matchmaking/search` | Cancel queue |
| PUT | `/lol-lobby/v2/lobby/members/localMember/position-preferences` | Set lane preferences |

### Chat & Social
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-chat/v1/friends` | All friends with availability and game status |
| GET | `/lol-chat/v1/friend-counts` | Online/total friend counts |
| GET | `/lol-chat/v1/me` | My chat state |
| PUT | `/lol-chat/v1/me` | Update status message / availability |
| GET | `/lol-chat/v1/conversations` | Active conversations |
| POST | `/lol-chat/v1/conversations/{id}/messages` | Send message |
| POST | `/lol-chat/v2/friend-requests` | Send friend request |

### Ranked
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-ranked/v1/current-ranked-stats` | Tier, division, LP, wins, losses per queue |
| GET | `/lol-ranked/v1/ranked-stats/{puuid}` | Stats for any player |
| GET | `/lol-ranked/v1/current-lp-change-notification` | LP gain/loss from last game |

### Match History
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-match-history/v1/products/lol/current-summoner/matches` | Recent matches |
| GET | `/lol-match-history/v1/games/{gameId}` | Full game data |
| GET | `/lol-match-history/v1/recently-played-summoners` | Recent teammates/opponents |

### Champion Mastery
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-champion-mastery/v1/local-player/champion-mastery` | All mastery by champion |
| GET | `/lol-champion-mastery/v1/local-player/champion-mastery-score` | Total mastery score |

### Runes
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-perks/v1/pages` | All rune pages |
| POST | `/lol-perks/v1/pages` | Create rune page |
| GET | `/lol-perks/v1/currentpage` | Active rune page |
| PUT | `/lol-perks/v1/currentpage` | Set active page (body: `{id}`) |
| GET | `/lol-perks/v1/recommended-pages/champion/{championId}/position/{position}/map/{mapId}` | Recommended page |

### Loot & Inventory
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-loot/v1/player-loot` | Full loot inventory |
| POST | `/lol-loot/v1/recipes/{recipeName}/craft` | Craft loot |
| GET | `/lol-inventory/v1/wallet` | Full wallet balance |
| GET | `/lol-champions/v1/inventories/{summonerId}/champions` | Owned champions |

### Honor & End of Game
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-honor-v2/v1/ballot` | Post-game honor ballot |
| POST | `/lol-honor-v2/v1/honor-player` | Honor a player |
| GET | `/lol-honor-v2/v1/profile` | Honor profile and level |
| GET | `/lol-end-of-game/v1/eog-stats-block` | Post-game stats block |

---

## Plugin Development

### Template
```js
// Always return a cleanup function
const obs = new MutationObserver(() => {
  clearTimeout(window._timer);
  window._timer = setTimeout(render, 350);
});
obs.observe(document.body, { childList: true, subtree: false });

async function render() {
  const phase = await fetch('/lol-gameflow/v1/gameflow-phase').then(r => r.json());
  // update UI based on phase
}

render();

return () => {
  obs.disconnect();
  clearTimeout(window._timer);
  document.getElementById('my-overlay')?.remove();
};
```

### Patterns
- **Cleanup**: always `return () => { ... }` — required for reload/remove
- **Debounce**: wrap MutationObserver callback with 350 ms setTimeout
- **DataStore**: `await DataStore.set('key', value)` / `await DataStore.get('key')`
- **Overlay**: `position: fixed; z-index: 99999; pointer-events: none`

---

## CSS Guide

- Always use `!important`
- CSS variables: `--font-display`, `--font-body`, `--color-gold-{1-5}`, `--color-blue-{1-6}`, `--color-grey-{1-6}`
- Common selectors: `.lol-navigation`, `.screen-root.active`, `.profile-wrapper`, `.champion-select`

---

## Constraints

- CEF/Chromium — ES2020+ only; no Node.js, no browser extension APIs
- `inject_lol_css` replaces entire stylesheet on each call
- Plugins clear on client reload — only `export_plugin_to_pengu` is permanent
- Ember.js DOM is async — debounce or use `wait_for_lol_element`
- Tools timeout after 15 s if the plugin is unreachable
