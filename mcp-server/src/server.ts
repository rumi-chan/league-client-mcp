import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { randomUUID } from "crypto";

const WS_PORT = 8080;
const REQUEST_TIMEOUT_MS = 15_000;

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
    console.error(`[WS Bridge] Plugin connected from ${req.socket.remoteAddress}`);
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
    data?: unknown
): Promise<{ type: string; data: unknown; success?: boolean }> {
    return new Promise((resolve, reject) => {
        if (!pluginClient || pluginClient.readyState !== WebSocket.OPEN) {
            return reject(
                new Error(
                    "No plugin connected. Make sure the LoL Client is running with PenguLoader."
                )
            );
        }

        const requestId = randomUUID();
        const timer = setTimeout(() => {
            pendingRequests.delete(requestId);
            reject(new Error(`Request ${type} timed out after ${REQUEST_TIMEOUT_MS}ms`));
        }, REQUEST_TIMEOUT_MS);

        pendingRequests.set(requestId, { resolve: resolve as (data: unknown) => void, reject, timer });

        pluginClient.send(
            JSON.stringify({ requestId, type, data })
        );
    });
}

const server = new McpServer({
    name: "league-client-mcp-server",
    version: "1.0.0",
});

// Tool 1: Get DOM Snapshot
server.tool(
    "get_lol_dom_snapshot",
    "Captures the current DOM tree of the League of Legends Client. " +
    "Returns a sanitized HTML string (SVG paths, long src attributes, and " +
    "unnecessary attributes are stripped to reduce size). " +
    "Use this to understand the current UI structure before designing CSS.",
    {},
    async () => {
        try {
            const response = await sendToPlugin("GET_DOM") as {
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
    }
);

// Tool 2: Inject CSS
server.tool(
    "inject_lol_css",
    "Injects or updates CSS styles in the League of Legends Client. " +
    "The CSS will be inserted into a <style> tag in the document head. " +
    "Subsequent calls will replace the previously injected CSS. " +
    "Use !important to override existing League Client styles.",
    {
        css: z
            .string()
            .describe(
                "The CSS string to inject into the LoL Client. " +
                "Use standard CSS syntax. CSS variables like --font-display, " +
                "--font-body are available for theming."
            ),
    },
    async ({ css }) => {
        try {
            const response = await sendToPlugin("INJECT_CSS", css) as {
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
    }
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
