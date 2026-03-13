# League Client MCP — Agent Instructions

You are connected to a live **League of Legends Client** via the `league-client-mcp` MCP server.
The server bridges tool calls to a Pengu Loader plugin running inside the LoL Client (CEF/Chromium)
over WebSocket at `ws://127.0.0.1:8080`. All tools communicate synchronously.

## Architecture

```
GitHub Copilot  ──MCP stdio──►  MCP Server (Node.js)
                                     │  WebSocket ws://127.0.0.1:8080
                                     ▼
                          Pengu Loader Plugin  (inside LoL Client)
                                     │  DOM · CSS · JS · LCU fetch()
                                     ▼
                          League of Legends Client  (CEF / Chromium / Ember.js)
```

**Prerequisites:** League of Legends must be running with Pengu Loader active. The plugin
auto-connects on client load. All 16 tools are unavailable until the plugin connects.

---

## Core Workflow

The primary use case is **Pengu Loader plugin and theme development**:

```
1. get_lol_dom_snapshot      → map the current page (selectors, hierarchy)
2. inject_lol_css            → prototype a style change instantly
3. query_lol_element         → verify a selector / computed style
4. inject_lol_plugin         → add JS behaviour alongside CSS
5. reload_lol_plugin         → iterate after updating code
6. export_plugin_to_pengu    → persist the finished plugin to disk
7. reload_lol_client         → activate the exported plugin permanently
```

---

## Tool Reference

### DOM Inspection

**`get_lol_dom_snapshot`** — Sanitized HTML snapshot of the active page. SVG paths, `data-*`
attributes, inline event handlers, and long `src`/`href` values are stripped.
**Start every session here.** No parameters.

**`query_lol_element`** — Tag, text content, bounding rect, computed styles for one element.
Use after you know the selector to verify it — faster than a full snapshot.

| Parameter | Type | Description |
|---|---|---|
| `selector` | `string` | CSS selector |
| `index` | `number?` | Which match to inspect (default 0) |
| `attributes` | `string[]?` | Additional HTML attributes to read |

### CSS & JavaScript

**`inject_lol_css`** — Injects or **replaces** the global `<style>` tag. Each call wipes the
previous CSS entirely. Use `!important` on all declarations.

| Parameter | Type | Description |
|---|---|---|
| `css` | `string` | Full CSS string |

**`execute_lol_javascript`** — One-off async JS snippet. Use `return` to send a value back.
Not persistent — does not survive SPA navigation.

| Parameter | Type | Description |
|---|---|---|
| `code` | `string` | JS code to execute |

### Plugin Management

**`inject_lol_plugin`** — Persistent named plugin with optional CSS. Survives navigation.
Calling with the same name performs a hot update. Return a cleanup `() => void`.

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Unique plugin identifier |
| `code` | `string` | JS code; return cleanup function |
| `css` | `string?` | CSS scoped to this plugin |

**`remove_lol_plugin`** / **`reload_lol_plugin`** — Remove (cleanup + destroy) or teardown +
re-execute a named plugin.

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Plugin name |

**`export_plugin_to_pengu`** — Write plugin to disk as a Pengu Loader `.js` module.

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Plugin to export |
| `fileName` | `string?` | Output filename without `.js` |
| `penguPluginsPath` | `string?` | Plugins folder (default: `C:\Program Files\Pengu Loader\plugins`) |

### LCU API

**`lcu_request`** — HTTP request to the LCU REST API. Runs inside the client — no auth headers.

| Parameter | Type | Description |
|---|---|---|
| `method` | `GET\|POST\|PUT\|PATCH\|DELETE` | HTTP method (default `GET`) |
| `endpoint` | `string` | API path e.g. `/lol-summoner/v1/current-summoner` |
| `body` | `any?` | JSON body for POST/PUT/PATCH |

### DOM Interaction

**`click_lol_element`** — Click by CSS selector. **`type_into_lol_element`** — Type into an
input (dispatches native events). **`wait_for_lol_element`** — Poll until selector appears.

