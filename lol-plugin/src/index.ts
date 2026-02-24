const WS_URL = 'ws://127.0.0.1:8080'
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000
const STYLE_TAG_ID = 'mcp-theme-injector'

/**
 * Serialize document.body into a cleaned HTML string.
 * Strips heavy/unnecessary attributes to reduce payload size:
 * - SVG `d` and `points` attributes (path data)
 * - Long `src`, `href`, `style` attributes (>200 chars)
 * - `data-*` attributes
 * - Script and noscript tags are removed entirely
 */
function getCleanDOMSnapshot(): string {
    const clone = document.body.cloneNode(true) as HTMLElement

    // Remove script/noscript tags
    const scripts = clone.querySelectorAll('script, noscript')
    scripts.forEach((el) => el.remove())

    // Remove our own injected style tag from the snapshot
    const injectedStyle = clone.querySelector(`#${STYLE_TAG_ID}`)
    if (injectedStyle) injectedStyle.remove()

    // Walk all elements and sanitize attributes
    const allElements = clone.querySelectorAll('*')
    allElements.forEach((el) => {
        const attrsToRemove: string[] = []

        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase()
            const value = attr.value

            // Remove SVG path data
            if (name === 'd' || name === 'points') {
                attrsToRemove.push(attr.name)
                continue
            }

            // Remove data-* attributes
            if (name.startsWith('data-')) {
                attrsToRemove.push(attr.name)
                continue
            }

            // Truncate long src/href/style attributes
            if (
                (name === 'src' || name === 'href' || name === 'style') &&
                value.length > 200
            ) {
                el.setAttribute(attr.name, value.substring(0, 80) + '...[truncated]')
                continue
            }

            // Remove inline event handlers
            if (name.startsWith('on')) {
                attrsToRemove.push(attr.name)
                continue
            }
        }

        attrsToRemove.forEach((name) => el.removeAttribute(name))

        // For SVG elements, simplify content
        if (el.tagName.toLowerCase() === 'svg') {
            el.innerHTML = '<!-- svg content stripped -->'
        }
    })

    return clone.outerHTML
}


/**
 * Inject or update a <style> tag in document.head with the given CSS.
 */
function injectCSS(css: string): void {
    let styleEl = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null

    if (!styleEl) {
        styleEl = document.createElement('style')
        styleEl.id = STYLE_TAG_ID
        document.head.appendChild(styleEl)
    }

    styleEl.textContent = css
}

interface WSMessage {
    requestId?: string
    type: string
    data?: unknown
}

let ws: WebSocket | null = null
let reconnectAttempt = 0

function connectWebSocket(): void {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        return
    }

    console.log('[MCP Bridge] Connecting to MCP Bridge:', WS_URL)
    ws = new WebSocket(WS_URL)

    ws.addEventListener('open', () => {
        console.log('[MCP Bridge] Connected to MCP Bridge')
        reconnectAttempt = 0
    })

    ws.addEventListener('message', (event) => {
        try {
            const message: WSMessage = JSON.parse(event.data as string)
            handleMessage(message)
        } catch (err) {
            console.error('[MCP Bridge] Failed to parse message:', err)
        }
    })

    ws.addEventListener('close', () => {
        console.log('[MCP Bridge] Disconnected from MCP Bridge')
        ws = null
        scheduleReconnect()
    })

    ws.addEventListener('error', (err) => {
        console.error('[MCP Bridge] WebSocket error:', err)
        // close event will follow, triggering reconnect
    })
}

function scheduleReconnect(): void {
    const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt),
        RECONNECT_MAX_MS
    )
    reconnectAttempt++
    console.log(`[MCP Bridge] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})`)
    setTimeout(connectWebSocket, delay)
}

function sendResponse(requestId: string, type: string, data: unknown, success = true): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('[MCP Bridge] Cannot send response - not connected')
        return
    }

    ws.send(JSON.stringify({ requestId, type, data, success }))
}

function sendError(requestId: string, error: string): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    ws.send(JSON.stringify({ requestId, error }))
}

function handleMessage(message: WSMessage): void {
    const { requestId, type, data } = message

    if (!requestId) {
        console.warn('[MCP Bridge] Message without requestId, ignoring:', type)
        return
    }

    switch (type) {
        case 'GET_DOM': {
            try {
                const snapshot = getCleanDOMSnapshot()
                sendResponse(requestId, 'DOM_SNAPSHOT', snapshot)
                console.log(`[MCP Bridge] DOM snapshot sent (${snapshot.length} chars)`)
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                sendError(requestId, `Failed to capture DOM: ${msg}`)
            }
            break
        }

        case 'INJECT_CSS': {
            try {
                const css = data as string
                if (!css || typeof css !== 'string') {
                    sendError(requestId, 'Invalid CSS: expected a non-empty string')
                    return
                }
                injectCSS(css)
                sendResponse(requestId, 'CSS_INJECTED', null, true)
                console.log(`[MCP Bridge] CSS injected (${css.length} chars)`)
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                sendError(requestId, `Failed to inject CSS: ${msg}`)
            }
            break
        }

        default:
            console.warn('[MCP Bridge] Unknown message type:', type)
            sendError(requestId, `Unknown message type: ${type}`)
    }
}

export function init(context: any) {
    console.log('[MCP Bridge] Plugin initialized (env:', process.env.ENV + ')')
}

export function load() {
    console.log('[MCP Bridge] Plugin loaded, starting WebSocket connection...')
    connectWebSocket()
}
