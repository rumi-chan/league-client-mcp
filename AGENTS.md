# League Client MCP — Agent Instructions

> Recognized by: **OpenAI Codex CLI**, **OpenCode**, **Cursor**, **Windsurf**, **Aider**, and any
> agent that reads `AGENTS.md` from the project root.

You are working with a **live League of Legends Client** via the `league-client-mcp` MCP server.
The server bridges AI tool calls to a Pengu Loader plugin running inside the LoL Client
(CEF/Chromium) over WebSocket at `ws://127.0.0.1:8080`.

---

## Architecture

```
AI Agent  ──MCP stdio──►  MCP Server (Node.js)
                               │  WebSocket ws://127.0.0.1:8080
                               ▼
                    Pengu Loader Plugin  (inside LoL Client)
                               │  DOM · CSS · JS · LCU fetch()
                               ▼
                    League of Legends Client  (CEF / Chromium / Ember.js)
```

**Prerequisites:** League of Legends must be running with Pengu Loader active. The plugin
auto-connects on client load. All 16 tools will be unavailable until the plugin connects.

---

## Standard Workflow

```
1. get_lol_dom_snapshot      → map the current page (selectors, component hierarchy)
2. inject_lol_css            → prototype visual changes instantly (replaced on each call)
3. query_lol_element         → verify selector, computed style, or bounding rect
4. inject_lol_plugin         → add persistent JS behaviour with optional CSS
5. reload_lol_plugin         → iterate after updating code (teardown + re-execute)
6. export_plugin_to_pengu    → write finished plugin to disk as a Pengu Loader module
7. reload_lol_client         → activate the exported plugin permanently
```

---

## Tool Reference

### DOM Inspection

#### `get_lol_dom_snapshot`
Returns a sanitized HTML snapshot of the active page. SVG path data, `data-*` attributes,
inline event handlers, and long `src`/`href` values are stripped to keep output lean.
**Start every session here** to discover selectors before writing any CSS or JS.
_No parameters._

#### `query_lol_element`
Returns tag, text content, bounding rect, and computed styles for one specific element.
Use this when you already know the selector and just need to verify it — much faster than
a full snapshot.

| Parameter | Type | Description |
|---|---|---|
| `selector` | `string` | CSS selector |
| `index` | `number?` | Which match to inspect (default 0) |
| `attributes` | `string[]?` | Extra HTML attributes to read back |

---

### CSS & JavaScript

#### `inject_lol_css`
Injects or **replaces** a single global `<style>` tag. Each call replaces the previous CSS
entirely. Use `!important` on every declaration — LoL layers its own styles heavily.

| Parameter | Type | Description |
|---|---|---|
| `css` | `string` | Full CSS string to inject |

#### `execute_lol_javascript`
Executes an async JS snippet inside the client and returns the result. `await` is supported.
**Not persistent** — does not survive SPA navigation. Use `return` to get a value back.

| Parameter | Type | Description |
|---|---|---|
| `code` | `string` | JS to execute. `return` the value you want back. |

---

### Plugin Management

#### `inject_lol_plugin`
Injects a **named, persistent** plugin. Survives SPA navigation. Calling again with the same
`name` hot-updates it in place (teardown + re-execute). Pass both `code` and `css` to keep
styling scoped to the plugin's own `<style>` tag (independent of `inject_lol_css`).

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Unique plugin identifier |
| `code` | `string` | JS code. **Must `return` a `() => void` cleanup function.** |
| `css` | `string?` | CSS injected as a scoped `<style>` tag for this plugin |

#### `remove_lol_plugin`
Removes a plugin and calls its cleanup function.

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Plugin name to remove |

#### `reload_lol_plugin`
Tears down and re-executes a plugin in place without affecting others. Use during iteration.

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Plugin name to reload |

#### `export_plugin_to_pengu`
Exports an injected plugin to a self-contained Pengu Loader `.js` file. After
`reload_lol_client`, the file auto-loads on every startup without the MCP bridge.

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Name of the injected plugin to export |
| `fileName` | `string?` | Output filename without `.js` (defaults to plugin name) |
| `penguPluginsPath` | `string?` | Plugins folder path (default: `C:\Program Files\Pengu Loader\plugins`) |

---

### LCU API