Navigation pattern:
```js
click_lol_element(".lol-navigation-item[data-id='profile']")
wait_for_lol_element(".profile-wrapper", { visible: true })
get_lol_dom_snapshot()
```

### Client Utilities

**`get_lol_client_state`** — Active URL, viewport, document title, list of injected plugins.
**`get_lol_performance_metrics`** — JS heap, DOM node count, stylesheet count, paint timings.
**`get_lol_screenshot`** — Captures `LeagueClientUx` into a temporary PNG file and returns temp path + auto-delete timing. Windows-only.
**`reload_lol_client`** — Full client reload; clears all injected plugins.

---

## LCU API — Comprehensive Reference

1,288 total paths available. No authentication required from inside the plugin.

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
| GET | `/lol-gameflow/v1/session` | Full session with game data and champion info |
| POST | `/lol-gameflow/v1/reconnect` | Reconnect to in-progress game |
| POST | `/lol-gameflow/v1/spectate/launch` | Launch spectate |

### Champion Select
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-champ-select/v1/session` | Picks, bans, timer, actions, team composition |
| PATCH | `/lol-champ-select/v1/session/actions/{id}` | Hover/pick/ban `{championId}` |
| POST | `/lol-champ-select/v1/session/actions/{id}/complete` | Lock in action |
| GET | `/lol-champ-select/v1/session/my-selection` | My champion, spell1Id, spell2Id |
| PATCH | `/lol-champ-select/v1/session/my-selection` | Update summoner spells |
| POST | `/lol-champ-select/v1/session/my-selection/reroll` | Reroll (ARAM) |
| GET | `/lol-champ-select/v1/pickable-champion-ids` | Champions available to pick |
| GET | `/lol-champ-select/v1/bannable-champion-ids` | Champions available to ban |
| GET | `/lol-champ-select/v1/session/timer` | Phase and `timeLeftInPhase` |
| GET | `/lol-champ-select/v1/all-grid-champions` | All champions with ownership flags |
| POST | `/lol-champ-select/v1/session/bench/swap/{championId}` | Swap bench champ (ARAM) |
| GET | `/lol-champ-select/v1/skin-carousel-skins` | Owned skins for current champion |

### Lobby
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-lobby/v2/lobby` | Current lobby (gameConfig, members, invitations) |
| POST | `/lol-lobby/v2/lobby` | Create lobby `{queueId}` |
| DELETE | `/lol-lobby/v2/lobby` | Leave/destroy lobby |
| POST | `/lol-lobby/v2/lobby/matchmaking/search` | Start queue |
| DELETE | `/lol-lobby/v2/lobby/matchmaking/search` | Cancel queue |
| GET | `/lol-lobby/v2/received-invitations` | Pending invitations |
| POST | `/lol-lobby/v2/received-invitations/{id}/accept` | Accept invitation |
| POST | `/lol-lobby/v2/received-invitations/{id}/decline` | Decline invitation |
| POST | `/lol-lobby/v2/lobby/invitations` | Send invitations `[{toSummonerId}]` |
| POST | `/lol-lobby/v2/lobby/members/{summonerId}/kick` | Kick member |
| PUT | `/lol-lobby/v2/lobby/members/localMember/position-preferences` | Set lane preferences |
| POST | `/lol-lobby/v2/play-again` | Start new lobby after game |

