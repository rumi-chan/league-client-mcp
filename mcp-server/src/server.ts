import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { unlink, writeFile } from "fs/promises";
import { join, basename } from "path";
import { tmpdir } from "os";
const WS_PORT = 8080;
const REQUEST_TIMEOUT_MS = 15_000;
// Reserve 2 s for WebSocket round-trip so wait_for_lol_element never races the bridge timeout
const WAIT_ELEMENT_MAX_MS = REQUEST_TIMEOUT_MS - 2_000;

let pluginClient: WebSocket | null = null;

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pendingRequests = new Map<string, PendingRequest>();

const wss = new WebSocketServer({ port: WS_PORT });

wss.on("listening", () => {
  console.error(`[WS Bridge] Listening on ws://127.0.0.1:${WS_PORT}`);
});

wss.on("connection", (ws, req) => {
  console.error(
    `[WS Bridge] Plugin connected from ${req.socket.remoteAddress}`,
  );
  pluginClient = ws;

  ws.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      const { requestId, type, data, success, error } = message;

      // If message has a requestId, it is a response to a pending request
      if (requestId && pendingRequests.has(requestId)) {
        const pending = pendingRequests.get(requestId)!;
        clearTimeout(pending.timer);
        pendingRequests.delete(requestId);

        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve({ type, data, success });
        }
      } else {
        console.error(`[WS Bridge] Received unmatched message: ${type}`);
      }
    } catch (err) {
      console.error(`[WS Bridge] Failed to parse message:`, err);
    }
  });

  ws.on("close", () => {
    console.error("[WS Bridge] Plugin disconnected");
    if (pluginClient === ws) {
      pluginClient = null;
    }
    // Reject all pending requests
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Plugin disconnected"));
      pendingRequests.delete(id);
    }
  });

  ws.on("error", (err) => {
    console.error("[WS Bridge] WebSocket error:", err.message);
  });
});

/**
 * Send a request to the connected Pengu Plugin and wait for a response.
 */
function sendToPlugin(
  type: string,
  data?: unknown,
): Promise<{ type: string; data: unknown; success?: boolean }> {
  return new Promise((resolve, reject) => {
    if (!pluginClient || pluginClient.readyState !== WebSocket.OPEN) {
      return reject(
        new Error(
          "No plugin connected. Make sure the LoL Client is running with PenguLoader.",
        ),
      );
    }

    const requestId = randomUUID();
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(
        new Error(`Request ${type} timed out after ${REQUEST_TIMEOUT_MS}ms`),
      );
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(requestId, {
      resolve: resolve as (data: unknown) => void,
      reject,
      timer,
    });

    pluginClient.send(JSON.stringify({ requestId, type, data }));
  });
}

function runPowerShell(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ],
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        // Prevent MCP from appearing frozen if PrintWindow/PowerShell hangs.
        timeout: 10_000,
      },
      (error, _stdout, stderr) => {
        if (error) {
          if (error.message.includes("timed out")) {
            reject(
              new Error(
                "Screenshot command timed out after 10s. " +
                  "League Client may be minimized/not responding.",
              ),
            );
            return;
          }
          reject(
            new Error(
              stderr?.trim() ||
                error.message ||
                "PowerShell screenshot command failed",
            ),
          );
          return;
        }
        resolve();
      },
    );
  });
}

const server = new McpServer(
  {
    name: "league-client-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      logging: {},
    },
  },
);