#### `lcu_request`
HTTP requests to the League Client Update REST API. Runs inside the client process — no
authentication headers needed.

| Parameter | Type | Description |
|---|---|---|
| `method` | `GET\|POST\|PUT\|PATCH\|DELETE` | HTTP method (default `GET`) |
| `endpoint` | `string` | API path, e.g. `/lol-summoner/v1/current-summoner` |
| `body` | `any?` | Body for POST/PUT/PATCH |

---

### DOM Interaction

#### `click_lol_element`
Clicks a DOM element by CSS selector.

| Parameter | Type | Description |
|---|---|---|
| `selector` | `string` | CSS selector |
| `index` | `number?` | Which match to click (default 0) |

#### `type_into_lol_element`
Types text into an input or textarea. Dispatches native `input`/`change` events so Ember
and React frameworks pick it up correctly.

| Parameter | Type | Description |
|---|---|---|
| `selector` | `string` | Input selector |
| `text` | `string` | Text to type |
| `clear` | `boolean?` | Clear existing value first (default `false`) |

#### `wait_for_lol_element`
Polls until a CSS selector appears in the DOM. Use immediately after `click_lol_element` to
wait for SPA navigation to complete.

| Parameter | Type | Description |
|---|---|---|
| `selector` | `string` | Selector to wait for |
| `timeout` | `number?` | Max wait in ms (default 10 000, max 13 000) |
| `visible` | `boolean?` | Also require non-zero bounding dimensions |

---

### Client Utilities

#### `get_lol_client_state`
Returns the active URL, viewport size, document title, and list of currently-injected plugin
names. Use to confirm which page you're on and what's running before injecting.

#### `get_lol_performance_metrics`
Returns JS heap usage, DOM node count, stylesheet count, and paint timings. Run before and
after injecting a heavy plugin to detect regressions. DOM node count > 5 000 may impact
performance.

#### `get_lol_screenshot`
Captures a screenshot of the `LeagueClientUx` window and saves it to a temporary PNG file.
Returns the temp path. Use this to visually verify changes or for debugging.
Windows-only implementation.

#### `reload_lol_client`
Reloads the entire League Client. Clears **all** injected plugins. Use after
`export_plugin_to_pengu` to permanently activate the exported file on every startup.

---

## LCU API — Comprehensive Endpoint Reference

The LCU exposes 1 288 HTTP endpoints. The most useful ones for plugin development are
organized below. All are accessible via `lcu_request` with no auth headers.

### Summoner

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-summoner/v1/current-summoner` | Current summoner (id, puuid, displayName, summonerLevel, profileIconId) |
| GET | `/lol-summoner/v1/summoners/{id}` | Summoner by internal ID |
| GET | `/lol-summoner/v2/summoners/puuid/{puuid}` | Summoner by PUUID |
| GET | `/lol-summoner/v1/current-summoner/rerollPoints` | ARAM reroll points (current, max, rollsRemaining) |
| GET | `/lol-summoner/v1/current-summoner/summoner-profile` | Extended profile (banners, challenges, etc.) |
| PUT | `/lol-summoner/v1/current-summoner/icon` | Change profile icon (body: `{profileIconId}`) |
| POST | `/lol-summoner/v1/current-summoner/name` | Change summoner name |

### Gameflow

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-gameflow/v1/gameflow-phase` | Current phase: `None` · `Lobby` · `Matchmaking` · `ReadyCheck` · `ChampSelect` · `GameStart` · `InProgress` · `WaitingForStats` · `PreEndOfGame` · `EndOfGame` |
| GET | `/lol-gameflow/v1/session` | Full session (gameData, map, queue, playerChampionSelections) |
| GET | `/lol-gameflow/v1/availability` | Whether queuing is currently available |
| POST | `/lol-gameflow/v1/reconnect` | Reconnect to an in-progress game |
| GET | `/lol-gameflow/v1/spectate` | Spectate state info |
| POST | `/lol-gameflow/v1/spectate/launch` | Launch spectator for a game |
| POST | `/lol-gameflow/v2/spectate/launch` | Launch spectator v2 |

