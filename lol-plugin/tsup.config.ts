import { defineConfig } from 'tsup'
import { WebSocketServer } from 'ws'
import { existsSync } from 'fs'
import { mkdir, readdir, unlink, writeFile, cp, rename } from 'fs/promises'
import { join, resolve } from 'path'

import pkg from './package.json'

const PLUGIN_NAME = pkg.name

const WSS_PORT = 3000
const WSS_URL = `ws://localhost:${WSS_PORT}`

let wss: WebSocketServer | undefined

export default defineConfig((config) => ({
    clean: true,
    dts: false,
    entry: ["src/index.ts"],
    outDir: 'dist',
    format: 'esm',
    bundle: true,
    minify: config.watch ? false : true,
    shims: false,
    splitting: false,
    env: {
        ENV: config.watch ? 'development' : 'production',
        PROD: config.watch ? '' : 'true',
        DEV: config.watch ? 'true' : '',
    },
    async onSuccess() {
        if (!config.watch) {
            return
        }

        // Lazily initialize websocket server
        if (wss === undefined) {
            wss = new WebSocketServer({ port: WSS_PORT })
        }

        // Get plugin's path
        const path = join(resolve(pkg.config.penguPath), 'plugins', PLUGIN_NAME)

        // Create a folder if doesn't exist, else empty it
        if (existsSync(path)) {
            for (const file of await readdir(path)) {
                await unlink(join(path, file));
            }
        } else {
            await mkdir(path, { recursive: true });
        }

        // Copy dist files to plugin directory
        await cp('dist', path, { recursive: true });

        // Rename original index.js to _index.js
        const indexJsPath = join(path, 'index.js')
        await rename(indexJsPath, join(path, '_index.js'))

        // Prepare our proxy index.js
        let indexJS =
            `new WebSocket('${WSS_URL}').addEventListener('message', () => location.reload());
            export * from './_index.js';`

        if (existsSync(join('dist', 'index.css'))) {
            indexJS += `import './index.css';`
        }

        // Write our proxy index.js file
        await writeFile(indexJsPath, indexJS)

        // Notify all WSS clients that we need to refresh LCU!
        wss!.clients.forEach(function each(client) {
            if (client.readyState === WebSocket.OPEN) {
                client.send('change');
            }
        });
    },
}))