### Chat & Social
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-chat/v1/friends` | Friends with availability, game status, rank |
| GET | `/lol-chat/v1/friend-counts` | Online/total counts |
| GET | `/lol-chat/v1/me` | My chat state (availability, statusMessage) |
| PUT | `/lol-chat/v1/me` | Update status (`chat`·`away`·`mobile`·`offline`) |
| GET | `/lol-chat/v1/conversations` | Active conversations |
| POST | `/lol-chat/v1/conversations` | Start new conversation |
| GET | `/lol-chat/v1/conversations/{id}/messages` | Message history |
| POST | `/lol-chat/v1/conversations/{id}/messages` | Send message |
| DELETE | `/lol-chat/v1/friends/{id}` | Remove friend |
| POST | `/lol-chat/v2/friend-requests` | Send friend request |

### Ranked
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-ranked/v1/current-ranked-stats` | Tier, division, LP, wins, losses per queue |
| GET | `/lol-ranked/v1/ranked-stats/{puuid}` | Any player's ranked stats by PUUID |
| GET | `/lol-ranked/v1/current-lp-change-notification` | LP change from last game |
| GET | `/lol-ranked/v1/league-ladders/{puuid}` | Leaderboard position |

### Match History
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-match-history/v1/products/lol/current-summoner/matches` | Recent matches |
| GET | `/lol-match-history/v1/products/lol/{puuid}/matches` | Any player's history |
| GET | `/lol-match-history/v1/games/{gameId}` | Detailed game data |
| GET | `/lol-match-history/v1/recently-played-summoners` | Recent teammates/opponents |

### Champion Mastery
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-champion-mastery/v1/local-player/champion-mastery` | All mastery points by champion |
| GET | `/lol-champion-mastery/v1/local-player/champion-mastery-score` | Total mastery score |
| POST | `/lol-champion-mastery/v1/scouting` | Mastery scouting for champion list |

### Runes (Perks)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-perks/v1/pages` | All rune pages |
| POST | `/lol-perks/v1/pages` | Create rune page |
| DELETE | `/lol-perks/v1/pages/{id}` | Delete rune page |
| PUT | `/lol-perks/v1/pages/{id}` | Update rune page |
| GET | `/lol-perks/v1/currentpage` | Active rune page |
| PUT | `/lol-perks/v1/currentpage` | Set active page by ID |
| GET | `/lol-perks/v1/recommended-pages/champion/{cId}/position/{pos}/map/{mapId}` | Recommended page |

### Item Sets
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-item-sets/v1/item-sets/{summonerId}/sets` | All item sets |
| POST | `/lol-item-sets/v1/item-sets/{summonerId}/sets` | Create item set |
| PUT | `/lol-item-sets/v1/item-sets/{summonerId}/sets` | Update item sets |

### Loot & Economy
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-loot/v1/player-loot` | All loot inventory |
| POST | `/lol-loot/v1/recipes/{recipeName}/craft` | Craft loot |
| GET | `/lol-inventory/v1/wallet` | Wallet (RP, BE) |
| GET | `/lol-champions/v1/inventories/{summonerId}/champions` | Owned champions |
| GET | `/lol-champions/v1/inventories/{summonerId}/champions/{championId}/skins` | Owned skins |

### Honor
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-honor-v2/v1/ballot` | Post-game honor ballot |
| POST | `/lol-honor-v2/v1/honor-player` | Honor a player |
| GET | `/lol-honor-v2/v1/profile` | Honor level and progress |

### End of Game / Post-Game
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-end-of-game/v1/eog-stats-block` | Full post-game stats block |
| POST | `/lol-end-of-game/v1/state/dismiss-stats` | Dismiss post-game screen |

### Missions & Clash
| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-missions/v1/missions` | Active missions |
| GET | `/lol-clash/v1/player` | Clash eligibility |
| GET | `/lol-clash/v1/tournament-summary` | Active tournaments |

---

## Writing Plugin Code

### Plugin conventions

Plugin code runs as an `AsyncFunction` inside CEF — `await` works everywhere.
**Always return a cleanup function** so `remove_lol_plugin` and `reload_lol_plugin` work correctly:

```js
const interval = setInterval(render, 5000);
const observer = new MutationObserver(() => {
  clearTimeout(window._pluginTimer);
  window._pluginTimer = setTimeout(render, 350);
});
observer.observe(document.body, { childList: true, subtree: false });
render();