### Champion Select

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-champ-select/v1/session` | Full champ select session (actions, bans, picks, timer, phase) |
| PATCH | `/lol-champ-select/v1/session/actions/{id}` | Hover or commit a champion (body: `{championId, type, completed}`) |
| POST | `/lol-champ-select/v1/session/actions/{id}/complete` | Lock in the action |
| GET | `/lol-champ-select/v1/session/my-selection` | My current championId, spell1Id, spell2Id |
| PATCH | `/lol-champ-select/v1/session/my-selection` | Update summoner spells (body: `{spell1Id, spell2Id}`) |
| POST | `/lol-champ-select/v1/session/my-selection/reroll` | ARAM reroll |
| GET | `/lol-champ-select/v1/session/timer` | Timer (phase, timeLeft, internalNowInEpochMs) |
| GET | `/lol-champ-select/v1/pickable-champion-ids` | List of pickable champion IDs |
| GET | `/lol-champ-select/v1/bannable-champion-ids` | List of bannable champion IDs |
| GET | `/lol-champ-select/v1/all-grid-champions` | All champions with ownership & position data |
| GET | `/lol-champ-select/v1/skin-carousel-skins` | Available skins for the currently hovered champion |
| GET | `/lol-champ-select/v1/summoners/{slotId}` | Summoner data for a specific slot (0–9) |
| POST | `/lol-champ-select/v1/session/bench/swap/{championId}` | Swap a bench champion (ARAM) |
| GET | `/lol-champ-select/v1/session/champion-swaps` | Pending champion swap offers |

### Lobby

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-lobby/v2/lobby` | Current lobby (gameConfig, members, localMember, invitations) |
| POST | `/lol-lobby/v2/lobby` | Create lobby (body: `{queueId}`) |
| DELETE | `/lol-lobby/v2/lobby` | Destroy / leave the current lobby |
| POST | `/lol-lobby/v2/lobby/invitations` | Send invitations (body: `[{toSummonerId}]`) |
| GET | `/lol-lobby/v2/received-invitations` | Pending received invitations |
| POST | `/lol-lobby/v2/received-invitations/{invitationId}/accept` | Accept an invitation |
| POST | `/lol-lobby/v2/received-invitations/{invitationId}/decline` | Decline an invitation |
| POST | `/lol-lobby/v2/lobby/matchmaking/search` | Start queue search |
| DELETE | `/lol-lobby/v2/lobby/matchmaking/search` | Cancel queue search |
| GET | `/lol-lobby/v2/lobby/matchmaking/search-state` | Search state (searching, found, etc.) |
| GET | `/lol-lobby/v2/lobby/members` | All lobby members |
| POST | `/lol-lobby/v2/lobby/members/{summonerId}/kick` | Kick a member |
| POST | `/lol-lobby/v2/lobby/members/{summonerId}/promote` | Promote to host |
| PUT | `/lol-lobby/v2/lobby/members/localMember/position-preferences` | Set lane preferences (body: `{firstPreference, secondPreference}`) |
| POST | `/lol-lobby/v2/play-again` | Start a new lobby after game ends |
| POST | `/lol-lobby/v2/matchmaking/quick-search` | Quick-play search |

### Chat & Social

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-chat/v1/friends` | All friends (id, name, availability, gameStatus, summonerId) |
| GET | `/lol-chat/v1/friend-counts` | Counts: online, inGame, mobile, total |
| GET | `/lol-chat/v1/me` | My chat state (availability, statusMessage, icon, summonerName) |
| PUT | `/lol-chat/v1/me` | Update status message / availability (`chat`\|`away`\|`mobile`\|`offline`) |
| GET | `/lol-chat/v1/conversations` | All active conversations |
| POST | `/lol-chat/v1/conversations` | Start a new conversation (body: `{targetSummonerId}`) |
| GET | `/lol-chat/v1/conversations/{id}/messages` | Message history for a conversation |
| POST | `/lol-chat/v1/conversations/{id}/messages` | Send a message (body: `{body, type}`) |
| GET | `/lol-chat/v1/friend-groups` | Friend groups / folders |
| POST | `/lol-chat/v1/friend-groups` | Create a friend group |
| DELETE | `/lol-chat/v1/friends/{id}` | Remove a friend |
| POST | `/lol-chat/v2/friend-requests` | Send a friend request (body: `{name, gameTag}`) |
| GET | `/lol-chat/v2/friend-requests` | Pending outgoing friend requests |

### Ranked

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-ranked/v1/current-ranked-stats` | Full ranked stats: tier, division, LP, wins, losses per queue |
| GET | `/lol-ranked/v1/ranked-stats/{puuid}` | Ranked stats for any player by PUUID |
| GET | `/lol-ranked/v1/league-ladders/{puuid}` | Challenger/GrandMaster ladder position |
| GET | `/lol-ranked/v1/current-lp-change-notification` | LP gain/loss from the last game |
| GET | `/lol-ranked/v1/notifications` | Rank-up / tier-change notifications |
| GET | `/lol-ranked/v1/eos-notifications` | End-of-season reward eligibility notifications |
| GET | `/lol-ranked/v2/tiers` | All available tier metadata |

