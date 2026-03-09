const WS_URL = "ws://127.0.0.1:8080";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const STYLE_TAG_ID = "mcp-theme-injector";

/** Registry of injected plugins (name -> cleanup function) */
const injectedPlugins = new Map<
  string,
  { cleanup: () => void; code: string; css?: string }
>();

/**
 * Serialize document.body into a cleaned HTML string.
 * Strips heavy/unnecessary attributes to reduce payload size:
 * - SVG `d` and `points` attributes (path data)
 * - Long `src`, `href`, `style` attributes (>200 chars)
 * - `data-*` attributes
 * - Script and noscript tags are removed entirely
 */
function getCleanDOMSnapshot(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;

  // Remove script/noscript tags
  const scripts = clone.querySelectorAll("script, noscript");
  scripts.forEach((el) => el.remove());

  // Remove our own injected style tag from the snapshot
  const injectedStyle = clone.querySelector(`#${STYLE_TAG_ID}`);
  if (injectedStyle) injectedStyle.remove();

  // Walk all elements and sanitize attributes
  const allElements = clone.querySelectorAll("*");
  allElements.forEach((el) => {
    const attrsToRemove: string[] = [];

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;

      // Remove SVG path data
      if (name === "d" || name === "points") {
        attrsToRemove.push(attr.name);
        continue;
      }

      // Remove data-* attributes
      if (name.startsWith("data-")) {
        attrsToRemove.push(attr.name);
        continue;
      }

      // Truncate long src/href/style attributes
      if (
        (name === "src" || name === "href" || name === "style") &&
        value.length > 200
      ) {
        el.setAttribute(attr.name, value.substring(0, 80) + "...[truncated]");
        continue;
      }

      // Remove inline event handlers
      if (name.startsWith("on")) {
        attrsToRemove.push(attr.name);
        continue;
      }
    }

    attrsToRemove.forEach((name) => el.removeAttribute(name));

    // For SVG elements, simplify content
    if (el.tagName.toLowerCase() === "svg") {
      el.innerHTML = "<!-- svg content stripped -->";
    }
  });

  return clone.outerHTML;
}

/**
 * Inject or update a <style> tag in document.head with the given CSS.
 */
function injectCSS(css: string): void {
  let styleEl = document.getElementById(
    STYLE_TAG_ID,
  ) as HTMLStyleElement | null;

  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = STYLE_TAG_ID;
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = css;
}

interface WSMessage {
  requestId?: string;
  type: string;
  data?: unknown;
}

let ws: WebSocket | null = null;
let reconnectAttempt = 0;

function connectWebSocket(): void {
  if (
    ws &&
    (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  console.log("[MCP Bridge] Connecting to MCP Bridge:", WS_URL);
  ws = new WebSocket(WS_URL);

  ws.addEventListener("open", () => {
    console.log("[MCP Bridge] Connected to MCP Bridge");
    reconnectAttempt = 0;
  });

  ws.addEventListener("message", (event) => {
    try {
      const message: WSMessage = JSON.parse(event.data as string);
      handleMessage(message).catch((err) => {
        console.error("[MCP Bridge] Handler error:", err);
      });
    } catch (err) {
      console.error("[MCP Bridge] Failed to parse message:", err);
    }
  });

  ws.addEventListener("close", () => {
    console.log("[MCP Bridge] Disconnected from MCP Bridge");
    ws = null;
    scheduleReconnect();
  });

  ws.addEventListener("error", (err) => {
    console.error("[MCP Bridge] WebSocket error:", err);
    // close event will follow, triggering reconnect
  });
}

function scheduleReconnect(): void {
  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt),
    RECONNECT_MAX_MS,
  );
  reconnectAttempt++;
  console.log(
    `[MCP Bridge] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})`,
  );
  setTimeout(connectWebSocket, delay);
}

function sendResponse(
  requestId: string,
  type: string,
  data: unknown,
  success = true,
): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error("[MCP Bridge] Cannot send response - not connected");
    return;
  }

  ws.send(JSON.stringify({ requestId, type, data, success }));
}

function sendError(requestId: string, error: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({ requestId, error }));
}

/**
 * Inject CSS and execute plugin code, then register the plugin in the map.
 * If code execution throws, any injected style element is removed to avoid orphaning it.
 */