return () => {
  clearInterval(interval);
  observer.disconnect();
  clearTimeout(window._pluginTimer);
  document.getElementById('my-plugin')?.remove();
};
```

### Key patterns

**SPA navigation** — debounce MutationObserver ~350 ms (Ember DOM updates are async):
```js
const obs = new MutationObserver(() => {
  clearTimeout(window._t);
  window._t = setTimeout(renderUI, 350);
});
obs.observe(document.body, { childList: true, subtree: false });
```

**LCU data inside a plugin** — use `fetch()` directly (no auth needed):
```js
const res = await fetch('/lol-summoner/v1/current-summoner');
const summoner = await res.json();
```

**Persistent storage** — Pengu DataStore:
```js
await DataStore.set('my-key', { value: 42 });
const data = await DataStore.get('my-key');
```

**Overlay/HUD positioning**:
```js
const el = document.createElement('div');
el.id = 'my-hud';
Object.assign(el.style, {
  position: 'fixed', top: '10px', right: '10px',
  zIndex: '99999', pointerEvents: 'none'
});
document.body.appendChild(el);
```

---

## CSS Conventions

- **Always use `!important`** — LoL's CSS is heavily layered
- `position: fixed; z-index: 99999+` for overlays
- Scope selectors tightly to avoid breaking unrelated UI

### Design Tokens

| Variable | Description |
|---|---|
| `--font-display` | Heading font (Beaufort for LOL) |
| `--font-body` | Body font (Spiegel) |
| `--color-gold-1` to `--color-gold-5` | Gold palette (lightest → darkest) |
| `--color-blue-1` to `--color-blue-6` | Blue palette (lightest → darkest) |
| `--color-grey-1` to `--color-grey-6` | Neutral palette (near-white → near-black) |

### Common Selectors

| Selector | Element |
|---|---|
| `.lol-navigation` | Main navigation wrapper |
| `.screen-root.active` | Active page root |
| `.profile-wrapper` | Profile page |
| `.lol-uikit-full-page-scroll` | Main scrollable content |
| `lol-uikit-flat-button[data-button-type='primary']` | Primary action button |
| `.champion-select` | Champion select phase |
| `.champ-select-action-content` | Champ select action bar |
| `.chat-typeahead-input` | Chat input |
| `.activity-center__header_title` | Activity center header |
| `.match-history-container` | Match history list |
| `.player-name-cell` | Player name in end-of-game |
| `[data-test-id='end-of-game-victory']` | Victory banner |

---

## Performance & Debugging

- Run `get_lol_performance_metrics` before and after injecting a heavy plugin to detect JS heap regressions
- Run `get_lol_client_state` to confirm which page you're on and which plugins are running
- JS errors in plugin code are returned in the tool response — read carefully before retrying
- DOM node count over ~5000 can hurt performance — keep overlays lightweight
- If the client feels unresponsive, call `reload_lol_client` to return to a clean state

---

## Exporting Plugins

When a plugin is ready for permanent use:
1. `export_plugin_to_pengu(name, fileName?)` — writes a self-contained `.js` file to the plugins folder
2. `reload_lol_client()` — activates it; auto-loads on every client start without the MCP bridge

The exported file has proper `init()` and `load()` exports with JS and CSS bundled together.

---

## Important Constraints

- **CEF/Chromium** — ES2020+ JS supported; no browser extension APIs or Node.js built-ins
- **`inject_lol_css` is shared** — each call replaces everything; use `inject_lol_plugin` `css` param for independent style blocks  
- **Injected plugins are cleared on reload** — only `export_plugin_to_pengu` + `reload_lol_client` makes them permanent
- **Ember.js async DOM** — always debounce reads after navigation; use `wait_for_lol_element` when needed
- **LCU auth** — no auth headers needed when calling `fetch()` from inside the plugin
- **WebSocket timeout** — tool calls fail after 15 s if LoL Client or Pengu Loader is not running
- **DataStore** — `DataStore.set(key, value)` / `DataStore.get(key)` available in all plugin contexts
