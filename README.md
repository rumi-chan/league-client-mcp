# league-client-mcp

`league-client-mcp` gives an MCP client live access to the League of Legends desktop client.
It is two pieces working together:

- `mcp-server/`: a Node.js MCP server that exposes tools over stdio
- `lol-plugin/`: a Pengu Loader plugin that runs inside the League client and executes those tool calls

With both running, an AI assistant can inspect the DOM, inject CSS or JavaScript, call the
LCU API, interact with the UI, and export finished plugins back to Pengu Loader.

<video src="https://github.com/user-attachments/assets/b05a1aeb-8241-4933-bba9-fe31419fdb91" autoplay loop muted playsinline></video>

## How it works

```text
AI client
  -> MCP over stdio
  -> mcp-server/
  -> WebSocket bridge at ws://127.0.0.1:8080
  -> lol-plugin/ inside the League client
  -> DOM, CSS, JavaScript, and LCU fetch()
```

If League or Pengu Loader is not running, the server has nothing to talk to and the tools will
fail. This repo assumes a live client.

## What you can do with it

- Snapshot the current League page and inspect selectors before changing anything
- Inject CSS to prototype layout or visual changes
- Run one-off JavaScript in the client
- Inject persistent plugins that survive SPA navigation
- Click buttons, type into inputs, and wait for pages to load
- Call the LCU API from inside the client without handling auth yourself
- Export an injected plugin to Pengu Loader so it loads on startup

## Prerequisites

- Node.js 18 or newer
- `pnpm` for the Pengu Loader plugin
- [Pengu Loader](https://github.com/PenguLoader/PenguLoader) installed
- League of Legends running when you want to use the MCP tools

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/rumi-chan/league-client-mcp.git
cd league-client-mcp
```

### 2. Build the MCP server

```bash
cd mcp-server
npm install
npm run build
```

### 3. Build the Pengu Loader plugin

Set the Pengu Loader path in `lol-plugin/package.json`:

```json
"config": {
  "penguPath": "C:\\path\\to\\your\\pengu-loader"
}
```

Then build the plugin:

```bash
cd lol-plugin
pnpm install
pnpm build
```

If you are not using watch mode, copy `lol-plugin/dist/index.js` into a plugin folder inside
Pengu Loader's `plugins` directory.

### 4. Register the MCP server in your client

Any MCP client that can launch a local stdio server should work. The command looks like this:

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

This is the same basic shape used by Claude Desktop, Cursor, Windsurf, Codex CLI, and other
local MCP clients.

## Normal workflow

1. Start League of Legends with Pengu Loader active.
2. Start the MCP server with `npm start` from `mcp-server/`.
3. Connect from your AI client.
4. Map the current page with `get_lol_dom_snapshot`.
5. Prototype styling with `inject_lol_css`.
6. Add behavior with `inject_lol_plugin`.
7. Reload the injected plugin while iterating.
8. Export the finished plugin to Pengu Loader.
9. Reload the League client to make the exported plugin load on startup.

The shortest useful loop usually looks like this:

```text
get_lol_dom_snapshot
inject_lol_css
query_lol_element
inject_lol_plugin
reload_lol_plugin
export_plugin_to_pengu
reload_lol_client
```

## Tool list

There are 16 MCP tools in the server.

### DOM inspection

- `get_lol_dom_snapshot`: returns a sanitized HTML snapshot of the current page
- `query_lol_element`: returns details for one element, including text, bounds, and styles
- `wait_for_lol_element`: waits until a selector appears in the DOM

### CSS and JavaScript

- `inject_lol_css`: replaces the shared global style tag
- `execute_lol_javascript`: runs one-off async JavaScript in the client

### Plugin management

- `inject_lol_plugin`: injects a named persistent plugin with optional scoped CSS
- `reload_lol_plugin`: tears down and re-runs one injected plugin
- `remove_lol_plugin`: removes an injected plugin and calls its cleanup function
- `export_plugin_to_pengu`: writes an injected plugin to Pengu Loader's plugins folder

### Client and UI interaction

- `click_lol_element`: clicks an element by selector
- `type_into_lol_element`: types into an input or textarea and dispatches native events
- `get_lol_client_state`: returns URL, title, viewport, and injected plugin names
- `get_lol_performance_metrics`: reports heap, DOM, stylesheet, and paint data
- `get_lol_screenshot`: saves a screenshot of the League client window on Windows
- `reload_lol_client`: reloads the whole client

### LCU

- `lcu_request`: sends an HTTP request to the League Client Update API from inside the client

For the longer endpoint catalog and agent-specific workflow notes, see
[`AGENTS.md`](AGENTS.md).

## Writing a plugin

Persistent plugins must return a cleanup function. If they do not, reload and removal will break.

```js
const el = Object.assign(document.createElement("div"), { id: "my-plugin" });
document.body.appendChild(el);

async function render() {
  const summoner = await fetch("/lol-summoner/v1/current-summoner").then((r) => r.json());
  el.textContent = `${summoner.displayName} Lv.${summoner.summonerLevel}`;
}

const interval = setInterval(render, 5000);
const observer = new MutationObserver(() => {
  clearTimeout(window.__myPluginTimer);
  window.__myPluginTimer = setTimeout(render, 350);
});

observer.observe(document.body, { childList: true, subtree: false });
render();

return () => {
  clearInterval(interval);
  observer.disconnect();
  clearTimeout(window.__myPluginTimer);
  document.getElementById("my-plugin")?.remove();
};
```

Some practical rules:

- Use `get_lol_dom_snapshot` before guessing selectors
- Use `!important` when injecting CSS into the League client
- Debounce DOM-driven rerenders because the client is a SPA and updates asynchronously
- Prefer `inject_lol_plugin` over raw CSS when you need state, timers, or LCU fetches

## Development mode

For the plugin:

```bash
cd lol-plugin
pnpm dev
```

Watch mode rebuilds on save, copies the output into the configured Pengu Loader plugin
directory, and notifies the client over a local WebSocket on port `3000`.

For the MCP server:

```bash
cd mcp-server
npm run dev
```

That runs the server with `tsx` and skips the build step while you are iterating.

## Repo layout

```text
league-client-mcp/
|-- mcp-server/
|   `-- src/server.ts
|-- lol-plugin/
|   `-- src/index.ts
|-- AGENTS.md
|-- CLAUDE.md
|-- GEMINI.md
|-- .cursor/rules/
|-- .windsurf/rules/
`-- .github/copilot-instructions.md
```

`AGENTS.md` is the main instruction file for this repo. The other agent-specific files point back
to it or adapt it for their own client.

## Notes

- `inject_lol_css` replaces the previous injected stylesheet. It is not additive.
- `export_plugin_to_pengu` exports a plugin that is already injected. It does not build one from disk.
- `get_lol_screenshot` is Windows-only.
- `wait_for_lol_element` is the safer way to handle page changes after a click.

## Contributing

Pull requests are welcome. If you are planning a larger change, open an issue first so the scope
is clear before the work starts.

## License

[MIT](LICENSE)