### Match History

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-match-history/v1/products/lol/current-summoner/matches` | Recent matches list (begIndex, endIndex query params) |
| GET | `/lol-match-history/v1/products/lol/{puuid}/matches` | Matches for any player by PUUID |
| GET | `/lol-match-history/v1/games/{gameId}` | Full detailed game data |
| GET | `/lol-match-history/v1/game-timelines/{gameId}` | Game timeline with frame-by-frame events |
| GET | `/lol-match-history/v1/recently-played-summoners` | Recent teammates and opponents |

### Champion Mastery

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-champion-mastery/v1/local-player/champion-mastery` | All mastery data per champion (points, level, lastPlayTime) |
| GET | `/lol-champion-mastery/v1/local-player/champion-mastery-score` | Total mastery score |
| GET | `/lol-champion-mastery/v1/local-player/champion-mastery-sets-and-rewards` | Mastery milestones and rewards |
| POST | `/lol-champion-mastery/v1/scouting` | Mastery scouting for a list of champions |
| POST | `/lol-champion-mastery/v1/{puuid}/champion-mastery-view/top` | Top champions for any PUUID |

### Runes (Perks)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-perks/v1/pages` | All rune pages |
| POST | `/lol-perks/v1/pages` | Create a rune page |
| DELETE | `/lol-perks/v1/pages/{id}` | Delete a rune page |
| PUT | `/lol-perks/v1/pages/{id}` | Update a rune page |
| GET | `/lol-perks/v1/currentpage` | Currently active rune page |
| PUT | `/lol-perks/v1/currentpage` | Set active rune page (body: `{id}`) |
| GET | `/lol-perks/v1/perks` | All available runes and their IDs |
| GET | `/lol-perks/v1/inventory` | Owned rune slots count |
| GET | `/lol-perks/v1/recommended-pages/champion/{championId}/position/{position}/map/{mapId}` | Recommended rune page for a champion/position |
| GET | `/lol-perks/v1/recommended-champion-positions` | Recommended positions for rune recommendations |

### Item Sets

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-item-sets/v1/item-sets/{summonerId}/sets` | All item sets for a summoner |
| POST | `/lol-item-sets/v1/item-sets/{summonerId}/sets` | Create an item set |
| PUT | `/lol-item-sets/v1/item-sets/{summonerId}/sets` | Update item sets |

### Loot & Hextech

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-loot/v1/player-loot` | Full loot inventory (capsules, chests, shards, etc.) |
| GET | `/lol-loot/v1/player-loot-map` | Loot inventory as a map keyed by lootId |
| GET | `/lol-loot/v1/loot-items` | Available loot catalog |
| GET | `/lol-loot/v1/player-loot/{lootId}` | Single loot item details |
| GET | `/lol-loot/v1/recipes/initial-item/{lootId}` | Available recipes for a loot item |
| POST | `/lol-loot/v1/recipes/{recipeName}/craft` | Craft by recipe name |
| GET | `/lol-loot/v1/loot-odds/{recipeName}` | Drop odds for a recipe |
| GET | `/lol-loot/v1/milestones` | Milestone event progress |