async function executeAndRegisterPlugin(
  name: string,
  code: string,
  css?: string,
): Promise<void> {
  let styleEl: HTMLStyleElement | null = null;
  if (css) {
    styleEl = document.createElement("style");
    styleEl.id = `mcp-plugin-css-${name}`;
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  try {
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const fn = new AsyncFunction(code);
    const result = await fn();

    const pluginCleanup = typeof result === "function" ? result : () => {};
    const cleanup = () => {
      try {
        pluginCleanup();
      } catch (_) {}
      if (styleEl) styleEl.remove();
    };

    injectedPlugins.set(name, { cleanup, code, css });
  } catch (err) {
    // Don't orphan the style element if execution failed
    if (styleEl) styleEl.remove();
    throw err;
  }
}

async function handleMessage(message: WSMessage): Promise<void> {
  const { requestId, type, data } = message;

  if (!requestId) {
    console.warn("[MCP Bridge] Message without requestId, ignoring:", type);
    return;
  }

  switch (type) {
    case "GET_DOM": {
      try {
        const snapshot = getCleanDOMSnapshot();
        sendResponse(requestId, "DOM_SNAPSHOT", snapshot);
        console.log(
          `[MCP Bridge] DOM snapshot sent (${snapshot.length} chars)`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError(requestId, `Failed to capture DOM: ${msg}`);
      }
      break;
    }

    case "INJECT_CSS": {
      try {
        const css = data as string;
        if (!css || typeof css !== "string") {
          sendError(requestId, "Invalid CSS: expected a non-empty string");
          return;
        }
        injectCSS(css);
        sendResponse(requestId, "CSS_INJECTED", null, true);
        console.log(`[MCP Bridge] CSS injected (${css.length} chars)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError(requestId, `Failed to inject CSS: ${msg}`);
      }
      break;
    }

    case "EXECUTE_JS": {
      try {
        const { code } = data as { code: string };
        if (!code || typeof code !== "string") {
          sendError(requestId, "Invalid code: expected a non-empty string");
          return;
        }
        // Use AsyncFunction to allow await in the code
        const AsyncFunction = Object.getPrototypeOf(
          async function () {},
        ).constructor;
        const fn = new AsyncFunction(code);
        const result = await fn();
        const serialized =
          result === undefined ? "undefined" : JSON.stringify(result, null, 2);
        sendResponse(requestId, "JS_EXECUTED", serialized);
        console.log(`[MCP Bridge] JS executed (${code.length} chars)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError(requestId, `JS execution failed: ${msg}`);
      }
      break;
    }

    case "LCU_REQUEST": {
      try {
        const { method, endpoint, body } = data as {
          method: string;
          endpoint: string;
          body?: unknown;
        };
        if (!endpoint || !endpoint.startsWith("/")) {
          sendError(requestId, "Invalid endpoint: must start with /");
          return;
        }

        // Use fetch against the LCU API (Pengu Loader provides access)
        const fetchOptions: RequestInit = {
          method: method || "GET",
          headers: { "Content-Type": "application/json" },
        };
        if (body !== undefined && method !== "GET") {
          fetchOptions.body = JSON.stringify(body);
        }

        const resp = await fetch(endpoint, fetchOptions);
        let responseData: unknown;
        const contentType = resp.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          responseData = await resp.json();
        } else {
          responseData = await resp.text();
        }

        sendResponse(requestId, "LCU_RESPONSE", {
          status: resp.status,
          data: responseData,
        });
        console.log(`[MCP Bridge] LCU ${method} ${endpoint} -> ${resp.status}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError(requestId, `LCU request failed: ${msg}`);
      }
      break;
    }

    case "INJECT_PLUGIN": {
      try {
        const { name, code, css } = data as {
          name: string;
          code: string;
          css?: string;
        };
        if (!name || !code) {
          sendError(requestId, "Plugin requires a name and code");
          return;
        }

        // Remove existing plugin with same name if present
        if (injectedPlugins.has(name)) {
          injectedPlugins.get(name)!.cleanup();
          injectedPlugins.delete(name);
        }

        await executeAndRegisterPlugin(name, code, css);

        sendResponse(requestId, "PLUGIN_INJECTED", null, true);
        console.log(`[MCP Bridge] Plugin "${name}" injected`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError(requestId, `Plugin injection failed: ${msg}`);
      }
      break;
    }

    case "REMOVE_PLUGIN": {
      try {
        const { name } = data as { name: string };
        if (injectedPlugins.has(name)) {
          injectedPlugins.get(name)!.cleanup();
          injectedPlugins.delete(name);
          sendResponse(requestId, "PLUGIN_REMOVED", null, true);
          console.log(`[MCP Bridge] Plugin "${name}" removed`);
        } else {
          sendResponse(requestId, "PLUGIN_REMOVED", null, false);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError(requestId, `Plugin removal failed: ${msg}`);
      }
      break;
    }

    case "GET_PLUGIN": {
      try {
        const { name } = data as { name: string };
        if (!injectedPlugins.has(name)) {
          sendError(requestId, `Plugin "${name}" not found`);
          return;
        }
        const info = injectedPlugins.get(name)!;
        sendResponse(requestId, "PLUGIN_DATA", {
          name,
          code: info.code,
          css: info.css ?? null,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError(requestId, `Get plugin failed: ${msg}`);
      }
      break;
    }

    case "GET_CLIENT_STATE": {
      try {
        const state = {
          url: window.location.href,
          title: document.title,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
          pluginCount: injectedPlugins.size,
          plugins: Array.from(injectedPlugins.keys()),
        };
        sendResponse(requestId, "CLIENT_STATE", state);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError(requestId, `Get client state failed: ${msg}`);
      }
      break;
    }

    case "CLICK_ELEMENT": {
      try {
        const { selector, index } = data as {
          selector: string;
          index?: number;
        };
        const all = Array.from(document.querySelectorAll(selector));
        if (all.length === 0) {
          sendError(requestId, `No element found matching: ${selector}`);
          return;
        }
        const el = (all[index ?? 0] ?? all[0]) as HTMLElement;
        el.click();
        sendResponse(requestId, "ELEMENT_CLICKED", {
          selector,
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim().slice(0, 100),
        });
        console.log(`[MCP Bridge] Clicked: ${selector}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError(requestId, `Click failed: ${msg}`);
      }
      break;
    }

    case "TYPE_INTO_ELEMENT": {
      try {
        const { selector, text, clear } = data as {
          selector: string;
          text: string;
          clear?: boolean;
        };
        const el = document.querySelector(selector) as
          | HTMLInputElement
          | HTMLTextAreaElement
          | null;
        if (!el) {
          sendError(requestId, `No element found matching: ${selector}`);
          return;
        }
        el.focus();
        if (clear) {
          el.value = "";
        }
        // Try native setter first (works for React), fall back to direct assignment (Ember/web components)
        try {
          const proto =
            el.tagName === "TEXTAREA"
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(
            proto,
            "value",
          )?.set;
          if (nativeSetter) {
            nativeSetter.call(el, (el.value ?? "") + text);
          } else {
            el.value = (el.value ?? "") + text;
          }
        } catch {
          el.value = (el.value ?? "") + text;
        }
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, data: text }),
        );
        el.dispatchEvent(new Event("change", { bubbles: true }));
        sendResponse(requestId, "TEXT_TYPED", { selector, value: el.value });
        console.log(`[MCP Bridge] Typed into: ${selector}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError(requestId, `Type failed: ${msg}`);
      }
      break;
    }

    case "QUERY_ELEMENT": {
      try {
        const { selector, index, attributes } = data as {
          selector: string;
          index?: number;
          attributes?: string[];
        };
        const all = Array.from(document.querySelectorAll(selector));
        if (all.length === 0) {
          sendError(requestId, `No element found matching: ${selector}`);
          return;
        }
        const el = (all[index ?? 0] ?? all[0]) as HTMLElement;
        const rect = el.getBoundingClientRect();
        const styles = window.getComputedStyle(el);
        const attrMap: Record<string, string> = {};
        (attributes ?? []).forEach((a) => {
          attrMap[a] = el.getAttribute(a) ?? "";
        });
        sendResponse(requestId, "ELEMENT_DATA", {
          tag: el.tagName.toLowerCase(),
          id: el.id,
          classes: Array.from(el.classList),
          text: el.textContent?.trim().slice(0, 500),
          innerHTML: el.innerHTML.slice(0, 1000),
          attributes: attrMap,
          rect: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          },
          computed: {
            color: styles.color,
            backgroundColor: styles.backgroundColor,
            display: styles.display,
            visibility: styles.visibility,
            opacity: styles.opacity,
            fontSize: styles.fontSize,
            fontFamily: styles.fontFamily,
          },
          count: all.length,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError(requestId, `Query failed: ${msg}`);
      }
      break;
    }

    case "WAIT_FOR_ELEMENT": {
      try {
        const { selector, timeout, visible } = data as {
          selector: string;
          timeout?: number;
          visible?: boolean;
        };
        const deadline = Date.now() + (timeout ?? 10_000);
        const found = await new Promise<HTMLElement | null>((resolve) => {
          const check = () => {
            const el = document.querySelector(selector) as HTMLElement | null;
            const ok =
              el && (!visible || (el.offsetWidth > 0 && el.offsetHeight > 0));
            if (ok) return resolve(el);
            if (Date.now() >= deadline) return resolve(null);
            setTimeout(check, 100);
          };
          check();
        });
        if (!found) {
          sendError(requestId, `Timed out waiting for: ${selector}`);
          return;
        }
        const rect = found.getBoundingClientRect();
        sendResponse(requestId, "ELEMENT_FOUND", {
          selector,
          tag: found.tagName.toLowerCase(),
          text: found.textContent?.trim().slice(0, 200),
          rect: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          },
        });
        console.log(`[MCP Bridge] Found element: ${selector}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError(requestId, `Wait failed: ${msg}`);
      }
      break;
    }

    case "GET_PERFORMANCE_METRICS": {
      try {
        const mem = (performance as any).memory;
        const nav = performance.getEntriesByType("navigation")[0] as
          | PerformanceNavigationTiming
          | undefined;
        const paint = performance.getEntriesByType("paint");
        const metrics = {
          memory: mem
            ? {
                usedJSHeapSizeMB: +(mem.usedJSHeapSize / 1048576).toFixed(2),
                totalJSHeapSizeMB: +(mem.totalJSHeapSize / 1048576).toFixed(2),
                jsHeapSizeLimitMB: +(mem.jsHeapSizeLimit / 1048576).toFixed(2),
              }
            : null,
          timing: nav
            ? {
                domContentLoadedMs: +nav.domContentLoadedEventEnd.toFixed(1),
                loadEventMs: +nav.loadEventEnd.toFixed(1),
                domInteractiveMs: +nav.domInteractive.toFixed(1),
              }
            : null,
          paint: paint.map((e) => ({
            name: e.name,
            startTimeMs: +e.startTime.toFixed(1),
          })),
          injectedPlugins: injectedPlugins.size,
          domNodeCount: document.querySelectorAll("*").length,
          styleSheetCount: document.styleSheets.length,
          now: performance.now().toFixed(1),
        };
        sendResponse(requestId, "PERFORMANCE_METRICS", metrics);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError(requestId, `Performance metrics failed: ${msg}`);
      }
      break;
    }

    case "RELOAD_CLIENT": {
      try {
        // Notify the server that the client is reloading, then trigger a full page reload.
        // Currently implemented via window.location.reload() with a short delay.
        sendResponse(requestId, "CLIENT_RELOADING", null, true);
        console.log("[MCP Bridge] Reloading client...");
        setTimeout(() => window.location.reload(), 200);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError(requestId, `Reload failed: ${msg}`);
      }
      break;
    }

    case "RELOAD_PLUGIN": {
      try {
        const { name } = data as { name: string };
        if (!injectedPlugins.has(name)) {
          sendError(requestId, `Plugin "${name}" not found`);
          return;
        }
        const info = injectedPlugins.get(name)!;
        // Cleanup existing
        info.cleanup();
        injectedPlugins.delete(name);
        // Re-execute with the same code and CSS
        await executeAndRegisterPlugin(name, info.code, info.css);
        sendResponse(requestId, "PLUGIN_RELOADED", null, true);
        console.log(`[MCP Bridge] Plugin "${name}" reloaded`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError(requestId, `Reload plugin failed: ${msg}`);
      }
      break;
    }

    default:
      console.warn("[MCP Bridge] Unknown message type:", type);
      sendError(requestId, `Unknown message type: ${type}`);
  }
}

export function init(context: any) {
  console.log("[MCP Bridge] Plugin initialized (env:", process.env.ENV + ")");
}

export function load() {
  console.log("[MCP Bridge] Plugin loaded, starting WebSocket connection...");
  connectWebSocket();
}
