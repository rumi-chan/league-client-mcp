# league-client-mcp

[WIP] An **AI-powered** for the League of Legends Client. It bridges an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server with a [Pengu Loader](https://github.com/PenguLoader/PenguLoader) plugin, allowing AI assistants (Claude, Antigravity, Cursor, etc.) to inspect the League Client's live DOM and inject custom CSS in real time.

<video src="https://github.com/user-attachments/assets/b05a1aeb-8241-4933-bba9-fe31419fdb91" autoplay loop muted playsinline></video>

## How It Works

```
AI Assistant (Claude / Cursor)
        │  MCP tool calls
        ▼
  MCP Server (Node.js)
        │  WebSocket
        ▼
  Pengu Loader Plugin
        │  DOM access & style injection
        ▼
  LoL Client
```

1. The **MCP Server** exposes two tools to the AI assistant via stdio.
2. The **Pengu Loader Plugin** runs inside the League Client and connects back to the MCP Server via WebSocket.
3. When the AI calls a tool, the server forwards the request to the plugin over WebSocket and returns the response.

## Prerequisites

- **Node.js** 18 or higher (`node -v`)
- **pnpm** (plugin) and **npm** (server), or you can use npm for both
- **[Pengu Loader](https://github.com/PenguLoader/PenguLoader)** installed
- **League of Legends Client** running with Pengu Loader active

## Project Structure

```
league-client-mcp/
├── mcp-server/          # Node.js MCP server
│   ├── src/
│   │   └── server.ts    # Main server: WebSocket bridge + MCP tool definitions
│   ├── package.json
│   └── tsconfig.json
│
├── lol-plugin/          # Pengu Loader plugin
│   ├── src/
│   │   └── index.ts     # Plugin: WebSocket client + DOM capture + CSS injection
│   ├── tsup.config.ts   # Build + hot-reload pipeline
│   ├── package.json
│   └── tsconfig.json
```

## Getting Started

### 1. Clone the Repository

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

Before building, update the `penguPath` in `lol-plugin/package.json` to point to your Pengu Loader installation:

```json
"config": {
  "penguPath": "C:\\path\\to\\your\\pengu-loader"
}
```

Then install dependencies and build:

```bash
cd lol-plugin
pnpm install         # or: npm install
pnpm build
```

Copy `dist/index.js` into a plugin folder inside your Pengu Loader `plugins/` directory if not using the dev watch mode (see below).

### 4. Register the MCP Server with Your AI Client

Add the server to your MCP client configuration. For **Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "league-client-mcp-server": {
      "command": "node",
      "args": ["C:/path/to/league-client-mcp/mcp-server/dist/server.js"]
    }
  }
}
```

For **Antigravity / Cursor**, update `mcp_config.json` similarly.

### 5. Run

1. Start **League of Legends** with **Pengu Loader** active.
2. The plugin will automatically connect to `ws://127.0.0.1:8080` when the League Client loads.
3. Open your AI assistant and the two MCP tools will be available.

## Available MCP Tools

### `get_lol_dom_snapshot`

Captures a sanitized snapshot of the current League Client DOM.

**Returns:** HTML string of `document.body` with the following stripped:
- `<script>` and `<noscript>` tags
- SVG `d` and `points` attributes
- `data-*` attributes
- `src`, `href`, `style` values longer than 200 characters (truncated to 80 chars)
- Inline event handler attributes (`on*`)
- SVG element inner content (replaced with `<!-- svg content stripped -->`)

**Use this tool first** to understand the UI structure before writing CSS selectors.

---

### `inject_lol_css`

Injects or replaces CSS in the League Client.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `css` | `string` | Valid CSS to inject. Use `!important` to override existing LoL styles. CSS variables like `--font-display` and `--font-body` are available. |

**Behavior:** Inserts a `<style id="mcp-theme-injector">` tag in `<head>`. Calling the tool again **replaces** the previous CSS entirely.

## Development

The plugin supports watch mode with automatic hot-reload of the League Client on each save:

```bash
cd lol-plugin
pnpm dev
```

Under the hood, `tsup.config.ts`:
1. Rebuilds `src/index.ts` on every file change.
2. Clears and copies the `dist/` output to `<penguPath>/plugins/league-client-mcp-plugin/`.
3. Renames the built `index.js` to `_index.js` and writes a WebSocket proxy `index.js` that notifies a local WebSocket server (port 3000), which triggers Pengu to reload the League Client.

For the MCP server, TypeScript is run directly via `tsx` during development:

```bash
cd mcp-server
npm run dev
```

## WebSocket Protocol

The MCP server and plugin communicate over a simple JSON protocol on `ws://127.0.0.1:8080`.

**Server → Plugin (request):**
```json
{ "requestId": "<uuid>", "type": "GET_DOM" }
{ "requestId": "<uuid>", "type": "INJECT_CSS", "data": ".my-class { color: red; }" }
```

**Plugin → Server (response):**
```json
{ "requestId": "<uuid>", "type": "DOM_SNAPSHOT", "data": "<html>...", "success": true }
{ "requestId": "<uuid>", "type": "CSS_INJECTED", "data": null, "success": true }
{ "requestId": "<uuid>", "error": "Failed to capture DOM: ..." }
```

Requests that receive no response within **15 seconds** are automatically rejected with a timeout error.

## Contributing

Feel free to open a pull request if you have any improvements or new ideas!

## License

[MIT](LICENSE)