### Inventory & Economy

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-inventory/v1/wallet` | Full wallet (RP, BE, Orange Essence, etc.) |
| GET | `/lol-inventory/v1/wallet/{currencyType}` | Balance for a specific currency type |
| GET | `/lol-inventory/v1/inventory` | Full owned inventory |
| GET | `/lol-inventory/v1/inventory/emotes` | Owned emotes |
| GET | `/lol-champions/v1/inventories/{summonerId}/champions` | All owned champions |
| GET | `/lol-champions/v1/inventories/{summonerId}/champions/{championId}/skins` | Owned skins for a specific champion |
| GET | `/lol-champions/v1/inventories/{summonerId}/champions-minimal` | Minimal champion ownership data |
| GET | `/lol-collections/v1/inventories/{summonerId}/ward-skins` | Owned ward skins |
| GET | `/lol-collections/v1/inventories/{summonerId}/spells` | Owned summoner spells |

### Honor

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-honor-v2/v1/ballot` | Post-game honor ballot (players eligible to honor) |
| POST | `/lol-honor-v2/v1/honor-player` | Honor a player (body: `{gameId, honorType, summonerId}`) |
| GET | `/lol-honor-v2/v1/profile` | Honor profile and current level (0–5) |
| GET | `/lol-honor-v2/v1/reward-granted` | Pending honor reward notifications |
| GET | `/lol-honor-v2/v1/level-change` | Honor level-up notification data |
| GET | `/lol-honor-v2/v1/mutual-honor` | Mutual honor received notifications |
| GET | `/lol-honor-v2/v1/late-recognition` | Late honor recognition data |
| GET | `/lol-honor-v2/v1/team-choices` | Team voting results |

### End of Game

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-end-of-game/v1/eog-stats-block` | Full post-game stats (kills, deaths, damage, items) |
| GET | `/lol-end-of-game/v1/tft-eog-stats` | TFT-specific end-of-game stats |
| GET | `/lol-end-of-game/v1/champion-mastery-updates` | Champion mastery changes from the last game |
| POST | `/lol-end-of-game/v1/state/dismiss-stats` | Close the post-game screen |

### Missions & Challenges

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-missions/v1/missions` | Active missions list |
| GET | `/lol-missions/v1/series` | Mission series |
| GET | `/lol-missions/v1/data` | Full missions data |
| PUT | `/lol-missions/v1/player/{missionId}` | Update mission opt-in status |

### Clash

| Method | Endpoint | Description |
|---|---|---|
| GET | `/lol-clash/v1/player` | Current player's Clash eligibility and registration |
| GET | `/lol-clash/v1/tournament-summary` | Active tournament summaries |
| GET | `/lol-clash/v1/all-tournaments` | All available tournaments |
| GET | `/lol-clash/v1/player/history` | Clash tournament history |
| POST | `/lol-clash/v1/tournament/{tournamentId}/create-roster` | Create a Clash roster |
| GET | `/lol-clash/v1/scouting/champions` | Scouting champion data for opponents |
| GET | `/lol-clash/v1/scouting/matchhistory` | Scouting match history for opponents |

---

## Plugin Development

### Plugin Template

```js
// inject_lol_plugin({ name: 'my-hud', code: PLUGIN_CODE, css: PLUGIN_CSS })

const PLUGIN_CODE = `
  const overlay = document.createElement('div');
  overlay.id = 'my-hud';
  document.body.appendChild(overlay);

  async function update() {
    const res = await fetch('/lol-summoner/v1/current-summoner');
    const s = await res.json();
    overlay.textContent = s.displayName + ' — Lv.' + s.summonerLevel;
  }

  const interval = setInterval(update, 5000);
  update();

  const obs = new MutationObserver(() => {
    clearTimeout(window._myHudTimer);
    window._myHudTimer = setTimeout(update, 350);
  });
  obs.observe(document.body, { childList: true, subtree: false });

  // REQUIRED: return a cleanup function
  return () => {
    clearInterval(interval);
    obs.disconnect();
    clearTimeout(window._myHudTimer);
    document.getElementById('my-hud')?.remove();
  };
`;
```

### Key Patterns

**Always return a cleanup function** — required for `remove_lol_plugin` and `reload_lol_plugin`:
```js
const interval = setInterval(fn, 1000);
const obs = new MutationObserver(fn);
obs.observe(document.body, { childList: true, subtree: false });
return () => { clearInterval(interval); obs.disconnect(); };
```

**SPA Navigation (debounce MutationObserver by ~350 ms):**
```js
let timer;
const obs = new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(renderUI, 350);
});
obs.observe(document.body, { childList: true, subtree: false });
```

**Inline LCU fetch inside a plugin:**
```js
const data = await fetch('/lol-gameflow/v1/gameflow-phase').then(r => r.json());
if (data === 'ChampSelect') { /* show overlay */ }
```