// Tool 1: Get DOM Snapshot
server.registerTool(
  "get_lol_dom_snapshot",
  {
    title: "Get DOM Snapshot",
    description:
      "Captures the current DOM tree of the League of Legends Client. " +
      "Returns a sanitized HTML string (SVG paths, long src attributes, and " +
      "unnecessary attributes are stripped to reduce size). " +
      "Use this to understand the current UI structure before designing CSS.",
    annotations: {
      readOnlyHint: true,
    },
  },
  async () => {
    try {
      const response = (await sendToPlugin("GET_DOM")) as {
        type: string;
        data: string;
        success?: boolean;
      };
      return {
        content: [
          {
            type: "text" as const,
            text: response.data as string,
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool 2: Inject CSS
server.registerTool(
  "inject_lol_css",
  {
    title: "Inject CSS",
    description:
      "Injects or updates CSS styles in the League of Legends Client. " +
      "The CSS will be inserted into a <style> tag in the document head. " +
      "Subsequent calls will replace the previously injected CSS. " +
      "Use !important to override existing League Client styles.",
    inputSchema: z.object({
      css: z
        .string()
        .describe(
          "The CSS string to inject into the LoL Client. " +
            "Use standard CSS syntax. CSS variables like --font-display, " +
            "--font-body are available for theming.",
        ),
    }),
    annotations: {
      idempotentHint: true,
    },
  },
  async ({ css }) => {
    try {
      const response = (await sendToPlugin("INJECT_CSS", css)) as {
        type: string;
        data: unknown;
        success?: boolean;
      };
      return {
        content: [
          {
            type: "text" as const,
            text: response.success
              ? "CSS injected successfully into the LoL Client."
              : "CSS injection completed but status unknown.",
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool 3: Execute JavaScript
server.registerTool(
  "execute_lol_javascript",
  {
    title: "Execute JavaScript",
    description:
      "Executes JavaScript code inside the League of Legends Client context. " +
      "Has access to the DOM, window object, and Pengu Loader APIs. " +
      "Use this to interact with UI elements, read client state, or build dynamic features. " +
      "The code runs via AsyncFunction so you can use await. Returns the result as a string.",
    inputSchema: z.object({
      code: z
        .string()
        .describe(
          "JavaScript code to execute in the LoL Client. " +
            "Can use await. The return value of the last expression will be sent back.",
        ),
    }),
    annotations: {
      openWorldHint: true,
    },
  },
  async ({ code }) => {
    try {
      const response = (await sendToPlugin("EXECUTE_JS", { code })) as {
        type: string;
        data: unknown;
        success?: boolean;
      };
      return {
        content: [
          {
            type: "text" as const,
            text:
              typeof response.data === "string"
                ? response.data
                : JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool 4: LCU API Request
server.registerTool(
  "lcu_request",
  {
    title: "LCU API Request",
    description:
      "Makes HTTP requests to the League Client Update (LCU) REST API. " +
      "The LCU API provides access to game data, summoner info, champion select, " +
      "lobby management, runes, match history, and more. " +
      "Common endpoints: " +
      "/lol-summoner/v1/current-summoner, " +
      "/lol-gameflow/v1/gameflow-phase, " +
      "/lol-champ-select/v1/session, " +
      "/lol-lobby/v2/lobby, " +
      "/lol-chat/v1/friends.",
    inputSchema: z.object({
      method: z
        .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
        .default("GET")
        .describe("HTTP method"),
      endpoint: z
        .string()
        .describe(
          "LCU API endpoint path (e.g. /lol-summoner/v1/current-summoner). " +
            "Must start with /.",
        ),
      body: z
        .any()
        .optional()
        .describe(
          "Request body for POST/PUT/PATCH requests (will be JSON-serialized)",
        ),
    }),
    annotations: {
      openWorldHint: true,
    },
  },
  async ({ method, endpoint, body }) => {
    try {
      const response = (await sendToPlugin("LCU_REQUEST", {
        method,
        endpoint,
        body,
      })) as {
        type: string;
        data: unknown;
        success?: boolean;
      };
      return {
        content: [
          {
            type: "text" as const,
            text:
              typeof response.data === "string"
                ? response.data
                : JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool 5: Inject JavaScript Plugin
server.registerTool(
  "inject_lol_plugin",
  {
    title: "Inject Plugin",
    description:
      "Injects a persistent JavaScript plugin into the League Client. " +
      "The plugin code is stored by name and survives navigation changes within the client. " +
      "Use this to create full-featured plugins with both CSS and JS. " +
      "Calling again with the same name will update the existing plugin. " +
      "The code has access to the DOM, window, and all Pengu Loader APIs.",
    inputSchema: z.object({
      name: z
        .string()
        .describe(
          "Unique name/identifier for this plugin (e.g. 'auto-accept', 'custom-background')",
        ),
      code: z
        .string()
        .describe(
          "JavaScript code for the plugin. This will be executed immediately " +
            "and re-executed on client navigation. Can include DOM manipulation, " +
            "event listeners, mutation observers, intervals, etc.",
        ),
      css: z
        .string()
        .optional()
        .describe("Optional CSS to inject alongside the plugin JavaScript"),
    }),
    annotations: {
      idempotentHint: true,
    },
  },
  async ({ name, code, css }) => {
    try {
      const response = (await sendToPlugin("INJECT_PLUGIN", {
        name,
        code,
        css,
      })) as {
        type: string;
        data: unknown;
        success?: boolean;
      };
      return {
        content: [
          {
            type: "text" as const,
            text: response.success
              ? `Plugin "${name}" injected successfully.`
              : `Plugin "${name}" injection completed but status unknown.`,
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool 6: Remove Injected Plugin
server.registerTool(
  "remove_lol_plugin",
  {
    title: "Remove Plugin",
    description:
      "Removes a previously injected plugin by name from the League Client.",
    inputSchema: z.object({
      name: z.string().describe("Name of the plugin to remove"),
    }),
    annotations: {
      destructiveHint: true,
    },
  },
  async ({ name }) => {
    try {
      const response = (await sendToPlugin("REMOVE_PLUGIN", { name })) as {
        type: string;
        data: unknown;
        success?: boolean;
      };
      return {
        content: [
          {
            type: "text" as const,
            text: response.success
              ? `Plugin "${name}" removed successfully.`
              : `Plugin "${name}" not found.`,
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool 7: Get Client State
server.registerTool(
  "get_lol_client_state",
  {
    title: "Get Client State",
    description:
      "Returns information about the current state of the League Client: " +
      "current URL/page, document title, viewport size, and whether the client is connected.",
    annotations: {
      readOnlyHint: true,
    },
  },
  async () => {
    try {
      const response = (await sendToPlugin("GET_CLIENT_STATE")) as {
        type: string;
        data: unknown;
        success?: boolean;
      };
      return {
        content: [
          {
            type: "text" as const,
            text:
              typeof response.data === "string"
                ? response.data
                : JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool 8: Screenshot
server.registerTool(
  "get_lol_screenshot",
  {
    title: "Get Client Screenshot",
    description:
      "Captures a PNG screenshot of the current League Client viewport. " +
      "Saves to a temporary file and returns the file path.",
    inputSchema: z.object({
      saveToDisk: z
        .boolean()
        .optional()
        .default(true)
        .describe("Write screenshot to a temporary PNG file (default true)"),
      fileName: z
        .string()
        .optional()
        .describe(
          "Optional temp file name, e.g. 'client-shot.png'. Ignored when saveToDisk is false.",
        ),
      returnDataUrl: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Also return the full PNG data URL in the response text (can be large).",
        ),
      autoDeleteMs: z
        .number()
        .int()
        .min(5_000)
        .max(3_600_000)
        .optional()
        .default(120_000)
        .describe(
          "Auto-delete delay for temp file in milliseconds (default 120000).",
        ),
    }),
    annotations: {
      readOnlyHint: true,
    },
  },
  async ({ saveToDisk, fileName, returnDataUrl, autoDeleteMs }) => {
    try {
      const output: string[] = [];

      if (!saveToDisk) {
        throw new Error(
          "Direct screenshot mode currently supports only saveToDisk=true",
        );
      }
      if (returnDataUrl) {
        throw new Error(
          "returnDataUrl is not supported in direct screenshot mode",
        );
      }

      const defaultFileName = `lol-client-screenshot-${Date.now()}.png`;
      const targetName = fileName ?? defaultFileName;

      if (basename(targetName) !== targetName) {
        throw new Error(
          "Invalid fileName: must not contain path separators or '..'",
        );
      }

      const targetDir = tmpdir();
      const targetPath = join(targetDir, targetName);
      const escapedPath = targetPath.replace(/'/g, "''");

      const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
public static class Win32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hDC, uint nFlags);
}
"@

$proc = Get-Process -Name 'LeagueClientUx' -ErrorAction SilentlyContinue |
  Where-Object {
    $_.MainWindowHandle -ne 0 -and
    $_.MainWindowTitle -like '*League of Legends*'
  } |
  Select-Object -First 1

if ([Win32]::IsIconic($proc.MainWindowHandle)) {
  throw 'League Client window is minimized. Restore it and try again.'
}

$rect = New-Object RECT
[Win32]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null

$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)

$bmp = New-Object System.Drawing.Bitmap($width, $height)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
try {
  $hdc = $gfx.GetHdc()
  try {
    $ok = [Win32]::PrintWindow($proc.MainWindowHandle, $hdc, 0)
  }
  finally {
    $gfx.ReleaseHdc($hdc)
  }

  if (-not $ok) {
    throw 'PrintWindow failed for League Client window.'
  }

  $bmp.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
  $gfx.Dispose()
  $bmp.Dispose()
}
`;

      await runPowerShell(psScript);

      setTimeout(() => {
        unlink(targetPath).catch(() => {
          // Ignore cleanup errors for temp files.
        });
      }, autoDeleteMs).unref();

      output.push("Screenshot captured from League Client window handle.");
      output.push(`Temp file: ${targetPath}`);
      output.push(`Auto-delete in: ${autoDeleteMs} ms`);

      return {
        content: [
          {
            type: "text" as const,
            text: output.join("\n"),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool 9: Export plugin to Pengu Loader
server.registerTool(
  "export_plugin_to_pengu",
  {
    title: "Export Plugin to Pengu",
    description:
      "Exports a currently-injected plugin from the live League Client into a real, " +
      "persistent Pengu Loader plugin file. " +
      "The plugin is fetched from the MCP bridge (so it must be currently injected via inject_lol_plugin), " +
      "then wrapped in a proper Pengu Loader module with init() and load() exports, " +
      "and written directly to the Pengu Loader plugins folder. " +
      "After a client reload the plugin will load automatically on every startup without the MCP bridge.",
    inputSchema: z.object({
      name: z
        .string()
        .describe(
          "Name of the currently-injected plugin to export (as used in inject_lol_plugin)",
        ),
      fileName: z
        .string()
        .optional()
        .describe(
          "Output filename without extension (defaults to the plugin name). E.g. 'my-cool-plugin'",
        ),
      penguPluginsPath: z
        .string()
        .optional()
        .describe(
          "Absolute path to the Pengu Loader plugins folder. " +
            "Defaults to C:\\Program Files\\Pengu Loader\\plugins",
        ),
    }),
  },
  async ({ name, fileName, penguPluginsPath }) => {
    try {
      // Fetch live code + CSS from the bridge
      const response = (await sendToPlugin("GET_PLUGIN", { name })) as {
        type: string;
        data: { name: string; code: string; css: string | null };
        success?: boolean;
      };

      const { code, css } = response.data;

      // Sanitize name so it is safe to embed in generated JS string literals
      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");

      // Build a self-contained Pengu Loader plugin
      const cssBlock = css
        ? `
const _css = ${JSON.stringify(css)};
function _injectCSS() {
  let el = document.getElementById(_STYLE_ID);
  if (!el) { el = document.createElement('style'); el.id = _STYLE_ID; document.head.appendChild(el); }
  el.textContent = _css;
}
`
        : "";

      const cssCall = css ? "  _injectCSS();" : "";
      const styleIdConst = css
        ? `const _STYLE_ID = 'pengu-plugin-${safeName}-style';`
        : "";

      const observerBlock = css
        ? `
  // Re-apply CSS on SPA navigation
  let _debounce;
  const _observer = new MutationObserver(() => {
    clearTimeout(_debounce);
    _debounce = setTimeout(() => {
      if (!document.getElementById(_STYLE_ID)) _injectCSS();
    }, 400);
  });
  _observer.observe(document.body, { childList: true, subtree: false });
`
        : "";

      const observerCleanup = css ? "    _observer.disconnect();" : "";
      const cssCleanup = css
        ? "    const el = document.getElementById(_STYLE_ID); if (el) el.remove();"
        : "";

      const pluginSource = `// Pengu Loader Plugin: ${safeName}
// Exported by league-client-mcp on ${new Date().toISOString()}

${styleIdConst}
${cssBlock}
export function init(_context) {}

export async function load() {
${cssCall}
  const _AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const _fn = new _AsyncFunction(${JSON.stringify(code)});
  const _cleanup = await _fn();
${observerBlock}
  return () => {
${observerCleanup}
    if (typeof _cleanup === 'function') _cleanup();
${cssCleanup}
  };
}
`;

      const safeFileName = fileName ?? safeName;
      if (basename(safeFileName) !== safeFileName) {
        throw new Error(
          "Invalid fileName: must not contain path separators or '..' sequences",
        );
      }
      const outputDir =
        penguPluginsPath ?? "C:\\Program Files\\Pengu Loader\\plugins";
      const outputFile = join(outputDir, `${safeFileName}.js`);
      await writeFile(outputFile, pluginSource, "utf-8");

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Plugin "${name}" exported successfully.\n` +
              `File: ${outputFile}\n` +
              `Size: ${pluginSource.length} bytes\n\n` +
              "Reload the League Client to activate it permanently.",
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool 10: Click Element
server.registerTool(
  "click_lol_element",
  {
    title: "Click Element",
    description:
      "Clicks a DOM element in the League Client by CSS selector. " +
      "Use get_lol_dom_snapshot first to find the right selector. " +
      "Useful for navigating between pages, pressing buttons, selecting tabs.",
    inputSchema: z.object({
      selector: z.string().describe("CSS selector for the element to click"),
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "If selector matches multiple elements, which one to click (0-based, default 0)",
        ),
    }),
  },
  async ({ selector, index }) => {
    try {
      const response = (await sendToPlugin("CLICK_ELEMENT", {
        selector,
        index,
      })) as {
        type: string;
        data: unknown;
        success?: boolean;
      };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool 11: Type Into Element
server.registerTool(
  "type_into_lol_element",
  {
    title: "Type Into Element",
    description:
      "Types text into an input or textarea element in the League Client. " +
      "Dispatches native input/change events so React/Ember frameworks pick it up.",
    inputSchema: z.object({
      selector: z
        .string()
        .describe("CSS selector for the input/textarea element"),
      text: z.string().describe("Text to type into the element"),
      clear: z
        .boolean()
        .optional()
        .describe("Clear existing value before typing (default false)"),
    }),
  },
  async ({ selector, text, clear }) => {
    try {
      const response = (await sendToPlugin("TYPE_INTO_ELEMENT", {
        selector,
        text,
        clear,
      })) as {
        type: string;
        data: unknown;
        success?: boolean;
      };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool 12: Query Element
server.registerTool(
  "query_lol_element",
  {
    title: "Query Element",
    description:
      "Returns detailed info about a DOM element: text, bounding rect, computed styles, " +
      "and requested attributes. More efficient than a full DOM snapshot when you just " +
      "need to inspect one element (e.g. verify a style applied correctly).",
    inputSchema: z.object({
      selector: z.string().describe("CSS selector for the element to query"),
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Which match to inspect (0-based, default 0)"),
      attributes: z
        .array(z.string())
        .optional()
        .describe(
          "Extra HTML attributes to read back (e.g. ['href', 'class'])",
        ),
    }),
    annotations: {
      readOnlyHint: true,
    },
  },
  async ({ selector, index, attributes }) => {
    try {
      const response = (await sendToPlugin("QUERY_ELEMENT", {
        selector,
        index,
        attributes,
      })) as {
        type: string;
        data: unknown;
        success?: boolean;
      };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool 13: Wait For Element
server.registerTool(
  "wait_for_lol_element",
  {
    title: "Wait For Element",
    description:
      "Waits until a CSS selector matches an element in the League Client DOM, then returns its info. " +
      "Use after click_lol_element to wait for the next page to load before snapshotting or querying.",
    inputSchema: z.object({
      selector: z.string().describe("CSS selector to wait for"),
      timeout: z
        .number()
        .int()
        .min(100)
        .max(WAIT_ELEMENT_MAX_MS)
        .optional()
        .describe(
          `Max wait time in ms (default 10000, max ${WAIT_ELEMENT_MAX_MS})`,
        ),
      visible: z
        .boolean()
        .optional()
        .describe("Also require the element to be visible (non-zero size)"),
    }),
    annotations: {
      readOnlyHint: true,
    },
  },
  async ({ selector, timeout, visible }) => {
    try {
      const response = (await sendToPlugin("WAIT_FOR_ELEMENT", {
        selector,
        timeout,
        visible,
      })) as {
        type: string;
        data: unknown;
        success?: boolean;
      };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool 14: Performance Metrics
server.registerTool(
  "get_lol_performance_metrics",
  {
    title: "Get Performance Metrics",
    description:
      "Returns performance and memory metrics from the League Client: " +
      "JS heap usage, DOM node count, stylesheet count, paint timings. " +
      "Use this to debug heavy plugins or check if CSS injection bloats the client.",
    annotations: {
      readOnlyHint: true,
    },
  },
  async () => {
    try {
      const response = (await sendToPlugin("GET_PERFORMANCE_METRICS")) as {
        type: string;
        data: unknown;
        success?: boolean;
      };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool 15: Reload Client
server.registerTool(
  "reload_lol_client",
  {
    title: "Reload Client",
    description:
      "Reloads the entire League Client (equivalent to Pengu Loader's reload shortcut). " +
      "Use after deploying a new plugin via export_plugin_to_pengu to activate it, " +
      "or to reset the client UI to a clean state during development.",
    annotations: {
      destructiveHint: true,
    },
  },
  async () => {
    try {
      await sendToPlugin("RELOAD_CLIENT");
      return {
        content: [
          { type: "text" as const, text: "League Client is reloading..." },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool 16: Reload injected plugin
server.registerTool(
  "reload_lol_plugin",
  {
    title: "Reload Plugin",
    description:
      "Tears down and re-executes an injected plugin by name without touching other plugins. " +
      "Use after updating plugin code via inject_lol_plugin to restart it cleanly.",
    inputSchema: z.object({
      name: z.string().describe("Name of the injected plugin to reload"),
    }),
  },
  async ({ name }) => {
    try {
      const response = (await sendToPlugin("RELOAD_PLUGIN", { name })) as {
        type: string;
        data: unknown;
        success?: boolean;
      };
      return {
        content: [
          {
            type: "text" as const,
            text: response.success
              ? `Plugin "${name}" reloaded successfully.`
              : `Plugin "${name}" reload failed.`,
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

async function main() {
  console.error("[MCP] Starting League Client MCP Server...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Server connected via stdio. Waiting for tool calls...");
}

main().catch((err) => {
  console.error("[MCP] Fatal error:", err);
  process.exit(1);
});