**Persistent storage via Pengu DataStore:**
```js
await DataStore.set('plugin-config', { theme: 'dark', opacity: 0.8 });
const config = await DataStore.get('plugin-config') ?? {};
```

**Overlay/HUD boilerplate:**
```js
const el = Object.assign(document.createElement('div'), { id: 'my-overlay' });
Object.assign(el.style, {
  position: 'fixed', top: '10px', right: '10px',
  zIndex: '99999', background: 'rgba(0,0,0,0.85)',
  color: '#C8AA6E', fontFamily: 'var(--font-body)',
  padding: '8px 12px', borderRadius: '4px',
  pointerEvents: 'none'
});
document.body.appendChild(el);
```

---

## CSS Guide

### Rules
- **Always use `!important`** — LoL's CSS is deeply layered; without it styles don't apply.
- Scope selectors tightly to avoid breaking unrelated UI.
- `position: fixed; z-index: 99999+` for any overlay or HUD.
- LoL uses Ember.js — class names often include component identifiers; prefer attribute
  selectors (`[data-*]`) for stability.

### CSS Custom Properties (Design Tokens)

| Variable | Description |
|---|---|
| `--font-display` | Heading font — Beaufort for LOL |
| `--font-body` | Body font — Spiegel |
| `--color-gold-1` | Lightest gold (text highlights) |
| `--color-gold-2` | Light gold |
| `--color-gold-3` | Mid gold (borders) |
| `--color-gold-4` | Dark gold |
| `--color-gold-5` | Darkest gold (backgrounds) |
| `--color-blue-1` | Lightest blue (UI accent) |
| `--color-blue-2` | … |
| `--color-blue-3` | Mid blue |
| `--color-blue-4` | … |
| `--color-blue-5` | … |
| `--color-blue-6` | Darkest blue |
| `--color-grey-1` | Near white |
| `--color-grey-2` | Light grey |
| `--color-grey-3` | Mid grey |
| `--color-grey-4` | Dark grey |
| `--color-grey-5` | Very dark grey |
| `--color-grey-6` | Near black |

### Common Selectors

| Selector | Element |
|---|---|
| `.lol-navigation` | Main navigation wrapper |
| `.screen-root.active` | Active page root |
| `.profile-wrapper` | Profile page container |
| `.champion-select` | Champion select phase |
| `.champ-select-action-content` | Bottom action bar in champ select |
| `lol-uikit-flat-button[data-button-type='primary']` | Primary action button |
| `.lobby-button--wrapper` | Lobby play/start button |
| `.lol-uikit-full-page-scroll` | Main scrollable content area |
| `.chat-typeahead-input` | Chat typing input |
| `.activity-center__header_title` | Activity center header |
| `.match-history-container` | Match history list |
| `.player-name-cell` | Player name cells (end of game, lobby) |
| `[data-test-id='end-of-game-victory']` | Victory/defeat banner |

---

## Performance & Debugging

- Run `get_lol_performance_metrics` **before and after** injecting a plugin. JS heap increase
  > 10 MB or DOM node count > 5 000 indicates a leak or heavy DOM usage.
- Run `get_lol_client_state` to confirm which page you are on and which plugins are active.
- JS errors in plugin code are caught and returned in the tool response message — read them
  before retrying.
- If the client is unresponsive, call `reload_lol_client` to reset to a clean state.
- Use `execute_lol_javascript` for quick one-off state reads before writing plugin code.

---

## Important Constraints

| Constraint | Detail |
|---|---|
| Environment | CEF/Chromium — ES2020+ JS supported; no Node.js APIs, no browser extension APIs |
| Persistence | Injected plugins clear on client reload; only `export_plugin_to_pengu` is permanent |
| CSS scope | `inject_lol_css` is a single shared tag — each call replaces the previous |
| Ember.js DOM | DOM updates are async after navigation; always debounce or use `wait_for_lol_element` |
| LCU auth | No auth headers needed — plugin runs inside the client process |
| WebSocket timeout | Tools fail after 15 s if plugin is unreachable (client not running / Pengu inactive) |
| Plugin CSS | Use `inject_lol_plugin`'s `css` param for per-plugin styles to avoid conflicts |
| macOS paths | `penguPluginsPath` default is Windows; macOS users must pass their own path |
